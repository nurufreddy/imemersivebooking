import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { BRAND } from '../../config/brand';
import { CABIN, SCENERY } from '../../config/demoFlight';
import type { BeatLight, SeatDef } from '../../config/types';
import { clamp } from '../../logic/timeline';
import { makeFabricTextures, makeGrainNormal } from '../textures';
import { buildArmrest, buildRowFrame, buildSeatParts } from './SeatModel';
import { coverTransform, createBackdropMaterial, createSkyMaterial, createWingGeometry, createWingMaterial } from './Scenery';
import { OPENING_BOTTOM, OPENING_TOP, WINDOW, WindowGeometries, WindowUnit, createWindowMaterials, wallPanelGeometry } from './WindowUnit';

/** Detailed cabin dimensions (metres). Lateral values match the seat-map sculpture. */
export const CAB = {
  pitch: 0.78,
  /** Window opening plane (the trim's local z = 0). The wall surface sits WINDOW.wallZ inboard. */
  wallX: -1.776,
  windowY: 1.22,
  /** Window centre relative to its row's seat centre. */
  windowDZ: -0.12,
  beltBottom: 0.56,
  binBottom: 1.66,
  binTop: 2.07,
  binFront: -1.38,
  span: 4,
  seatX: [-1.444, -0.973, -0.494],
  armX: [-1.68, -1.2085, -0.7335, -0.258],
};

/** Wall surface (port side, segment-local x). */
export const wallSurfaceX = CAB.wallX + WINDOW.wallZ;
/** Window centre z for detailed row offset k (segment-local, selected row = 0). */
export const zWin = (k: number) => k * CAB.pitch + CAB.windowDZ;

/** Geometry the wall-view camera is solved against (also used by tests). */
export function wallViewGeometry() {
  return {
    cameraDistance: 1.72,
    eyeY: 1.12,
    topY: CAB.binBottom - 0.004,
    topDepth: 0.03,
    bottomY: 0.668,
    bottomDepth: Math.abs(CAB.armX[1] - CAB.wallX),
    minWallWidth: 1.38,
  };
}
const PLANE_DISTANCE = 25;

const K = { hemi: 0.85, env: 0.22, window: 6.5, strip: 6, led: 1.6 };

/** Beat lighting resolved to linear colours (interpolated between beats along the timeline). */
export interface CabinLight {
  window: THREE.Color;
  windowIntensity: number;
  ambient: THREE.Color;
  ambientIntensity: number;
  stripIntensity: number;
  sceneryExposure: number;
  haze: number;
  hazeColor: THREE.Color;
  saturation: number;
  contrast: number;
  tint: THREE.Color;
  skyTint: THREE.Color;
  skyTintAmount: number;
}

export function createCabinLight(): CabinLight {
  return { window: new THREE.Color(), windowIntensity: 1, ambient: new THREE.Color(), ambientIntensity: 1, stripIntensity: 1, sceneryExposure: 1, haze: 0, hazeColor: new THREE.Color(), saturation: 1, contrast: 1, tint: new THREE.Color(1, 1, 1), skyTint: new THREE.Color(1, 1, 1), skyTintAmount: 0 };
}

const _ca = new THREE.Color();
const _cb = new THREE.Color();
/** Interpolate two beat lights in linear colour space. */
export function resolveLight(a: BeatLight, b: BeatLight, t: number, out: CabinLight): CabinLight {
  const lerp = THREE.MathUtils.lerp;
  out.window.copy(_ca.set(a.window)).lerp(_cb.set(b.window), t);
  out.ambient.copy(_ca.set(a.ambient)).lerp(_cb.set(b.ambient), t);
  out.windowIntensity = lerp(a.windowIntensity, b.windowIntensity, t);
  out.ambientIntensity = lerp(a.ambientIntensity, b.ambientIntensity, t);
  out.stripIntensity = lerp(a.stripIntensity, b.stripIntensity, t);
  out.sceneryExposure = lerp(a.sceneryExposure, b.sceneryExposure, t);
  out.haze = lerp(a.haze, b.haze, t);
  out.hazeColor.copy(_ca.set(a.hazeColor)).lerp(_cb.set(b.hazeColor), t);
  out.saturation = lerp(a.saturation, b.saturation, t);
  out.contrast = lerp(a.contrast, b.contrast, t);
  out.tint.copy(_ca.set(a.tint)).lerp(_cb.set(b.tint), t);
  out.skyTint.copy(_ca.set(a.skyTint)).lerp(_cb.set(b.skyTint), t);
  out.skyTintAmount = lerp(a.skyTintAmount, b.skyTintAmount, t);
  return out;
}

const WHITE = new THREE.Color('#ffffff');
const SKY_DEEP = new THREE.Color('#2f4f86');
const SKY_BLUE = new THREE.Color('#9db4d8');
const SKY_TOP = new THREE.Color('#33558c');
const STRIP = new THREE.Color('#ffe6c6');
const SKY_HORIZON = new THREE.Color('#b9cde6');

export class Cabin {
  readonly scene = new THREE.Scene();
  private readonly segment = new THREE.Group();
  private readonly lights = new THREE.Group();
  private readonly windowGeo = new WindowGeometries();
  private readonly units: WindowUnit[] = [];
  private readonly bays: THREE.Mesh[] = [];
  private readonly wallHole: THREE.BufferGeometry;
  private readonly wallPlain: THREE.BufferGeometry;
  private readonly seatMeshes: THREE.InstancedMesh[] = [];
  private armrests!: THREE.InstancedMesh;
  private frames!: THREE.InstancedMesh;
  private readonly hemi: THREE.HemisphereLight;
  private readonly winLights: THREE.RectAreaLight[] = [];
  private readonly stripLight: THREE.RectAreaLight;
  private ledMat!: THREE.MeshStandardMaterial;
  private readonly backdrop: THREE.Mesh;
  private readonly backdropMat = createBackdropMaterial();
  private readonly skyMat = createSkyMaterial();
  private readonly wing: THREE.Mesh;
  private readonly wingMat = createWingMaterial();
  private seat: SeatDef | null = null;
  private targetIndex = CAB.span;
  private mirror = 1;
  private shade = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private planeAspect = 0.85;
  private currentLight: CabinLight | null = null;
  private readonly glow = new THREE.Color();

  constructor(env: THREE.Texture) {
    RectAreaLightUniformsLib.init();
    this.scene.environment = env;
    this.scene.add(this.segment, this.lights);

    const grain = makeGrainNormal();
    grain.repeat.set(1, 1);
    const windowMats = createWindowMaterials(grain);
    const wallMat = new THREE.MeshStandardMaterial({ color: '#d4cec5', roughness: 0.74, metalness: 0, normalMap: grain, normalScale: new THREE.Vector2(0.1, 0.1) });

    // window bays (wall panel + window unit per row position)
    this.wallHole = wallPanelGeometry(CAB.pitch + 0.002, CAB.beltBottom, CAB.binBottom, CAB.windowY, true);
    this.wallPlain = wallPanelGeometry(CAB.pitch + 0.002, CAB.beltBottom, CAB.binBottom, CAB.windowY, false);
    for (let k = -CAB.span; k <= CAB.span; k++) {
      const bay = new THREE.Mesh(this.wallHole, wallMat);
      bay.rotation.y = Math.PI / 2;
      bay.position.set(CAB.wallX, CAB.windowY, zWin(k));
      this.segment.add(bay);
      this.bays.push(bay);
      const unit = new WindowUnit(this.windowGeo, windowMats, true);
      unit.group.rotation.y = Math.PI / 2;
      unit.group.position.set(CAB.wallX, CAB.windowY, zWin(k));
      this.segment.add(unit.group);
      this.units.push(unit);
    }
    // extra plain panels so wide views never see the end of the segment
    for (const k of [-CAB.span - 1, CAB.span + 1]) {
      const bay = new THREE.Mesh(this.wallPlain, wallMat);
      bay.rotation.y = Math.PI / 2;
      bay.position.set(CAB.wallX, CAB.windowY, zWin(k));
      this.segment.add(bay);
    }

    const zMin = zWin(-CAB.span - 1) - CAB.pitch / 2;
    const zMax = zWin(CAB.span + 1) + CAB.pitch / 2;
    const length = zMax - zMin;
    const zMid = (zMin + zMax) / 2;

    // panel seams
    const seamMat = new THREE.MeshStandardMaterial({ color: '#a59f96', roughness: 0.8 });
    const seamCount = 2 * CAB.span + 4;
    const seams = new THREE.InstancedMesh(new THREE.BoxGeometry(0.004, CAB.binBottom - CAB.beltBottom, 0.0035), seamMat, seamCount);
    for (let i = 0; i < seamCount; i++) {
      const z = zWin(-CAB.span - 1) - CAB.pitch / 2 + i * CAB.pitch;
      this.tmpM.makeTranslation(wallSurfaceX + 0.0012, (CAB.binBottom + CAB.beltBottom) / 2, z);
      seams.setMatrixAt(i, this.tmpM);
    }
    this.segment.add(seams);

    // dado ledge, lower sidewall and floor grille
    const lowerMat = new THREE.MeshStandardMaterial({ color: '#cfc8be', roughness: 0.8 });
    const lower = new THREE.Mesh(new THREE.PlaneGeometry(length, CAB.beltBottom), lowerMat);
    lower.rotation.y = Math.PI / 2;
    lower.position.set(wallSurfaceX - 0.02, CAB.beltBottom / 2, zMid);
    this.segment.add(lower);
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(length, 0.06), new THREE.MeshStandardMaterial({ color: '#5d5a56', roughness: 0.9 }));
    grille.rotation.y = Math.PI / 2;
    grille.position.set(wallSurfaceX - 0.018, 0.08, zMid);
    this.segment.add(grille);

    // carpet
    const carpetMat = new THREE.MeshStandardMaterial({ color: '#4a5263', roughness: 1, normalMap: grain, normalScale: new THREE.Vector2(0.6, 0.6) });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(3.2, length), carpetMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(wallSurfaceX + 1.6 - 0.02, 0, zMid);
    this.segment.add(floor);

    // overhead bins with curved doors, door seams and latches
    const binMat = new THREE.MeshStandardMaterial({ color: '#ece8e1', roughness: 0.55, metalness: 0, normalMap: grain, normalScale: new THREE.Vector2(0.08, 0.08) });
    const binShape = new THREE.Shape();
    binShape.moveTo(wallSurfaceX - 0.01, CAB.binBottom);
    binShape.lineTo(CAB.binFront - 0.012, CAB.binBottom);
    binShape.quadraticCurveTo(CAB.binFront + 0.06, CAB.binBottom + 0.2, CAB.binFront - 0.07, CAB.binTop);
    binShape.lineTo(wallSurfaceX - 0.01, CAB.binTop);
    binShape.closePath();
    const binGeo = new THREE.ExtrudeGeometry(binShape, { depth: length, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 2, curveSegments: 18 });
    binGeo.translate(0, 0, zMin);
    this.segment.add(new THREE.Mesh(binGeo, binMat));

    const doorLen = CAB.pitch * 2;
    const seamShape = new THREE.Shape();
    seamShape.moveTo(CAB.binFront - 0.004, CAB.binBottom + 0.003);
    seamShape.quadraticCurveTo(CAB.binFront + 0.068, CAB.binBottom + 0.2, CAB.binFront - 0.062, CAB.binTop - 0.004);
    seamShape.lineTo(CAB.binFront - 0.078, CAB.binTop - 0.004);
    seamShape.quadraticCurveTo(CAB.binFront + 0.05, CAB.binBottom + 0.2, CAB.binFront - 0.02, CAB.binBottom + 0.003);
    seamShape.closePath();
    const seamGeo = new THREE.ExtrudeGeometry(seamShape, { depth: 0.006, bevelEnabled: false, curveSegments: 18 });
    const doorSeamMat = new THREE.MeshStandardMaterial({ color: '#8e8981', roughness: 0.7 });
    const doorSeams: THREE.Mesh[] = [];
    const latchMat = new THREE.MeshStandardMaterial({ color: '#a39d94', roughness: 0.45 });
    for (let n = -3; n <= 3; n++) {
      const m = new THREE.Mesh(seamGeo, doorSeamMat);
      m.position.z = zMid + doorLen / 2 + n * doorLen - 0.003;
      this.segment.add(m);
      doorSeams.push(m);
      const latch = new THREE.Mesh(new RoundedBoxGeometry(0.018, 0.026, 0.13, 3, 0.008), latchMat);
      latch.position.set(CAB.binFront + 0.004, CAB.binBottom + 0.022, zMid + n * doorLen);
      this.segment.add(latch);
    }

    // warm LED strip where the bins meet the wall
    this.ledMat = new THREE.MeshStandardMaterial({ color: '#fff6ea', emissive: new THREE.Color('#ffe9cf'), emissiveIntensity: 1.6, roughness: 0.4 });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, length), this.ledMat);
    led.position.set(wallSurfaceX + 0.03, CAB.binBottom - 0.004, zMid);
    this.segment.add(led);

    // seats (instanced, RwandAir blue upholstery)
    const fabricTex = makeFabricTextures();
    const fabricMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(BRAND.blue).offsetHSL(0, -0.04, -0.045), map: fabricTex.map, normalMap: fabricTex.normalMap, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.93, metalness: 0, vertexColors: true });
    const coverMat = new THREE.MeshStandardMaterial({ color: '#f2efe9', map: fabricTex.map, normalMap: fabricTex.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.95, vertexColors: true });
    const shellMat = new THREE.MeshStandardMaterial({ color: '#9a9b9c', roughness: 0.5, metalness: 0, vertexColors: true });
    const trayMat = new THREE.MeshStandardMaterial({ color: '#b3b3b1', roughness: 0.45, vertexColors: true });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#4c4e52', roughness: 0.85, vertexColors: true });
    const parts = buildSeatParts();
    const seatCount = (2 * CAB.span + 1) * 3;
    for (const [geo, mat] of [[parts.fabric, fabricMat], [parts.cover, coverMat], [parts.shell, shellMat], [parts.tray, trayMat], [parts.dark, darkMat]] as const) {
      const mesh = new THREE.InstancedMesh(geo, mat, seatCount);
      this.seatMeshes.push(mesh);
      this.segment.add(mesh);
    }
    const armMat = new THREE.MeshStandardMaterial({ color: '#a2a3a4', roughness: 0.45, vertexColors: true });
    this.armrests = new THREE.InstancedMesh(buildArmrest(), armMat, (2 * CAB.span + 1) * 4);
    this.segment.add(this.armrests);
    const frameMat = new THREE.MeshStandardMaterial({ color: '#5e6064', roughness: 0.5, metalness: 0.4, vertexColors: true });
    this.frames = new THREE.InstancedMesh(buildRowFrame(1.45), frameMat, 2 * CAB.span + 1);
    this.segment.add(this.frames);

    // exterior: photo backdrop for the target window, sky dome for every other view
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.backdropMat);
    this.backdrop.rotation.y = Math.PI / 2;
    this.segment.add(this.backdrop);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), this.skyMat);
    sky.position.set(0, 1, 0);
    this.segment.add(sky);
    this.wing = new THREE.Mesh(createWingGeometry(), this.wingMat);
    this.segment.add(this.wing);

    // lights live outside the (possibly mirrored) segment
    this.hemi = new THREE.HemisphereLight('#fff6ec', '#9a948c', 1);
    this.lights.add(this.hemi);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.RectAreaLight('#ffffff', 0, 0.23, 0.3);
      this.lights.add(l);
      this.winLights.push(l);
    }
    this.stripLight = new THREE.RectAreaLight('#ffe7c8', 0, length, 0.05);
    this.lights.add(this.stripLight);
  }

  /* ------------------------------ configuration ------------------------------ */

  /** Arrange the detailed segment around a seat (mirrored for the starboard side). */
  configure(seat: SeatDef, rowZ: number) {
    this.seat = seat;
    this.mirror = seat.side === 'starboard' ? -1 : 1;
    this.segment.position.set(0, 0, rowZ);
    this.segment.scale.set(this.mirror, 1, 1);
    this.segment.updateMatrixWorld(true);

    const missing = CABIN.missingWindowRows[seat.side];
    for (let i = 0; i < this.units.length; i++) {
      const k = i - CAB.span;
      const row = seat.row + k;
      const inCabin = row >= 1 && row <= CABIN.rows;
      const hasWindow = inCabin && !missing.includes(row);
      this.bays[i].geometry = hasWindow ? this.wallHole : this.wallPlain;
      this.units[i].group.visible = hasWindow;
      this.units[i].setShade(k === 0 ? this.shade : 0);
      this.units[i].updateClip();
    }
    this.targetIndex = CAB.span;

    // seats: hide the ones between a wall-view camera and the wall; in a window close-up the
    // camera is the passenger's head, so their own row and the seat in front stay out of frame
    const wallView = seat.view === 'no-window';
    const windowView = !wallView;
    let s = 0;
    let a = 0;
    for (let k = -CAB.span; k <= CAB.span; k++) {
      const row = seat.row + k;
      const inCabin = row >= 1 && row <= CABIN.rows;
      for (let c = 0; c < 3; c++) {
        const hide = !inCabin || (wallView && c > 0 && Math.abs(k) <= 1) || (windowView && (k === 0 || (k === -1 && c === 0)));
        if (hide) this.tmpM.copy(this.hidden);
        else this.tmpM.makeTranslation(CAB.seatX[c], 0, k * CAB.pitch);
        for (const m of this.seatMeshes) m.setMatrixAt(s, this.tmpM);
        s++;
      }
      for (let c = 0; c < 4; c++) {
        const hide = !inCabin || (wallView && c !== 1 && Math.abs(k) <= 1) || (windowView && (k === 0 || (k === -1 && c < 2)));
        if (hide) this.tmpM.copy(this.hidden);
        else this.tmpM.makeTranslation(CAB.armX[c], 0, k * CAB.pitch);
        this.armrests.setMatrixAt(a++, this.tmpM);
      }
      if (!inCabin || (wallView && Math.abs(k) <= 1) || (windowView && k === 0)) this.tmpM.copy(this.hidden);
      else this.tmpM.makeTranslation((CAB.seatX[0] + CAB.seatX[2]) / 2, 0, k * CAB.pitch);
      this.frames.setMatrixAt(k + CAB.span, this.tmpM);
    }
    for (const m of this.seatMeshes) m.instanceMatrix.needsUpdate = true;
    this.armrests.instanceMatrix.needsUpdate = true;
    this.frames.instanceMatrix.needsUpdate = true;

    // exterior
    this.backdrop.visible = seat.view !== 'no-window';
    this.backdrop.position.set(CAB.wallX - PLANE_DISTANCE, CAB.windowY, zWin(0));
    // wing root spans the wing rows in the detailed (real-pitch) coordinates;
    // only over-wing seats show it (the reference's 23A view has no wing)
    const first = CABIN.wingRows[0];
    this.wing.position.set(-1.95, -0.45, (first - seat.row) * CAB.pitch - 0.45);
    this.wing.visible = seat.view === 'wing';

    this.placeLights();
    this.applyLight();
  }

  /** Scale the photo plane so the opening sees ~77% of it from the final camera distance. */
  fitBackdrop(cameraDistance: number) {
    const k = (cameraDistance + PLANE_DISTANCE) / cameraDistance;
    const visW = WINDOW.w * k;
    const visH = (OPENING_TOP - OPENING_BOTTOM) * k;
    this.backdrop.scale.set(visW * 1.3, visH * 1.3, 1);
    // centre the visible opening vertically on the plane
    this.backdrop.position.y = CAB.windowY + ((OPENING_TOP + OPENING_BOTTOM) / 2) * k;
    this.planeAspect = (visW * 1.3) / (visH * 1.3);
  }

  private placeLights() {
    const m = this.mirror;
    const rowZ = this.segment.position.z;
    const view = this.seat?.view;
    const place = (light: THREE.RectAreaLight, k: number, on: boolean) => {
      light.userData.on = on;
      if (!on) return;
      const x = m * (CAB.wallX - 0.035);
      light.position.set(x, CAB.windowY, rowZ + zWin(k));
      light.lookAt(x + m, CAB.windowY, rowZ + zWin(k));
      light.userData.baseY = CAB.windowY;
    };
    const unitOn = (k: number) => this.units[k + CAB.span]?.group.visible ?? false;
    if (view === 'no-window') {
      place(this.winLights[0], -1, unitOn(-1));
      place(this.winLights[1], 1, unitOn(1));
    } else {
      place(this.winLights[0], 0, true);
      place(this.winLights[1], 0, false);
    }
    // looking down-and-inboard with world-up, the light's local X (its width) runs along the cabin
    const sx = m * (wallSurfaceX + 0.05);
    this.stripLight.position.set(sx, CAB.binBottom - 0.012, rowZ + zWin(0));
    this.stripLight.lookAt(sx + m * 0.3, CAB.binBottom - 1, rowZ + zWin(0));
  }

  /* ------------------------------ timeline-driven state ------------------------------ */

  setLight(light: CabinLight) {
    this.currentLight = light;
    this.applyLight();
  }

  setShade(s: number) {
    this.shade = clamp(s, 0, 1);
    this.units[this.targetIndex]?.setShade(this.shade);
    this.applyLight();
  }

  private applyLight() {
    const L = this.currentLight;
    if (!L) return;
    const windowColor = L.window;
    const ambient = L.ambient;
    this.hemi.color.copy(ambient);
    // bounce light from floor and seats keeps the undersides of the bins readable
    this.hemi.groundColor.copy(ambient).multiplyScalar(0.72);
    this.hemi.intensity = L.ambientIntensity * K.hemi;
    this.scene.environmentIntensity = L.ambientIntensity * K.env;

    const wallView = this.seat?.view === 'no-window';
    const edgeY = WindowUnit.edgeY(this.shade);
    const visibleTop = Math.min(OPENING_TOP, edgeY);
    const open = Math.max(0, visibleTop - OPENING_BOTTOM) / (OPENING_TOP - OPENING_BOTTOM);
    this.winLights.forEach((light, i) => {
      if (!light.userData.on) {
        light.intensity = 0;
        return;
      }
      light.color.copy(windowColor);
      if (wallView) {
        light.width = 0.24;
        light.height = 0.3;
        light.position.y = CAB.windowY - 0.015;
        light.intensity = L.windowIntensity * K.window * 0.8;
      } else if (i === 0) {
        // the light source shrinks to the uncovered part of the opening as the shade comes down
        const h = Math.max(0.002, visibleTop - OPENING_BOTTOM);
        light.width = 0.235;
        light.height = h;
        light.position.y = CAB.windowY + (visibleTop + OPENING_BOTTOM) / 2;
        light.intensity = L.windowIntensity * K.window * (0.06 + 0.94 * open);
      }
    });
    this.stripLight.color.copy(STRIP);
    this.stripLight.intensity = L.stripIntensity * K.strip;
    this.ledMat.emissiveIntensity = L.stripIntensity * K.led;

    // shade glows faintly with the light behind it
    const unit = this.units[this.targetIndex];
    if (unit) {
      // light passing through the shade: it reads as the brightest, palest surface in the window
      this.glow.copy(windowColor).lerp(WHITE, 0.55).multiplyScalar(0.36 * L.windowIntensity * (this.shade > 0.02 ? 1 : 0));
      unit.shadeMaterial.emissive.copy(this.glow);
    }

    // sky dome tint seen through the other windows
    const sky = this.skyMat.uniforms;
    (sky.horizon.value as THREE.Color).copy(windowColor).lerp(SKY_HORIZON, 0.5).multiplyScalar(Math.min(1, 0.35 + L.windowIntensity * 0.7));
    (sky.top.value as THREE.Color).copy(windowColor).lerp(SKY_DEEP, 0.55).multiplyScalar(Math.min(1, 0.45 + L.windowIntensity * 0.5));
    (sky.bottom.value as THREE.Color).copy(windowColor).multiplyScalar(0.55);

    const wu = this.wingMat.uniforms;
    (wu.sunColor.value as THREE.Color).copy(windowColor);
    wu.sunIntensity.value = Math.min(1.1, L.windowIntensity * 0.75);
    (wu.skyColor.value as THREE.Color).copy(windowColor).lerp(SKY_BLUE, 0.5).multiplyScalar(0.35 + 0.45 * Math.min(1, L.windowIntensity));
    (wu.groundColor.value as THREE.Color).copy(windowColor).multiplyScalar(0.18);
    (wu.sunDir.value as THREE.Vector3).set(-0.35 * this.mirror, 0.55, 0.45).normalize();
  }

  /** Cross-fade the exterior photographs. Textures may be null while loading (sky gradient fallback). */
  setScenery(a: { id: string; tex: THREE.Texture | null; drift: number }, b: { id: string; tex: THREE.Texture | null; drift: number }, t: number, exposure: number) {
    const u = this.backdropMat.uniforms;
    const flip = this.mirror < 0;
    const xf = (id: string, tex: THREE.Texture | null, drift: number, out: THREE.Vector4) => {
      const img = tex?.image as { width: number; height: number } | undefined;
      const def = SCENERY[id];
      const aspect = img ? img.width / img.height : 0.75;
      coverTransform(aspect, this.planeAspect, def?.focus ?? [0.5, 0.5], def?.zoom ?? 1, drift, out);
      if (flip) out.set(-out.x, out.y, out.z + out.x, out.w);
    };
    u.mapA.value = a.tex;
    u.hasA.value = a.tex ? 1 : 0;
    xf(a.id, a.tex, a.drift, u.xfA.value as THREE.Vector4);
    u.mapB.value = b.tex;
    u.hasB.value = b.tex ? 1 : 0;
    xf(b.id, b.tex, b.drift, u.xfB.value as THREE.Vector4);
    u.mixT.value = t;
    u.exposure.value = exposure;
    const L = this.currentLight;
    if (L) {
      u.haze.value = L.haze;
      u.saturation.value = L.saturation;
      u.contrast.value = L.contrast;
      (u.tint.value as THREE.Color).copy(L.tint);
      (u.skyTint.value as THREE.Color).copy(L.skyTint);
      u.skyTintAmount.value = L.skyTintAmount;
      (u.hazeColor.value as THREE.Color).copy(L.hazeColor);
      (u.skyBottom.value as THREE.Color).copy(L.window).multiplyScalar(0.8);
      (u.skyTop.value as THREE.Color).copy(L.window).lerp(SKY_TOP, 0.5);
    }
  }

  setCameraPosition(p: THREE.Vector3) {
    (this.wingMat.uniforms.camPos.value as THREE.Vector3).copy(p);
  }

  /* ------------------------------ queries ------------------------------ */

  /** World position of the target window centre (opening plane). */
  windowCenter(target = new THREE.Vector3()) {
    return target.set(CAB.wallX, CAB.windowY, zWin(0)).applyMatrix4(this.segment.matrixWorld);
  }

  /** World point on the wall surface where the missing window would be. */
  wallPoint(target = new THREE.Vector3()) {
    return target.set(wallSurfaceX, CAB.windowY, zWin(0)).applyMatrix4(this.segment.matrixWorld);
  }

  /** Unit vector from the wall into the cabin. */
  inward(target = new THREE.Vector3()) {
    return target.set(this.mirror, 0, 0);
  }

  get side() {
    return this.mirror > 0 ? 'port' : 'starboard';
  }

  /** World positions along the shade's travel (for the drag handle), at the opening centre. */
  shadeEdgeWorld(s: number, target = new THREE.Vector3()) {
    const unit = this.units[this.targetIndex];
    unit.group.updateWorldMatrix(true, false);
    return target.set(0, WindowUnit.edgeY(s), WINDOW.shadeZ + 0.01).applyMatrix4(unit.group.matrixWorld);
  }

  /** World position of the hood's pill (hint anchor). */
  hoodWorld(target = new THREE.Vector3()) {
    const unit = this.units[this.targetIndex];
    unit.group.updateWorldMatrix(true, false);
    return target.set(0, WINDOW.hoodY + 0.019, 0.012).applyMatrix4(unit.group.matrixWorld);
  }

  /** Geometry used by the wall-view camera solver. */
  wallViewGeometry() {
    return wallViewGeometry();
  }

  opening() {
    return { top: OPENING_TOP, bottom: OPENING_BOTTOM, width: WINDOW.w };
  }

  dispose() {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }

  /** Point in the target window's local frame → world. */
  windowLocalToWorld(x: number, y: number, z: number, target = this.tmp) {
    const unit = this.units[this.targetIndex];
    unit.group.updateWorldMatrix(true, false);
    return target.set(x, y, z).applyMatrix4(unit.group.matrixWorld);
  }
}
