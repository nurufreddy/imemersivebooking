import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { roundedRectHalfWidth, roundedRectOutline, roundedRectPath, roundedRectShape, sweepProfile, type ProfilePoint } from '../geometry';

/**
 * Aircraft window, modelled in a local frame:
 *   +X along the cabin, +Y up, +Z out of the wall towards the passenger.
 * Layers (back to front): exterior → glass → reveal tunnel → shade (slides
 * inside the reveal) → lip, seam, band, groove, raised ring, dish → wall.
 */
export const WINDOW = {
  w: 0.255,
  h: 0.36,
  r: 0.1,
  /** Depth of the glass behind the wall plane. */
  glassZ: -0.064,
  /** Wall surface depth in the local frame. */
  wallZ: 0.017,
  /** Outer edge of the dish where it meets the wall. */
  dishD: 0.165,
  /** Lower edge of the shade housing (the visible top of the opening). */
  hoodY: 0.148,
  shadeZ: -0.013,
};

/** Visible opening: from the hood's lower edge to the bottom of the aperture. */
export const OPENING_TOP = WINDOW.hoodY;
export const OPENING_BOTTOM = -WINDOW.h / 2;

const PROFILE: ProfilePoint[] = [
  // reveal tunnel (from the glass towards the passenger)
  { d: -0.007, z: WINDOW.glassZ, ao: 0.62 },
  { d: -0.004, z: -0.045, ao: 0.8 },
  { d: -0.0015, z: -0.02, ao: 0.95 },
  // rounded mouth lip
  { d: 0.0, z: -0.006, ao: 1 },
  { d: 0.0025, z: 0.0035, ao: 1 },
  { d: 0.0065, z: 0.0075, ao: 1 },
  // fine seam
  { d: 0.0095, z: 0.008, ao: 0.82 },
  { d: 0.0108, z: 0.0055, ao: 0.6, crease: true },
  { d: 0.0122, z: 0.0085, ao: 0.82 },
  // flat band
  { d: 0.0145, z: 0.0105, ao: 0.98 },
  { d: 0.026, z: 0.0135, ao: 0.96 },
  // shadow groove
  { d: 0.0285, z: 0.011, ao: 0.72 },
  { d: 0.0305, z: 0.007, ao: 0.52, crease: true },
  { d: 0.0325, z: 0.0125, ao: 0.74 },
  // raised ring
  { d: 0.0355, z: 0.0225, ao: 1 },
  { d: 0.0395, z: 0.027, ao: 1 },
  { d: 0.0435, z: 0.0235, ao: 0.97 },
  // shallow dish easing tangentially into the wall (no visible outer edge)
  { d: 0.048, z: 0.0165, ao: 0.84 },
  { d: 0.058, z: 0.013, ao: 0.84 },
  { d: 0.08, z: 0.0128, ao: 0.9 },
  { d: 0.11, z: 0.0142, ao: 0.9 },
  { d: 0.14, z: 0.0161, ao: 0.84 },
  { d: WINDOW.dishD, z: WINDOW.wallZ, ao: 0.8 },
];

export interface WindowMaterials {
  trim: THREE.MeshStandardMaterial;
  hood: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  shade: THREE.MeshStandardMaterial;
  shadeEdge: THREE.MeshStandardMaterial;
  handle: THREE.MeshStandardMaterial;
}

export function createWindowMaterials(grain: THREE.Texture): WindowMaterials {
  const trim = new THREE.MeshStandardMaterial({ color: '#e8e5e0', roughness: 0.6, metalness: 0, vertexColors: true, normalMap: grain, normalScale: new THREE.Vector2(0.15, 0.15) });
  const hood = new THREE.MeshStandardMaterial({ color: '#e9e5de', roughness: 0.62, metalness: 0 });
  const glass = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.05, depthWrite: false, envMapIntensity: 0.6 });
  const shade = new THREE.MeshStandardMaterial({ color: '#f8f5ef', roughness: 0.78, metalness: 0, emissive: new THREE.Color('#000000'), side: THREE.DoubleSide });
  const shadeEdge = new THREE.MeshStandardMaterial({ color: '#ebe5da', roughness: 0.6 });
  const handle = new THREE.MeshStandardMaterial({ color: '#c9c4bb', roughness: 0.5 });
  return { trim, hood, glass, shade, shadeEdge, handle };
}

/** Static window geometry shared by all window units. */
export class WindowGeometries {
  readonly trim: THREE.BufferGeometry;
  readonly hood: THREE.BufferGeometry;
  readonly pill: THREE.BufferGeometry;
  readonly glass: THREE.BufferGeometry;
  readonly shadePanel: THREE.BufferGeometry;
  readonly shadeEdge: THREE.BufferGeometry;
  readonly handle: THREE.BufferGeometry;

  constructor() {
    const { w, h, r } = WINDOW;
    const outline = roundedRectOutline(w, h, r, 18, 8);
    this.trim = sweepProfile(outline, PROFILE);

    // hood: a lid recessed inside the top of the opening (the shade housing). Its outline is
    // the aperture above the hood line; the outline is CCW from the bottom-right corner, so the
    // points above the line are contiguous and ordered right side → top → left side.
    const hoodD = 0.001;
    const hoodShape = new THREE.Shape();
    const apOutline = roundedRectOutline(w + hoodD * 2, h + hoodD * 2, r + hoodD, 24, 1).map((o) => o.p);
    const above = apOutline.filter((p) => p.y >= WINDOW.hoodY);
    const xR = roundedRectHalfWidth(w + hoodD * 2, h + hoodD * 2, r + hoodD, WINDOW.hoodY);
    hoodShape.moveTo(xR, WINDOW.hoodY);
    for (const p of above) hoodShape.lineTo(p.x, p.y);
    hoodShape.lineTo(-xR, WINDOW.hoodY);
    hoodShape.closePath();
    // extrude spans z ∈ [-bevel, depth + bevel]; shift so the lid runs from deep in the reveal
    // to just proud of the lip (front face at z ≈ 0.009, behind the band and ring)
    const hood = new THREE.ExtrudeGeometry(hoodShape, {
      depth: 0.052, bevelEnabled: true, bevelThickness: 0.009, bevelSize: 0.0035, bevelSegments: 6, curveSegments: 4,
    });
    hood.translate(0, 0, -0.052);
    this.hood = hood;

    // embossed pill on the hood front
    const pillShape = roundedRectShape(0.122, 0.011, 0.0055);
    const pill = new THREE.ExtrudeGeometry(pillShape, { depth: 0.001, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.0026, bevelSegments: 4, curveSegments: 8 });
    pill.translate(0, WINDOW.hoodY + 0.019, 0.0105);
    this.pill = pill;

    // glass pane
    const glassShape = roundedRectShape(w - 0.014, h - 0.014, r - 0.007);
    this.glass = new THREE.ShapeGeometry(glassShape, 12);
    this.glass.translate(0, 0, WINDOW.glassZ + 0.001);

    // shade: aperture-shaped panel (clipped at its lower edge by a plane), so it never pokes through the reveal
    const shadeShape = roundedRectShape(w - 0.003, h - 0.003, r - 0.0015);
    this.shadePanel = new THREE.ShapeGeometry(shadeShape, 16);
    this.shadePanel.translate(0, 0, WINDOW.shadeZ);

    this.shadeEdge = new RoundedBoxGeometry(1, 0.009, 0.01, 2, 0.003);
    this.handle = new RoundedBoxGeometry(0.075, 0.0065, 0.008, 2, 0.003);
  }
}

/**
 * One window. `setShade(s)` moves the shade (0 open → 1 closed); the exterior
 * keeps rendering underneath — the shade physically covers it from the top.
 */
export class WindowUnit {
  readonly group = new THREE.Group();
  readonly shadeGroup = new THREE.Group();
  private readonly edge: THREE.Mesh;
  private readonly handleMesh: THREE.Mesh;
  private readonly panel: THREE.Mesh;
  readonly clipPlane = new THREE.Plane();
  private shade = 0;

  constructor(geo: WindowGeometries, mats: WindowMaterials, withShade: boolean) {
    const trim = new THREE.Mesh(geo.trim, mats.trim);
    const hood = new THREE.Mesh(geo.hood, mats.hood);
    const pill = new THREE.Mesh(geo.pill, mats.hood);
    const glass = new THREE.Mesh(geo.glass, mats.glass);
    glass.renderOrder = 2;
    this.group.add(trim, hood, pill, glass);

    // each unit needs its own clip plane, so the shade material is cloned per unit
    const shadeMat = mats.shade.clone();
    shadeMat.clippingPlanes = [this.clipPlane];
    this.panel = new THREE.Mesh(geo.shadePanel, shadeMat);
    this.edge = new THREE.Mesh(geo.shadeEdge, mats.shadeEdge);
    this.handleMesh = new THREE.Mesh(geo.handle, mats.handle);
    this.shadeGroup.add(this.panel, this.edge, this.handleMesh);
    this.shadeGroup.visible = withShade;
    this.group.add(this.shadeGroup);
    this.setShade(0);
  }

  get shadeMaterial() {
    return this.panel.material as THREE.MeshStandardMaterial;
  }

  /** y (local) of the shade's lower edge for a shade value. */
  static edgeY(s: number) {
    const top = OPENING_TOP + 0.013; // fully tucked under the hood
    const bottom = OPENING_BOTTOM + 0.0025;
    return top - s * (top - bottom);
  }

  setShade(s: number) {
    this.shade = THREE.MathUtils.clamp(s, 0, 1);
    const y = WindowUnit.edgeY(this.shade);
    const half = roundedRectHalfWidth(WINDOW.w - 0.003, WINDOW.h - 0.003, WINDOW.r - 0.0015, Math.max(y, OPENING_BOTTOM + 0.002));
    this.edge.scale.x = Math.max(0.001, half * 2 - 0.004);
    this.edge.position.set(0, y + 0.0045, WINDOW.shadeZ + 0.004);
    this.handleMesh.position.set(0, y + 0.0165, WINDOW.shadeZ + 0.007);
    this.handleMesh.visible = half > 0.05;
    this.updateClip();
  }

  /** Recompute the world-space clip plane (keep everything above the shade edge). */
  updateClip() {
    this.group.updateWorldMatrix(true, false);
    const y = WindowUnit.edgeY(this.shade);
    const p = new THREE.Vector3(0, y, 0).applyMatrix4(this.group.matrixWorld);
    const n = new THREE.Vector3(0, 1, 0).transformDirection(this.group.matrixWorld);
    this.clipPlane.setFromNormalAndCoplanarPoint(n, p);
  }

  get shadeValue() {
    return this.shade;
  }
}

/** Wall panel with a window-shaped hole (or none). Local frame as above. */
export function wallPanelGeometry(width: number, yBottom: number, yTop: number, windowCenterY: number, withHole: boolean) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, yBottom - windowCenterY);
  shape.lineTo(width / 2, yBottom - windowCenterY);
  shape.lineTo(width / 2, yTop - windowCenterY);
  shape.lineTo(-width / 2, yTop - windowCenterY);
  shape.closePath();
  if (withHole) {
    const d = WINDOW.dishD;
    shape.holes.push(roundedRectPath(WINDOW.w + d * 2, WINDOW.h + d * 2, WINDOW.r + d, 0, 0, true));
  }
  const g = new THREE.ShapeGeometry(shape, 12);
  g.translate(0, 0, WINDOW.wallZ);
  // planar UVs in metres so tiling textures keep a constant scale
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * 6;
    uv[i * 2 + 1] = pos.getY(i) * 6;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
