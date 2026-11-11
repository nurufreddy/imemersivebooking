import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BEATS, NO_WINDOW_LIGHT, SCENERY, SEAT_BY_ID } from '../config/demoFlight';
import type { Beat, SeatDef } from '../config/types';
import { beatMixAt, clamp } from '../logic/timeline';
import { Cabin, createCabinLight, resolveLight } from './cabin/Cabin';
import { SceneryLibrary } from './cabin/Scenery';
import { Compositor } from './Compositor';
import { AircraftMap, rowZ, MAP } from './map/AircraftMap';
import { applyPose, clonePose, frameMap, mapPose, transitionBlur, transitionMix, transitionPose, wallPose, windowPose, type Layout, type MapFrame, type Pose } from './camera';

export interface StageLayout {
  width: number;
  height: number;
  headerBottom: number;
  mapSheetTop: number;
  previewSheetTop: number;
  /** When the sheet is right-aligned (short landscape), the preview frames the area to its left. */
  previewRight?: number;
}

export interface StageEvents {
  onProgress(p: number, target: 0 | 1): void;
  onSettled(view: 'map' | 'preview'): void;
  /** Called after each rendered frame (DOM overlays re-anchor here). */
  onFrame(): void;
  onContextLost(): void;
}

export interface ShadeHandleInfo {
  x: number;
  y: number;
  /** Screen y of the shade edge when fully open / fully closed. */
  yOpen: number;
  yClosed: number;
  width: number;
}

const ENTER_DURATION = 1.4;
const EXIT_DURATION = 1.25;
const REDUCED_DURATION = 0.3;

/** Horizontal drift of a beat's photograph across its time on screen. */
function driftFor(beat: Beat, minutes: number) {
  const img = SCENERY[beat.imageId];
  if (!img) return 0;
  const span = beat.hold[1] - beat.hold[0] + 12;
  const phase = clamp((minutes - beat.hold[0] + 6) / span, 0, 1) - 0.5;
  return img.drift * phase;
}

export class Stage3D {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(18, 1, 0.1, 700);
  private readonly camB = new THREE.PerspectiveCamera(50, 1, 0.1, 700);
  private readonly pickCam = new THREE.PerspectiveCamera(18, 1, 0.1, 700);
  private readonly map: AircraftMap;
  private readonly cabin: Cabin;
  readonly library: SceneryLibrary;
  private readonly compositor = new Compositor();
  private layout: StageLayout = { width: 390, height: 844, headerBottom: 70, mapSheetTop: 720, previewSheetTop: 586 };
  private frame!: MapFrame;
  private pan = 0;
  private panTarget = 0;
  private panVel = 0;
  private dragging = false;
  private p = 0;
  private target: 0 | 1 = 0;
  private duration = ENTER_DURATION;
  private reduced = false;
  private seat: SeatDef | null = null;
  private seatPose: Pose | null = null;
  private readonly tmpPose: Pose = { target: new THREE.Vector3(), distance: 1, heading: 0, pitch: 0, fov: 50, shift: 0, shiftX: 0 };
  private needsRender = true;
  private raf = 0;
  private last = 0;
  private minutes = 0;
  private shade = 0;
  private readonly light = createCabinLight();
  private pixelRatio = 1;
  private readonly maxPixelRatio: number;
  private slowFrames = 0;
  private frameCount = 0;
  private readonly center = new THREE.Vector2(0.5, 0.5);
  private readonly v = new THREE.Vector3();
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, private readonly events: StageEvents, monoFont: string, initialMinutes: number) {
    this.canvas = canvas;
    this.minutes = initialMinutes;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.NeutralToneMapping; // switched per scene in draw()
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor('#eff0eb', 1);
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.map = new AircraftMap(env, monoFont);
    this.cabin = new Cabin(env);
    this.library = new SceneryLibrary(this.renderer, () => {
      this.applyTimeline();
      this.requestRender();
    });

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.events.onContextLost();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.requestRender();
    });
  }

  /** Compile every material up front so the first transition never stalls. */
  async warmUp() {
    const anySeat = SEAT_BY_ID.get('23A')!;
    this.cabin.configure(anySeat, rowZ(anySeat.row));
    this.resolveLightFor(anySeat);
    applyPose(this.camera, mapPose(frameMap(this.layoutFor('map')), this.layout.height, 0, MAP.seatTopY));
    const r = this.renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> };
    try {
      // compile each scene with the tone mapping it is drawn with (see draw())
      for (const [scene, tm] of [[this.map.scene, THREE.NoToneMapping], [this.cabin.scene, THREE.NeutralToneMapping]] as const) {
        this.renderer.toneMapping = tm;
        if (r.compileAsync) await r.compileAsync(scene, this.camera);
        else this.renderer.compile(scene, this.camera);
      }
      // frames rendered into the transition targets use linear-output variants: compile those
      // too, then draw every path once (same task, so nothing reaches the screen in between)
      this.renderer.setRenderTarget(this.compositor.warmTarget);
      this.renderer.compile(this.map.scene, this.camera);
      this.renderer.compile(this.cabin.scene, this.camera);
      this.renderer.setRenderTarget(null);
      // warm draws use a scratch camera only; seat/pose state (which a tap during the
      // async compile may already have set) is left untouched
      applyPose(this.camB, windowPose(this.cabin.windowCenter(), Math.PI / 2, this.cabin.opening(), this.layoutFor('preview')));
      this.compositor.render(this.renderer, { scene: this.map.scene, camera: this.camera }, { scene: this.cabin.scene, camera: this.camB }, 0.5, 0.05, this.center);
      this.draw('cabin', this.camB);
      this.renderFrame();
    } catch {
      /* warming is an optimisation only */
    }
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
  }

  /* ------------------------------ layout ------------------------------ */

  setLayout(l: StageLayout) {
    const sizeChanged = l.width !== this.layout.width || l.height !== this.layout.height;
    this.layout = l;
    if (sizeChanged || !this.frame) {
      this.renderer.setSize(l.width, l.height, false);
      this.camera.aspect = this.camB.aspect = this.pickCam.aspect = l.width / l.height;
    }
    this.frame = frameMap(this.layoutFor('map'));
    this.pan = this.panTarget = clamp(this.pan, this.frame.panMin, this.frame.panMax);
    this.updateSeatPose();
    this.resizeTargets();
    this.requestRender();
  }

  private layoutFor(view: 'map' | 'preview'): Layout {
    const l = this.layout;
    if (view === 'preview' && l.previewRight !== undefined) {
      return { width: l.width, height: l.height, regionTop: l.headerBottom, regionBottom: l.height - 8, regionLeft: 0, regionRight: l.previewRight };
    }
    return { width: l.width, height: l.height, regionTop: l.headerBottom, regionBottom: view === 'map' ? l.mapSheetTop : l.previewSheetTop };
  }

  private resizeTargets() {
    const w = this.layout.width * this.pixelRatio;
    const h = this.layout.height * this.pixelRatio;
    const scale = clamp(Math.sqrt(2.4e6 / (w * h)), 0.55, 1);
    this.compositor.setSize(w * scale, h * scale);
  }

  /* ------------------------------ seat map ------------------------------ */

  setSeatStates(selected: string | null, confirmed: string | null) {
    if (this.map.setSeatState(selected, confirmed)) this.requestRender();
  }

  setHover(id: string | null) {
    if (this.map.setHovered(id)) this.requestRender();
  }

  setFocusSeat(id: string | null) {
    if (this.map.setFocusRing(id)) this.requestRender();
  }

  get mapInteractive() {
    return this.p === 0 && this.target === 0;
  }

  get settledPreview() {
    return this.p === 1 && this.target === 1;
  }

  get canPan() {
    return this.frame.panMax > this.frame.panMin;
  }

  get mapOrientation() {
    return this.frame.orientation;
  }

  pick(clientX: number, clientY: number): SeatDef | null {
    if (!this.mapInteractive) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    applyPose(this.pickCam, this.currentMapPose());
    return this.map.pick(ndc, this.pickCam);
  }

  beginDrag() {
    this.dragging = true;
    this.panVel = 0;
  }

  /** Drag the map by screen pixels (content follows the pointer). */
  dragBy(dx: number, dy: number, dt: number) {
    if (!this.canPan) return;
    const delta = (this.frame.orientation === 'vertical' ? -dy : -dx) / this.frame.scale;
    const next = clamp(this.pan + delta, this.frame.panMin, this.frame.panMax);
    const applied = next - this.pan;
    this.pan = this.panTarget = next;
    if (dt > 0) this.panVel = THREE.MathUtils.lerp(this.panVel, applied / dt, 0.5);
    this.requestRender();
  }

  endDrag() {
    this.dragging = false;
    if (Math.abs(this.panVel) > 0.3) this.kick();
  }

  /** Wheel / keyboard scrolling in screen pixels. */
  scrollBy(px: number) {
    if (!this.canPan) return;
    this.panTarget = clamp(this.panTarget + px / this.frame.scale, this.frame.panMin, this.frame.panMax);
    this.kick();
  }

  resetMapView() {
    this.panTarget = 0;
    this.panVel = 0;
    this.kick();
  }

  /** Scroll the map just enough to show a seat (keyboard navigation). */
  revealSeat(id: string) {
    if (!this.canPan) return;
    const world = this.map.seatWorld(id);
    const f = this.frame;
    const l = this.layout;
    const margin = 36 / f.scale;
    if (f.orientation === 'vertical') {
      const top = f.baseZ + this.panTarget - (l.height / 2 - l.headerBottom) / f.scale + margin;
      const bottom = f.baseZ + this.panTarget + (l.mapSheetTop - l.height / 2) / f.scale - margin;
      if (world.z < top) this.panTarget += world.z - top;
      else if (world.z > bottom) this.panTarget += world.z - bottom;
    } else {
      const left = f.baseZ + this.panTarget - l.width / 2 / f.scale + margin;
      const right = f.baseZ + this.panTarget + l.width / 2 / f.scale - margin;
      if (world.z < left) this.panTarget += world.z - left;
      else if (world.z > right) this.panTarget += world.z - right;
    }
    this.panTarget = clamp(this.panTarget, f.panMin, f.panMax);
    this.kick();
  }

  private currentMapPose(): Pose {
    return mapPose(this.frame, this.layout.height, this.pan, MAP.seatTopY);
  }

  /** CSS-pixel position of a seat on the settled map. */
  seatScreen(id: string) {
    applyPose(this.pickCam, this.currentMapPose());
    return this.toScreen(this.map.seatWorld(id), this.pickCam);
  }

  /* ------------------------------ transitions ------------------------------ */

  /** Fly into a seat's preview. Returns false if a different flight is in progress. */
  enterSeat(seat: SeatDef): boolean {
    if (this.p > 0 && this.seat && this.seat.id !== seat.id) return false;
    if (this.seat?.id !== seat.id || this.p === 0) {
      this.seat = seat;
      this.cabin.configure(seat, rowZ(seat.row));
      this.cabin.setShade(this.shade);
      this.updateSeatPose();
      this.applyTimeline();
      this.preloadFor(seat);
    }
    this.startTransition(1);
    return true;
  }

  exitToMap() {
    if (!this.seat) return;
    this.startTransition(0);
  }

  private startTransition(to: 0 | 1) {
    this.target = to;
    this.duration = this.reduced ? REDUCED_DURATION : to === 1 ? ENTER_DURATION : EXIT_DURATION;
    this.events.onProgress(this.p, this.target);
    this.kick();
  }

  get progress() {
    return this.p;
  }

  private updateSeatPose() {
    if (!this.seat) return;
    const l = this.layoutFor('preview');
    const heading = this.seat.side === 'port' ? Math.PI / 2 : -Math.PI / 2;
    if (this.seat.view === 'no-window') {
      this.seatPose = wallPose(this.cabin.wallPoint(), heading, this.cabin.wallViewGeometry(), l);
    } else {
      this.seatPose = windowPose(this.cabin.windowCenter(), heading, this.cabin.opening(), l);
      this.cabin.fitBackdrop(this.seatPose.distance);
      this.applyTimeline();
    }
  }

  /* ------------------------------ timeline & shade ------------------------------ */

  setTime(minutes: number) {
    this.minutes = minutes;
    this.applyTimeline();
    this.requestRender();
  }

  setShade(s: number) {
    this.shade = clamp(s, 0, 1);
    this.cabin.setShade(this.shade);
    this.requestRender();
  }

  private resolveLightFor(seat: SeatDef) {
    if (seat.view === 'no-window') return resolveLight(NO_WINDOW_LIGHT, NO_WINDOW_LIGHT, 0, this.light);
    const beats = BEATS[seat.side];
    const mix = beatMixAt(beats, this.minutes);
    return resolveLight(beats[mix.a].light, beats[mix.b].light, mix.t, this.light);
  }

  private applyTimeline() {
    const seat = this.seat;
    if (!seat) return;
    this.cabin.setLight(this.resolveLightFor(seat));
    if (seat.view === 'no-window') return;
    const beats = BEATS[seat.side];
    const mix = beatMixAt(beats, this.minutes);
    const A = beats[mix.a];
    const B = beats[mix.b];
    this.cabin.setScenery(
      { id: A.imageId, tex: this.library.get(A.imageId), drift: driftFor(A, this.minutes) },
      { id: B.imageId, tex: this.library.get(B.imageId), drift: driftFor(B, this.minutes) },
      mix.t,
      this.light.sceneryExposure,
    );
  }

  /** Load the beats nearest the current time first. */
  preloadFor(seat: SeatDef) {
    if (seat.view === 'no-window') return;
    const beats = BEATS[seat.side];
    const order = [...beats].sort((a, b) => Math.abs((a.hold[0] + a.hold[1]) / 2 - this.minutes) - Math.abs((b.hold[0] + b.hold[1]) / 2 - this.minutes));
    void this.library.preload([...new Set(order.map((b) => b.imageId))]);
  }

  /* ------------------------------ overlays ------------------------------ */

  private toScreen(world: THREE.Vector3, cam: THREE.Camera = this.camera) {
    this.v.copy(world).project(cam);
    return { x: ((this.v.x + 1) / 2) * this.layout.width, y: ((1 - this.v.y) / 2) * this.layout.height };
  }

  shadeHandle(): ShadeHandleInfo | null {
    if (!this.settledPreview || !this.seat || this.seat.view === 'no-window') return null;
    const cur = this.toScreen(this.cabin.shadeEdgeWorld(this.shade));
    const open = this.toScreen(this.cabin.shadeEdgeWorld(0));
    const closed = this.toScreen(this.cabin.shadeEdgeWorld(1));
    const l = this.toScreen(this.cabin.windowLocalToWorld(-0.11, 0, 0));
    const r = this.toScreen(this.cabin.windowLocalToWorld(0.11, 0, 0));
    return { x: cur.x, y: cur.y, yOpen: open.y, yClosed: closed.y, width: Math.abs(r.x - l.x) };
  }

  hintAnchor() {
    if (!this.settledPreview || !this.seat || this.seat.view === 'no-window') return null;
    return this.toScreen(this.cabin.hoodWorld());
  }

  /* ------------------------------ loop ------------------------------ */

  requestRender() {
    this.needsRender = true;
    this.kick();
  }

  private kick() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    this.raf = 0;
    if (document.hidden) {
      this.last = 0;
      return;
    }
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    let animating = false;

    if (this.p !== this.target) {
      const step = dt / this.duration;
      this.p = this.target > this.p ? Math.min(1, this.p + step) : Math.max(0, this.p - step);
      this.events.onProgress(this.p, this.target);
      if (this.p === this.target) this.events.onSettled(this.target === 1 ? 'preview' : 'map');
      else animating = true;
      this.needsRender = true;
    }

    // pan inertia / smoothing
    if (!this.dragging) {
      if (Math.abs(this.panVel) > 0.05) {
        const next = clamp(this.panTarget + this.panVel * dt, this.frame.panMin, this.frame.panMax);
        if (next === this.panTarget) this.panVel = 0;
        this.panTarget = next;
        this.panVel *= Math.exp(-dt * 5);
        animating = true;
      } else this.panVel = 0;
      const diff = this.panTarget - this.pan;
      if (Math.abs(diff) > 0.0005) {
        this.pan += diff * (1 - Math.exp(-dt * 14));
        animating = true;
        this.needsRender = true;
      } else if (diff !== 0) {
        this.pan = this.panTarget;
        this.needsRender = true;
      }
    }

    if (this.needsRender) {
      this.needsRender = false;
      this.renderFrame();
      this.events.onFrame();
      if (animating) this.adapt(dt);
    }
    if (animating) this.kick();
  };

  /** Drop the pixel ratio a little if continuous rendering cannot hold ~45 fps. */
  private adapt(dt: number) {
    this.frameCount++;
    if (dt > 1 / 40) this.slowFrames++;
    if (this.frameCount >= 30) {
      if (this.slowFrames > 18 && this.pixelRatio > 1) {
        this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.setSize(this.layout.width, this.layout.height, false);
        this.resizeTargets();
      }
      this.frameCount = 0;
      this.slowFrames = 0;
    }
  }

  /** Map renders untone-mapped (stylised white sculpture); the cabin uses Neutral tone mapping. */
  private draw(which: 'map' | 'cabin', camera: THREE.Camera) {
    this.renderer.toneMapping = which === 'map' ? THREE.NoToneMapping : THREE.NeutralToneMapping;
    this.renderer.render(which === 'map' ? this.map.scene : this.cabin.scene, camera);
  }

  private renderFrame() {
    const r = this.renderer;
    const mp = this.currentMapPose();
    if (this.p === 0 || !this.seatPose) {
      applyPose(this.camera, mp);
      this.draw('map', this.camera);
      return;
    }
    const sp = this.seatPose;
    if (this.p === 1) {
      applyPose(this.camera, sp);
      this.cabin.setCameraPosition(this.camera.position);
      this.draw('cabin', this.camera);
      return;
    }
    if (this.reduced) {
      applyPose(this.camera, mp);
      applyPose(this.camB, sp);
      this.cabin.setCameraPosition(this.camB.position);
      this.compositor.render(r, { scene: this.map.scene, camera: this.camera }, { scene: this.cabin.scene, camera: this.camB }, this.p, 0, this.center.set(0.5, 0.5));
      return;
    }
    const pose = transitionPose(mp, sp, this.p, this.tmpPose);
    applyPose(this.camera, pose);
    this.cabin.setCameraPosition(this.camera.position);
    const mix = transitionMix(this.p);
    const blur = transitionBlur(this.p) * 0.16;
    if (blur < 0.003 && (mix <= 0 || mix >= 1)) {
      this.draw(mix >= 1 ? 'cabin' : 'map', this.camera);
      return;
    }
    this.v.copy(pose.target).project(this.camera);
    this.center.set(clamp((this.v.x + 1) / 2, 0.15, 0.85), clamp((this.v.y + 1) / 2, 0.15, 0.85));
    this.compositor.render(
      r,
      mix < 1 ? { scene: this.map.scene, camera: this.camera } : null,
      mix > 0 ? { scene: this.cabin.scene, camera: this.camera } : null,
      mix,
      blur,
      this.center,
    );
  }

  /** Debug/test helper: current camera pose. */
  debugPose() {
    return this.seatPose ? clonePose(this.seatPose) : null;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.compositor.dispose();
    this.renderer.dispose();
  }
}
