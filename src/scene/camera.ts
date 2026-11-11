import * as THREE from 'three';
import { clamp, smoothstep } from '../logic/timeline';

/**
 * A camera pose described around what it looks at. Interpolating these
 * components (rather than raw matrices) gives a controlled dive: the distance
 * shrinks exponentially, then the camera pitches up and turns to the wall.
 */
export interface Pose {
  target: THREE.Vector3;
  distance: number;
  /** Radians. Forward at pitch 0 is (−sin h, 0, −cos h): 0 → nose, +π/2 → port wall. */
  heading: number;
  /** Radians, negative looks down. */
  pitch: number;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Vertical lens shift in NDC (positive moves the image up). */
  shift: number;
  /** Horizontal lens shift in NDC (positive moves the image right). */
  shiftX: number;
}

export interface Layout {
  width: number;
  height: number;
  /** CSS px from the top where usable stage starts (below the header). */
  regionTop: number;
  /** CSS px from the top where the bottom sheet begins. */
  regionBottom: number;
  /** Horizontal extent of the usable stage (defaults to the full width). */
  regionLeft?: number;
  regionRight?: number;
}

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const fwd = new THREE.Vector3();

export function poseQuaternion(p: Pose, target = new THREE.Quaternion()) {
  euler.set(p.pitch, p.heading, 0, 'YXZ');
  return target.setFromEuler(euler);
}

export function poseForward(p: Pose, target = new THREE.Vector3()) {
  return target.set(0, 0, -1).applyQuaternion(poseQuaternion(p));
}

export function posePosition(p: Pose, target = new THREE.Vector3()) {
  poseForward(p, fwd);
  return target.copy(p.target).addScaledVector(fwd, -p.distance);
}

export function applyPose(camera: THREE.PerspectiveCamera, p: Pose) {
  poseQuaternion(p, camera.quaternion);
  posePosition(p, camera.position);
  camera.fov = p.fov;
  camera.near = clamp(p.distance * 0.04, 0.02, 4);
  camera.far = Math.max(700, p.distance * 6);
  camera.updateProjectionMatrix();
  if (p.shift !== 0 || p.shiftX !== 0) {
    // ndc = (P·v) / −z  ⇒ on-axis points land at ndc.x = −P02, ndc.y = −P12
    camera.projectionMatrix.elements[8] = -p.shiftX;
    camera.projectionMatrix.elements[9] = -p.shift;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  camera.updateMatrixWorld(true);
}

export function clonePose(p: Pose): Pose {
  return { ...p, target: p.target.clone() };
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Shortest signed angular difference b − a. */
function angleDelta(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Map ↔ cabin camera path. `p` = 0 is the map pose, 1 the cabin pose.
 * The same function is evaluated forwards and backwards, so a return flight
 * lands exactly on the (current) map pose.
 */
export function transitionPose(from: Pose, to: Pose, p: number, out: Pose): Pose {
  const t = clamp(p, 0, 1);
  const eT = smoothstep(0.0, 0.62, t);
  const eD = easeInOutCubic(t);
  const eH = smoothstep(0.18, 0.86, t);
  const eP = smoothstep(0.34, 0.94, t);
  const eF = smoothstep(0.3, 0.95, t);
  out.target.lerpVectors(from.target, to.target, eT);
  out.distance = Math.exp(THREE.MathUtils.lerp(Math.log(from.distance), Math.log(to.distance), eD));
  out.heading = from.heading + angleDelta(from.heading, to.heading) * eH;
  out.pitch = THREE.MathUtils.lerp(from.pitch, to.pitch, eP);
  out.fov = THREE.MathUtils.lerp(from.fov, to.fov, eF);
  out.shift = THREE.MathUtils.lerp(from.shift, to.shift, eF);
  out.shiftX = THREE.MathUtils.lerp(from.shiftX, to.shiftX, eF);
  return out;
}

/** Strength (0..1) of the motion blur along the path: peaks while the camera turns. */
export function transitionBlur(p: number) {
  const rise = smoothstep(0.1, 0.5, p);
  const fall = 1 - smoothstep(0.62, 0.88, p);
  return rise * fall;
}

/** Cross-fade from the seat-map sculpture (0) to the detailed cabin (1). */
export function transitionMix(p: number) {
  return smoothstep(0.46, 0.7, p);
}

/* ------------------------------------------------------------------ */
/* Framing                                                             */
/* ------------------------------------------------------------------ */

export type MapOrientation = 'vertical' | 'horizontal';

export interface MapFrame {
  orientation: MapOrientation;
  /** CSS px per metre at the seat plane. */
  scale: number;
  /** World z at the screen centre before panning. */
  baseZ: number;
  /** World x at the screen centre (horizontal mode keeps the fuselage centred in the region). */
  baseX: number;
  /** Allowed pan range (world z, relative to baseZ). */
  panMin: number;
  panMax: number;
  fov: number;
}

const MAP_FOV = 18;
/** Metres of content the seat map must show. */
const CONTENT = { top: -0.25, bottom: 15.62, halfWidth: 5.4, fuselageHalf: 2.4 };
const MIN_SCALE = 31;

export function frameMap(l: Layout): MapFrame {
  const regionH = Math.max(80, l.regionBottom - l.regionTop);
  const length = CONTENT.bottom - CONTENT.top;
  const gap = Math.min(0.12 * regionH, 96);
  const vScale = Math.min(l.width / (CONTENT.halfWidth * 2), (regionH - gap) / length);
  const hScale = Math.min((l.width - 48) / (length + 1.2), regionH / (CONTENT.fuselageHalf * 2 + 0.6));
  const orientation: MapOrientation = vScale >= MIN_SCALE || vScale >= hScale ? 'vertical' : 'horizontal';

  if (orientation === 'vertical') {
    const scale = Math.max(vScale, Math.min(MIN_SCALE, l.width / 4.6));
    const contentPx = length * scale;
    // like the reference: first row just under the header, spare floor below the last row
    const topPx = l.regionTop + 3;
    const baseZ = CONTENT.top + (l.height / 2 - topPx) / scale;
    const overflow = contentPx - (regionH - 8);
    const panMax = overflow > 0 ? overflow / scale + 0.4 : 0;
    return { orientation, scale, baseZ, baseX: 0, panMin: 0, panMax, fov: MAP_FOV };
  }

  const scale = Math.max(hScale, Math.min(MIN_SCALE, regionH / 3));
  const contentPx = (length + 1.2) * scale;
  const leftPx = contentPx <= l.width ? (l.width - contentPx) / 2 : 24;
  const baseZ = CONTENT.top - 0.6 + (l.width / 2 - leftPx) / scale;
  const regionCenter = (l.regionTop + l.regionBottom) / 2;
  const baseX = -(l.height / 2 - regionCenter) / scale;
  const overflow = contentPx - (l.width - 16);
  const panMax = overflow > 0 ? overflow / scale + 0.4 : 0;
  return { orientation, scale, baseZ, baseX, panMin: 0, panMax, fov: MAP_FOV };
}

export function mapPose(frame: MapFrame, viewportHeight: number, pan: number, seatPlaneY: number): Pose {
  const f = 1 / (2 * Math.tan(THREE.MathUtils.degToRad(frame.fov / 2)));
  const distance = (viewportHeight * f) / frame.scale;
  return {
    target: new THREE.Vector3(frame.baseX, seatPlaneY, frame.baseZ + pan),
    distance,
    heading: frame.orientation === 'vertical' ? 0 : -Math.PI / 2,
    pitch: -Math.PI / 2 + 1e-4,
    fov: frame.fov,
    shift: 0,
    shiftX: 0,
  };
}

/**
 * Window close-up: fixed lens, distance chosen so the visible opening fills a
 * set share of the stage and stays within the width; lens shift centres it.
 */
export function windowPose(center: THREE.Vector3, heading: number, opening: { top: number; bottom: number; width: number }, l: Layout): Pose {
  const fov = 50;
  const f = 1 / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
  const aspect = l.width / l.height;
  const regionTopF = l.regionTop / l.height;
  const regionHF = (l.regionBottom - l.regionTop) / l.height;
  const left = l.regionLeft ?? 0;
  const right = l.regionRight ?? l.width;
  const regionWF = (right - left) / l.width;
  const regionAspect = (right - left) / (l.regionBottom - l.regionTop);
  const share = regionAspect < 0.75 ? 0.8 : THREE.MathUtils.lerp(0.8, 0.64, smoothstep(0.75, 1.7, regionAspect));
  const span = opening.top - opening.bottom;
  const eye = 0.012;
  let d = (span * f) / (share * regionHF);
  d = Math.max(d, (opening.width * f) / (0.78 * aspect * regionWF));
  const yT = opening.top - eye;
  const yB = eye - opening.bottom;
  const centerF = regionTopF + regionHF / 2;
  const y0 = centerF - ((yB - yT) * f) / (2 * d);
  // target sits on the opening plane; the pose looks at it from distance d
  const target = center.clone().add(new THREE.Vector3(0, eye, 0));
  const shiftX = (((left + right) / 2) / l.width - 0.5) * 2;
  return { target, distance: d, heading, pitch: 0, fov, shift: (0.5 - y0) * 2, shiftX };
}

/**
 * Wall-panel view for a seat sold as a window seat without one (the 11A case):
 * the camera stands across the aisle; the light strip sits near the top of the
 * stage and the seat's armrest near the bottom, matching the reference.
 */
export function wallPose(
  wallPoint: THREE.Vector3,
  heading: number,
  geo: { cameraDistance: number; eyeY: number; topY: number; topDepth: number; bottomY: number; bottomDepth: number; minWallWidth: number },
  l: Layout,
): Pose {
  const aspect = l.width / l.height;
  const regionTopF = l.regionTop / l.height;
  const regionHF = (l.regionBottom - l.regionTop) / l.height;
  const sT = regionTopF + 0.115 * regionHF;
  const sB = regionTopF + 0.87 * regionHF;
  const aT = (geo.topY - geo.eyeY) / (geo.cameraDistance - geo.topDepth);
  const aB = (geo.eyeY - geo.bottomY) / (geo.cameraDistance - geo.bottomDepth);
  let f = (sB - sT) / (aT + aB);
  const left = l.regionLeft ?? 0;
  const right = l.regionRight ?? l.width;
  const regionWF = (right - left) / l.width;
  const fMax = (aspect * regionWF * geo.cameraDistance) / geo.minWallWidth;
  let y0 = sT + aT * f;
  if (f > fMax) {
    f = fMax;
    y0 = (sT + sB) / 2 - ((aB - aT) * f) / 2;
  }
  const fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(1 / (2 * f))), 30, 96);
  const target = wallPoint.clone();
  target.y = geo.eyeY;
  const shiftX = (((left + right) / 2) / l.width - 0.5) * 2;
  return { target, distance: geo.cameraDistance, heading, pitch: 0, fov, shift: (0.5 - y0) * 2, shiftX };
}
