import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ensureColor } from '../geometry';

/**
 * Economy seat, local frame: origin on the floor under the seat centre,
 * facing −Z (towards the nose), +X to the occupant's right.
 * Parts are merged per material so the cabin can instance them cheaply.
 */
export interface SeatParts {
  fabric: THREE.BufferGeometry;
  cover: THREE.BufferGeometry;
  shell: THREE.BufferGeometry;
  tray: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
}

const RECLINE = THREE.MathUtils.degToRad(16);

function box(w: number, h: number, d: number, r: number, x: number, y: number, z: number, segments = 3, shade = 1) {
  const g = new RoundedBoxGeometry(w, h, d, segments, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
  g.translate(x, y, z);
  ensureColor(g, shade);
  return g;
}

/**
 * Shape a rounded box into a gently contoured cushion (crowned top or bulged
 * front). Normals are tilted analytically: recomputing them would expose the
 * split vertices along RoundedBoxGeometry's face seams.
 */
function crown(g: THREE.BufferGeometry, amount: number, axis: 'y' | 'z') {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2;
  const hw = (bb.max.x - bb.min.x) / 2;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) - cx) / hw;
    const k = 1 - u * u;
    const slope = (2 * amount * u) / hw; // |d(offset)/dx|
    n.fromBufferAttribute(nor, i);
    if (axis === 'y') {
      if (pos.getY(i) > (bb.min.y + bb.max.y) / 2) {
        pos.setY(i, pos.getY(i) + amount * k);
        n.x += slope * Math.max(0, n.y);
      }
    } else if (pos.getZ(i) < (bb.min.z + bb.max.z) / 2) {
      pos.setZ(i, pos.getZ(i) - amount * k);
      n.x += slope * Math.max(0, -n.z);
    }
    n.normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  return g;
}

/** Box-projected UVs in metres (×scale), so tiling fabric keeps one density on every face. */
function boxProjectUV(g: THREE.BufferGeometry, scale: number) {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else if (ay >= az) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export function buildSeatParts(): SeatParts {
  const recline = new THREE.Matrix4().makeRotationX(RECLINE);
  const pivot = new THREE.Matrix4().makeTranslation(0, 0.455, 0.19);
  const backXform = new THREE.Matrix4().multiplyMatrices(pivot, recline);
  const back = (g: THREE.BufferGeometry) => g.applyMatrix4(backXform);

  // upholstery
  const cushion = crown(box(0.43, 0.12, 0.47, 0.05, 0, 0.405, -0.04, 4), 0.014, 'y');
  const backFabric = back(crown(box(0.425, 0.6, 0.095, 0.036, 0, 0.3, -0.0475, 4), 0.016, 'z'));
  const headPad = back(crown(box(0.4, 0.17, 0.06, 0.026, 0, 0.6, -0.098, 4), 0.008, 'z'));
  const seam = back(box(0.392, 0.007, 0.006, 0.0025, 0, 0.215, -0.11, 2, 0.5));
  const seamV1 = back(box(0.006, 0.19, 0.006, 0.0025, -0.115, 0.115, -0.104, 2, 0.6));
  const seamV2 = back(box(0.006, 0.19, 0.006, 0.0025, 0.115, 0.115, -0.104, 2, 0.6));
  const fabric = boxProjectUV(mergeGeometries([cushion, backFabric, headPad, seam, seamV1, seamV2])!, 9);

  // white headrest cover draped over the top
  const coverFront = back(box(0.3, 0.19, 0.007, 0.003, 0, 0.6, -0.132, 2));
  const coverTop = back(box(0.3, 0.007, 0.1, 0.003, 0, 0.688, -0.083, 2));
  const cover = boxProjectUV(mergeGeometries([coverFront, coverTop])!, 9);

  // plastic shell: backrest rear + seat pan base
  const shellBack = back(box(0.452, 0.7, 0.06, 0.024, 0, 0.34, 0.028, 3));
  const pan = box(0.44, 0.045, 0.44, 0.014, 0, 0.335, -0.03, 2, 0.85);
  const shell = mergeGeometries([shellBack, pan])!;

  // details on the back of the seat (seen from the row behind)
  const trayTable = back(box(0.36, 0.26, 0.012, 0.012, 0, 0.43, 0.062, 2));
  const tray = mergeGeometries([trayTable])!;
  const latch = back(box(0.05, 0.014, 0.008, 0.003, 0, 0.574, 0.07, 2));
  const pocket = back(box(0.38, 0.15, 0.018, 0.01, 0, 0.12, 0.063, 2));
  const dark = mergeGeometries([latch, pocket])!;

  return { fabric, cover, shell, tray, dark };
}

/** Armrest with its rear support post (local frame centred on the armrest line). */
export function buildArmrest(): THREE.BufferGeometry {
  const top = box(0.05, 0.045, 0.5, 0.018, 0, 0.645, -0.07, 3);
  const post = box(0.04, 0.22, 0.05, 0.012, 0, 0.53, 0.13, 2, 0.85);
  return mergeGeometries([top, post])!;
}

/** Seat-row support frame for a block of three seats (beam + legs). */
export function buildRowFrame(blockWidth: number): THREE.BufferGeometry {
  const beam = box(blockWidth - 0.06, 0.04, 0.05, 0.012, 0, 0.29, -0.06, 2);
  const legs: THREE.BufferGeometry[] = [beam];
  for (const x of [-blockWidth / 2 + 0.2, blockWidth / 2 - 0.2]) {
    legs.push(box(0.035, 0.29, 0.035, 0.01, x, 0.145, -0.2, 2));
    legs.push(box(0.035, 0.29, 0.035, 0.01, x, 0.145, 0.14, 2));
    legs.push(box(0.03, 0.02, 0.4, 0.008, x, 0.02, -0.03, 2));
  }
  return mergeGeometries(legs)!;
}
