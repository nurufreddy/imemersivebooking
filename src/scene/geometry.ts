import * as THREE from 'three';

export interface OutlinePoint {
  p: THREE.Vector2;
  /** Outward unit normal of the outline at p. */
  n: THREE.Vector2;
  /** Accumulated arc length (for UVs). */
  s: number;
}

/**
 * Closed rounded-rectangle outline (counter-clockwise, centred at the origin).
 * Each point carries its outward normal so that `p + n * d` is exactly the
 * outline of the same rectangle offset by `d` (radius r + d). Point indices
 * correspond between offsets, which lets us loft profiles cleanly.
 */
export function roundedRectOutline(w: number, h: number, r: number, cornerSegments = 14, edgeSegments = 6): OutlinePoint[] {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  const hx = w / 2 - rr;
  const hy = h / 2 - rr;
  const pts: OutlinePoint[] = [];
  // corner centres in CCW order starting bottom-right, each followed by the edge to the next corner
  const corners: [number, number, number][] = [
    [hx, -hy, -Math.PI / 2], // bottom-right, arc from -90° to 0°
    [hx, hy, 0], // top-right, 0° → 90°
    [-hx, hy, Math.PI / 2], // top-left, 90° → 180°
    [-hx, -hy, Math.PI], // bottom-left, 180° → 270°
  ];
  for (let c = 0; c < 4; c++) {
    const [cx, cy, a0] = corners[c];
    for (let i = 0; i <= cornerSegments; i++) {
      const a = a0 + (i / cornerSegments) * (Math.PI / 2);
      const n = new THREE.Vector2(Math.cos(a), Math.sin(a));
      pts.push({ p: new THREE.Vector2(cx + n.x * rr, cy + n.y * rr), n, s: 0 });
    }
    // straight edge to the next corner (exclusive of both ends)
    const [nx, ny, na0] = corners[(c + 1) % 4];
    const endN = new THREE.Vector2(Math.cos(na0), Math.sin(na0));
    const startP = pts[pts.length - 1].p.clone();
    const endP = new THREE.Vector2(nx + endN.x * rr, ny + endN.y * rr);
    const n = pts[pts.length - 1].n.clone();
    for (let i = 1; i < edgeSegments; i++) {
      pts.push({ p: startP.clone().lerp(endP, i / edgeSegments), n: n.clone(), s: 0 });
    }
  }
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += pts[i].p.distanceTo(pts[i - 1].p);
    pts[i].s = s;
  }
  return pts;
}

/** Half-width of a rounded rectangle at height y (|y| <= h/2). */
export function roundedRectHalfWidth(w: number, h: number, r: number, y: number): number {
  const rr = Math.min(r, w / 2, h / 2);
  const ay = Math.abs(y);
  const hy = h / 2 - rr;
  if (ay <= hy) return w / 2;
  const dy = Math.min(rr, ay - hy);
  return w / 2 - rr + Math.sqrt(Math.max(0, rr * rr - dy * dy));
}

export interface ProfilePoint {
  /** Outward offset from the base outline (metres). */
  d: number;
  /** Depth along the local +Z axis (towards the viewer). */
  z: number;
  /** Baked occlusion multiplier (1 = none). */
  ao?: number;
  /** Start a hard edge here (duplicate vertex with split normals). */
  crease?: boolean;
}

/**
 * Sweep a 2D profile (d, z) around a closed outline, producing a smooth surface
 * with analytic normals, UVs (u = arc length, v = profile length) and a vertex
 * colour attribute carrying baked occlusion.
 */
export function sweepProfile(outline: OutlinePoint[], profile: ProfilePoint[]): THREE.BufferGeometry {
  // expand creases into duplicated profile points and compute per-point 2D normals
  type P = { d: number; z: number; ao: number; nd: number; nz: number; v: number };
  const segN = (a: ProfilePoint, b: ProfilePoint) => {
    const td = b.d - a.d;
    const tz = b.z - a.z;
    const len = Math.hypot(td, tz) || 1;
    // rotate tangent +90° in (d, z): normal faces +z for a flat outward run
    return { nd: -tz / len, nz: td / len };
  };
  const rings: P[] = [];
  let v = 0;
  for (let i = 0; i < profile.length; i++) {
    const cur = profile[i];
    if (i > 0) v += Math.hypot(cur.d - profile[i - 1].d, cur.z - profile[i - 1].z);
    const prevN = i > 0 ? segN(profile[i - 1], cur) : null;
    const nextN = i < profile.length - 1 ? segN(cur, profile[i + 1]) : null;
    const ao = cur.ao ?? 1;
    if (cur.crease && prevN && nextN) {
      rings.push({ d: cur.d, z: cur.z, ao, nd: prevN.nd, nz: prevN.nz, v });
      rings.push({ d: cur.d, z: cur.z, ao, nd: nextN.nd, nz: nextN.nz, v });
    } else {
      const a = prevN ?? nextN!;
      const b = nextN ?? prevN!;
      const nd = a.nd + b.nd;
      const nz = a.nz + b.nz;
      const len = Math.hypot(nd, nz) || 1;
      rings.push({ d: cur.d, z: cur.z, ao, nd: nd / len, nz: nz / len, v });
    }
  }

  const n = outline.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < n; i++) {
      const o = outline[i];
      positions.push(o.p.x + o.n.x * ring.d, o.p.y + o.n.y * ring.d, ring.z);
      normals.push(o.n.x * ring.nd, o.n.y * ring.nd, ring.nz);
      uvs.push(o.s, ring.v);
      colors.push(ring.ao, ring.ao, ring.ao);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r];
    const b = rings[r + 1];
    if (a.d === b.d && a.z === b.z) continue; // crease duplicate: no zero-area band
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const p0 = r * n + i;
      const p1 = r * n + i2;
      const q0 = (r + 1) * n + i;
      const q1 = (r + 1) * n + i2;
      // outline is CCW (seen from +Z) and rings grow outward: cross(q0 - p0, q1 - p0)
      // points along +Z for a flat outward run, i.e. along the analytic profile normal.
      index.push(p0, q1, p1, p0, q0, q1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  return g;
}

/** THREE.Shape for a rounded rectangle centred at (cx, cy). */
export function roundedRectShape(w: number, h: number, r: number, cx = 0, cy = 0): THREE.Shape {
  const s = new THREE.Shape();
  addRoundedRect(s, w, h, r, cx, cy, false);
  return s;
}

/** Rounded rectangle path (optionally clockwise, as required for holes). */
export function roundedRectPath(w: number, h: number, r: number, cx = 0, cy = 0, clockwise = true): THREE.Path {
  const p = new THREE.Path();
  addRoundedRect(p, w, h, r, cx, cy, clockwise);
  return p;
}

function addRoundedRect(path: THREE.Path, w: number, h: number, r: number, cx: number, cy: number, clockwise: boolean) {
  const pts = roundedRectOutline(w, h, r, 12, 1).map((o) => o.p);
  if (clockwise) pts.reverse();
  path.moveTo(pts[0].x + cx, pts[0].y + cy);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x + cx, pts[i].y + cy);
  path.closePath();
}

/** Multiply an existing geometry's vertex colours by a vertical gradient (baked occlusion). */
export function bakeVerticalAO(g: THREE.BufferGeometry, y0: number, y1: number, ao0: number, ao1: number) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) - y0) / (y1 - y0), 0, 1);
    const ao = THREE.MathUtils.lerp(ao0, ao1, t * t * (3 - 2 * t));
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Ensure a geometry has a white vertex-colour attribute (so it can share vertexColors materials). */
export function ensureColor(g: THREE.BufferGeometry, value = 1): THREE.BufferGeometry {
  if (!g.getAttribute('color')) {
    const count = g.getAttribute('position').count;
    const c = new Float32Array(count * 3).fill(value);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return g;
}
