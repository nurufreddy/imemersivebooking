import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRAND } from '../../config/brand';
import { CABIN, SEATS } from '../../config/demoFlight';
import type { SeatDef, SeatLetter } from '../../config/types';
import { makeCheck, makeLabel, makeRowNumbers, makeSoftShadow } from '../textures';
import { bakeVerticalAO, roundedRectShape, roundedRectPath } from '../geometry';

/**
 * Seat-map dimensions (metres). Lateral positions follow a real single-aisle
 * cabin; the row pitch matches the reference sculpture, which is drawn
 * slightly compressed along the fuselage.
 */
export const MAP = {
  pitch: 0.6126,
  row1Z: 0,
  seatX: { A: -1.444, B: -0.973, C: -0.494, D: 0.494, E: 0.973, F: 1.444 } as Record<SeatLetter, number>,
  outerHalf: 1.976,
  innerHalf: 1.766,
  rimY: 0.62,
  seatTopY: 0.36,
  cabinFront: -1.75,
  cabinRear: 17.8,
};

export const rowZ = (row: number) => MAP.row1Z + (row - 1) * MAP.pitch;

export type SeatVisual = 'available' | 'taken' | 'selected' | 'confirmed';

const COLORS = {
  available: new THREE.Color('#ffffff'),
  availableBack: new THREE.Color('#e2e2df'),
  taken: new THREE.Color('#b3b4af'),
  takenBack: new THREE.Color('#9b9c97'),
  hover: new THREE.Color(BRAND.blueSoft),
  hoverBack: new THREE.Color('#d5e3f3'),
  selected: new THREE.Color(BRAND.blue),
  selectedBack: new THREE.Color('#003f7a'),
};

export class AircraftMap {
  readonly scene = new THREE.Scene();
  private cushions!: THREE.InstancedMesh;
  private backs!: THREE.InstancedMesh;
  private focusRing!: THREE.Mesh;
  private check!: THREE.Mesh;
  private readonly seatIndex = new Map<string, number>();
  private readonly lift: number[] = [];
  private hovered: string | null = null;
  private selected: string | null = null;
  private confirmed: string | null = null;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpS = new THREE.Vector3(1, 1, 1);
  private readonly tmpP = new THREE.Vector3();

  constructor(env: THREE.Texture, monoFont: string) {
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.35;
    this.build(monoFont);
  }

  private build(monoFont: string) {
    const s = this.scene;
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, metalness: 0 });

    // lights: soft, mostly ambient, gentle key from the front-left
    // rendered without tone mapping: tops reach white, rounded edges and sides fall off softly
    const hemi = new THREE.HemisphereLight('#ffffff', '#7c7d78', 2.3);
    s.add(hemi);
    const key = new THREE.DirectionalLight('#ffffff', 1.0);
    key.position.set(-6, 22, -9);
    s.add(key);
    const fill = new THREE.DirectionalLight('#ffffff', 0.25);
    fill.position.set(8, 14, 12);
    s.add(fill);

    // ground + baked soft shadow of the whole aircraft
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: '#eff0eb' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.2;
    s.add(ground);
    this.addGroundShadow();

    // fuselage shell: outer outline with the cabin cut out, extruded down from the rim
    const outer = fuselageOutline(MAP.outerHalf);
    const inner = fuselageOutline(MAP.innerHalf, true);
    const shellShape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, p.y)));
    shellShape.holes.push(new THREE.Path(inner.map((p) => new THREE.Vector2(p.x, p.y))));
    const shellGeo = new THREE.ExtrudeGeometry(shellShape, {
      depth: 2.0, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 3, curveSegments: 1,
    });
    shellGeo.rotateX(Math.PI / 2); // shape XY → world XZ (shape y = world z), extrude downward
    shellGeo.translate(0, MAP.rimY, 0);
    const shell = new THREE.Mesh(shellGeo, white);
    s.add(shell);

    // cabin floor with baked contact shadows under seats
    // ShapeGeometry faces +Z; build it mirrored (shape y = -world z) so rotateX(-90°) faces it up.
    const floorShape = new THREE.Shape(inner.map((p) => new THREE.Vector2(p.x, -p.y)));
    const floorGeo = new THREE.ShapeGeometry(floorShape);
    floorGeo.rotateX(-Math.PI / 2);
    const floorBounds = { minX: -MAP.innerHalf, maxX: MAP.innerHalf, minZ: -8.5, maxZ: 26 };
    remapUV(floorGeo, floorBounds);
    const floorAO = this.makeFloorAO(floorBounds);
    const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: '#d6d7d2', roughness: 0.95, map: floorAO }));
    floor.position.y = 0.001;
    s.add(floor);

    // window slits along the rim (A-side row 11 has none: the "missing window")
    const slitGeo = new RoundedBoxGeometry(0.1, 0.02, 0.37, 2, 0.016);
    const slitMat = new THREE.MeshStandardMaterial({ color: '#9aa5b4', roughness: 0.6 });
    const slitRows: [number, number][] = [];
    for (let r = 1; r <= CABIN.rows; r++) {
      if (!CABIN.missingWindowRows.port.includes(r)) slitRows.push([r, -1]);
      if (!CABIN.missingWindowRows.starboard.includes(r)) slitRows.push([r, 1]);
    }
    const slits = new THREE.InstancedMesh(slitGeo, slitMat, slitRows.length);
    const midRim = (MAP.innerHalf + MAP.outerHalf) / 2;
    slitRows.forEach(([r, side], i) => {
      this.tmpM.makeTranslation(side * midRim, MAP.rimY + 0.03, rowZ(r) - 0.12);
      slits.setMatrixAt(i, this.tmpM);
    });
    s.add(slits);

    // galley blocks
    const galleyMat = new THREE.MeshStandardMaterial({ color: '#d4d5d0', roughness: 0.9 });
    const galleyLabel = makeLabel('GALLEY', monoFont);
    const addGalley = (z: number, w: number) => {
      const g = new THREE.Mesh(new RoundedBoxGeometry(w, 0.1, 0.68, 3, 0.05), galleyMat);
      g.position.set(0, 0.05, z);
      s.add(g);
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 0.24),
        new THREE.MeshBasicMaterial({ map: galleyLabel, transparent: true, depthWrite: false }),
      );
      label.rotation.x = -Math.PI / 2;
      label.position.set(0, 0.104, z + 0.02);
      s.add(label);
    };
    addGalley(-1.13, 2.96);
    addGalley(rowZ(CABIN.rows) + 2.8, 2.6);

    // row numbers down the aisle
    const nums = makeRowNumbers(CABIN.rows, MAP.pitch, 1.0, rowZ(CABIN.rows) + 2, monoFont);
    const numPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(nums.width, nums.height),
      new THREE.MeshBasicMaterial({ map: nums.texture, transparent: true, depthWrite: false }),
    );
    numPlane.rotation.x = -Math.PI / 2;
    numPlane.position.set(0, 0.004, -1.0 + nums.height / 2);
    s.add(numPlane);

    // wings and engines
    const wingBounds = { minX: -18, maxX: 18, minZ: 2, maxZ: 15 };
    const wingShade = makeSoftShadow(wingBounds, 16, (ctx, toPx, k) => {
      const [x0, y0] = toPx(-MAP.outerHalf - 0.25, wingBounds.minZ);
      ctx.fillRect(x0, y0, (MAP.outerHalf + 0.25) * 2 * k, (wingBounds.maxZ - wingBounds.minZ) * k);
    }, 9, 3);
    {
      const c = wingShade.image as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const img = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 255 - img.data[i] * 0.16;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);
      wingShade.colorSpace = THREE.SRGBColorSpace;
      wingShade.needsUpdate = true;
    }
    const wingMat = new THREE.MeshStandardMaterial({ color: '#d8d9d4', roughness: 0.75, map: wingShade });
    for (const side of [-1, 1]) {
      const wingGeo = makeWingGeometry(side);
      remapUV(wingGeo, wingBounds);
      const wing = new THREE.Mesh(wingGeo, wingMat);
      s.add(wing);
      const engine = makeEngine(white);
      engine.position.set(side * 4.64, -1.05, 4.69);
      s.add(engine);
      const tailGeo = makeTailplaneGeometry(side);
      remapUV(tailGeo, wingBounds);
      const tailplane = new THREE.Mesh(tailGeo, wingMat);
      s.add(tailplane);
    }

    // seats (instanced): cushion + backrest, plus static armrests
    const cushionGeo = new RoundedBoxGeometry(0.44, 0.1, 0.35, 2, 0.05);
    bakeVerticalAO(cushionGeo, -0.05, 0.05, 0.55, 1);
    const backGeo = new RoundedBoxGeometry(0.44, 0.16, 0.11, 2, 0.045);
    bakeVerticalAO(backGeo, -0.08, 0.08, 0.5, 1);
    const seatMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.78, metalness: 0, vertexColors: true });
    this.cushions = new THREE.InstancedMesh(cushionGeo, seatMat, SEATS.length);
    this.backs = new THREE.InstancedMesh(backGeo, seatMat, SEATS.length);
    SEATS.forEach((seat, i) => {
      this.seatIndex.set(seat.id, i);
      this.lift.push(0);
    });
    this.refreshSeatMatrices();
    this.refreshSeatColors();
    s.add(this.cushions, this.backs);

    const armGeos: THREE.BufferGeometry[] = [];
    for (let r = 1; r <= CABIN.rows; r++) {
      for (const block of [['A', 'B', 'C'], ['D', 'E', 'F']] as SeatLetter[][]) {
        const xs = block.map((l) => MAP.seatX[l]);
        const edges = [xs[0] - 0.236, (xs[0] + xs[1]) / 2, (xs[1] + xs[2]) / 2, xs[2] + 0.236];
        for (const x of edges) {
          const g = new RoundedBoxGeometry(0.026, 0.08, 0.36, 2, 0.012);
          g.translate(x, 0.38, rowZ(r) - 0.03);
          armGeos.push(g);
        }
      }
    }
    const arms = new THREE.Mesh(mergeGeometries(armGeos), new THREE.MeshStandardMaterial({ color: '#aeaeaa', roughness: 0.8 }));
    s.add(arms);

    // keyboard focus ring (rounded outline) and confirmed check decal
    const ringShape = roundedRectShape(0.56, 0.58, 0.12);
    ringShape.holes.push(roundedRectPath(0.48, 0.5, 0.09));
    const ringGeo = new THREE.ShapeGeometry(ringShape, 8);
    ringGeo.rotateX(-Math.PI / 2);
    this.focusRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: BRAND.blueBright, transparent: true, opacity: 0.95, depthTest: false }));
    this.focusRing.renderOrder = 10;
    this.focusRing.visible = false;
    s.add(this.focusRing);

    this.check = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({ map: makeCheck(), transparent: true, depthWrite: false }),
    );
    this.check.rotation.x = -Math.PI / 2;
    this.check.visible = false;
    s.add(this.check);
  }

  private makeFloorAO(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    // dark = occluded. Draw seat footprints + wall edges, blur, then invert to an AO map.
    const tex = makeSoftShadow(bounds, 40, (ctx, toPx, k) => {
      for (const seat of SEATS) {
        const [x, y] = toPx(MAP.seatX[seat.letter] - 0.24, rowZ(seat.row) - 0.27);
        ctx.fillRect(x, y, 0.48 * k, 0.52 * k);
      }
      // walls
      ctx.fillRect(0, 0, 0.09 * k, ctx.canvas.height);
      ctx.fillRect(ctx.canvas.width - 0.09 * k, 0, 0.09 * k, ctx.canvas.height);
    }, 5, 3);
    const c = tex.image as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const img = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 255 - img.data[i] * 0.13;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  private addGroundShadow() {
    const bounds = { minX: -20, maxX: 20, minZ: -12, maxZ: 30 };
    const tex = makeSoftShadow(bounds, 10, (ctx, toPx) => {
      const poly = (pts: [number, number][]) => {
        ctx.beginPath();
        pts.forEach(([x, z], i) => {
          const [px, py] = toPx(x, z);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fill();
      };
      poly(fuselageOutline(MAP.outerHalf + 0.15).map((p) => [p.x, p.y] as [number, number]));
      for (const side of [-1, 1]) {
        poly(wingPlanform(side));
        poly(tailPlanform(side));
        poly([[side * 4.2, 3.4], [side * 5.08, 3.4], [side * 5.08, 6.0], [side * 4.2, 6.0]]);
      }
    }, 6, 3);
    const mat = new THREE.MeshBasicMaterial({ color: '#3d4038', alphaMap: tex, transparent: true, opacity: 0.11, depthWrite: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set((bounds.minX + bounds.maxX) / 2, -2.19, (bounds.minZ + bounds.maxZ) / 2);
    this.scene.add(plane);
  }

  /* ------------------------------ seat state ------------------------------ */

  setSeatState(selected: string | null, confirmed: string | null) {
    if (selected === this.selected && confirmed === this.confirmed) return false;
    this.selected = selected;
    this.confirmed = confirmed;
    this.refreshSeatColors();
    this.refreshSeatMatrices();
    this.updateCheck();
    return true;
  }

  setHovered(id: string | null) {
    if (id === this.hovered) return false;
    this.hovered = id;
    this.refreshSeatColors();
    this.refreshSeatMatrices();
    return true;
  }

  setFocusRing(id: string | null) {
    if (!id) {
      const changed = this.focusRing.visible;
      this.focusRing.visible = false;
      return changed;
    }
    const seat = SEATS[this.seatIndex.get(id)!];
    this.focusRing.position.set(MAP.seatX[seat.letter], MAP.seatTopY + 0.07, rowZ(seat.row) - 0.02);
    this.focusRing.visible = true;
    return true;
  }

  private visualOf(seat: SeatDef): SeatVisual {
    if (seat.id === this.confirmed) return 'confirmed';
    if (seat.id === this.selected) return 'selected';
    return seat.available ? 'available' : 'taken';
  }

  private refreshSeatColors() {
    SEATS.forEach((seat, i) => {
      const v = this.visualOf(seat);
      const hovered = seat.id === this.hovered && v === 'available';
      const top = v === 'selected' || v === 'confirmed' ? COLORS.selected : hovered ? COLORS.hover : v === 'available' ? COLORS.available : COLORS.taken;
      const back = v === 'selected' || v === 'confirmed' ? COLORS.selectedBack : hovered ? COLORS.hoverBack : v === 'available' ? COLORS.availableBack : COLORS.takenBack;
      this.cushions.setColorAt(i, top);
      this.backs.setColorAt(i, back);
      this.lift[i] = v === 'selected' || v === 'confirmed' ? 0.015 : hovered ? 0.025 : 0;
    });
    this.cushions.instanceColor!.needsUpdate = true;
    this.backs.instanceColor!.needsUpdate = true;
  }

  private refreshSeatMatrices() {
    SEATS.forEach((seat, i) => {
      const x = MAP.seatX[seat.letter];
      const z = rowZ(seat.row);
      const lift = this.lift[i] ?? 0;
      this.tmpP.set(x, 0.3 + lift, z - 0.075);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      this.cushions.setMatrixAt(i, this.tmpM);
      this.tmpP.set(x, 0.33 + lift, z + 0.165);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      this.backs.setMatrixAt(i, this.tmpM);
    });
    this.cushions.instanceMatrix.needsUpdate = true;
    this.backs.instanceMatrix.needsUpdate = true;
  }

  private updateCheck() {
    if (!this.confirmed) {
      this.check.visible = false;
      return;
    }
    const seat = SEATS[this.seatIndex.get(this.confirmed)!];
    this.check.position.set(MAP.seatX[seat.letter], 0.37, rowZ(seat.row) - 0.075);
    this.check.visible = true;
  }

  /* ------------------------------ picking ------------------------------ */

  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -MAP.seatTopY);
  private readonly hit = new THREE.Vector3();

  /** Seat under a pointer given in normalised device coordinates. Each seat owns its whole cell (no gaps, no overlap). */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): SeatDef | null {
    this.ray.setFromCamera(ndc, camera);
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return null;
    const row = Math.round((this.hit.z + 0.05 - MAP.row1Z) / MAP.pitch) + 1;
    if (row < 1 || row > CABIN.rows) return null;
    if (Math.abs(this.hit.z + 0.05 - rowZ(row)) > MAP.pitch / 2) return null;
    let best: SeatLetter | null = null;
    let bestD = Infinity;
    for (const l of CABIN.letters) {
      const d = Math.abs(this.hit.x - MAP.seatX[l]);
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    if (!best || bestD > 0.25) return null;
    const idx = this.seatIndex.get(`${row}${best}`);
    return idx === undefined ? null : SEATS[idx];
  }

  /** World-space centre of a seat's cushion top. */
  seatWorld(id: string, target = new THREE.Vector3()) {
    const seat = SEATS[this.seatIndex.get(id)!];
    return target.set(MAP.seatX[seat.letter], MAP.seatTopY, rowZ(seat.row) - 0.05);
  }
}

/* ------------------------------ shapes ------------------------------ */

/** Top-view outline of the fuselage at a given half-width (shape x = world x, shape y = world z). */
function fuselageOutline(half: number, clockwise = false): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const noseStart = -2.1;
  const noseLen = 5.4 * (half / MAP.outerHalf) + 0.4;
  const tailStart = 18.2;
  const tailLen = 7.5;
  const tailHalf = Math.max(0.25, half * 0.2);
  // right side from nose tip to tail, then left side back
  const right: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const z = noseStart - noseLen * (1 - t);
    const w = half * Math.sqrt(1 - Math.pow(1 - t, 2.2));
    right.push(new THREE.Vector2(Math.max(0.0001, w), z));
  }
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    const z = tailStart + tailLen * t;
    const w = THREE.MathUtils.lerp(half, tailHalf, Math.pow(t, 1.6));
    right.push(new THREE.Vector2(w, z));
  }
  for (const p of right) pts.push(p);
  for (let i = right.length - 1; i >= 0; i--) pts.push(new THREE.Vector2(-right[i].x, right[i].y));
  // ensure counter-clockwise in shape space (x right, y down the fuselage)
  if (THREE.ShapeUtils.isClockWise(pts) !== clockwise) pts.reverse();
  return pts;
}

function wingPlanform(side: number): [number, number][] {
  const s = side;
  return [
    [s * 1.6, 3.9],
    [s * 1.98, 4.22],
    [s * 17.0, 12.35],
    [s * 17.2, 13.1],
    [s * 16.6, 13.6],
    [s * 6.2, 10.3],
    [s * 1.98, 9.9],
    [s * 1.6, 9.9],
  ];
}

function tailPlanform(side: number): [number, number][] {
  const s = side;
  return [
    [s * 0.6, 21.2],
    [s * 6.1, 24.6],
    [s * 6.2, 25.6],
    [s * 0.6, 25.0],
  ];
}

/**
 * Flat extruded panel from a top-view polygon (x, z). ExtrudeGeometry normalises
 * the winding itself; rotateX(+90°) maps shape y → world z and turns the z = 0
 * cap (which faces -Z) upward, so the top surface sits at `y` and faces the sky.
 */
function makeFlatGeometry(points: [number, number][], y: number, thickness: number) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3 });
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  g.computeVertexNormals();
  return g;
}

function makeWingGeometry(side: number) {
  return makeFlatGeometry(wingPlanform(side), -0.55, 0.22);
}

function makeTailplaneGeometry(side: number) {
  return makeFlatGeometry(tailPlanform(side), 0.9, 0.12);
}

function makeEngine(mat: THREE.Material) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.66, 8, 24), mat);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 12, 32), new THREE.MeshStandardMaterial({ color: '#e9e9e6', roughness: 0.6 }));
  lip.position.z = -1.2;
  g.add(lip);
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32), new THREE.MeshStandardMaterial({ color: '#cfd0cc', roughness: 0.7 }));
  fan.position.z = -1.17;
  fan.rotation.y = Math.PI;
  g.add(fan);
  return g;
}

function remapUV(g: THREE.BufferGeometry, b: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - b.minX) / (b.maxX - b.minX);
    uv[i * 2 + 1] = 1 - (pos.getZ(i) - b.minZ) / (b.maxZ - b.minZ);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
