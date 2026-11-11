import * as THREE from 'three';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return { c, ctx };
}

/** Deterministic pseudo-random generator so textures are identical on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convert a height field (0..1) into a tangent-space normal map. */
function heightToNormal(height: Float32Array, w: number, h: number, strength: number): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const nx = -dx;
      const ny = dy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Fine woven upholstery: a greyscale albedo modulation + normal map. */
export function makeFabricTextures() {
  const N = 256;
  const rand = rng(7);
  const height = new Float32Array(N * N);
  const { c, ctx } = canvas(N, N);
  const img = ctx.createImageData(N, N);
  const coarse = new Float32Array(64 * 64).map(() => rand());
  const coarseAt = (x: number, y: number) => {
    const fx = (x / N) * 64;
    const fy = (y / N) * 64;
    const x0 = Math.floor(fx) % 64;
    const y0 = Math.floor(fy) % 64;
    const x1 = (x0 + 1) % 64;
    const y1 = (y0 + 1) % 64;
    const tx = fx - Math.floor(fx);
    const ty = fy - Math.floor(fy);
    const a = coarse[y0 * 64 + x0] * (1 - tx) + coarse[y0 * 64 + x1] * tx;
    const b = coarse[y1 * 64 + x0] * (1 - tx) + coarse[y1 * 64 + x1] * tx;
    return a * (1 - ty) + b * ty;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // twill-like weave: alternating diagonal threads
      const warp = Math.sin(((x + y) / N) * Math.PI * 2 * 48) * 0.5 + 0.5;
      const weft = Math.sin(((x - y) / N) * Math.PI * 2 * 48) * 0.5 + 0.5;
      const thread = (x >> 2) % 2 === (y >> 2) % 2 ? warp : weft;
      const fibre = rand() * 0.35;
      const hgt = thread * 0.65 + fibre;
      height[y * N + x] = hgt;
      const v = 0.86 + thread * 0.1 + (coarseAt(x, y) - 0.5) * 0.08 + (rand() - 0.5) * 0.05;
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = THREE.MathUtils.clamp(v, 0, 1) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  const normalMap = heightToNormal(height, N, N, 1.6);
  return { map, normalMap };
}

/** Very fine grain for moulded plastic panels. */
export function makeGrainNormal(seed = 3) {
  const N = 128;
  const rand = rng(seed);
  const height = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) height[i] = rand();
  // soften
  const soft = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) s += height[((y + oy + N) % N) * N + ((x + ox + N) % N)];
      soft[y * N + x] = s / 9;
    }
  return heightToNormal(soft, N, N, 0.6);
}

/** Row numbers painted along the aisle floor of the seat map. */
export function makeRowNumbers(rows: number, pitch: number, firstZ: number, length: number, font: string) {
  const W = 96;
  const pxPerM = 160;
  const H = Math.ceil(length * pxPerM);
  const { c, ctx } = canvas(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#a9aaa5';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `400 ${Math.round(0.185 * pxPerM)}px ${font}`;
  for (let r = 1; r <= rows; r++) {
    const z = firstZ + (r - 1) * pitch;
    ctx.fillText(String(r), W / 2, z * pxPerM);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { texture: t, width: W / pxPerM, height: H / pxPerM };
}

/** Small spaced label (e.g. GALLEY). */
export function makeLabel(text: string, font: string, color = '#a7a8a3') {
  const { c, ctx } = canvas(512, 96);
  ctx.clearRect(0, 0, 512, 96);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 46px ${font}`;
  const spaced = text.split('').join(' ');
  ctx.fillText(spaced, 256, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** White check mark on transparent background. */
export function makeCheck() {
  const { c, ctx } = canvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 15;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(34, 66);
  ctx.lineTo(55, 87);
  ctx.lineTo(95, 42);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Soft ground shadow: draw a silhouette (metres → canvas) and blur it with a
 * separable box blur (works everywhere, no ctx.filter dependency).
 */
export function makeSoftShadow(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  pxPerM: number,
  draw: (ctx: CanvasRenderingContext2D, toPx: (x: number, z: number) => [number, number], scale: number) => void,
  blurPx: number,
  passes = 3,
) {
  const W = Math.ceil((bounds.maxX - bounds.minX) * pxPerM);
  const H = Math.ceil((bounds.maxZ - bounds.minZ) * pxPerM);
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  draw(ctx, (x, z) => [(x - bounds.minX) * pxPerM, (z - bounds.minZ) * pxPerM], pxPerM);
  const img = ctx.getImageData(0, 0, W, H);
  const a = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = img.data[i * 4] / 255;
  const tmp = new Float32Array(W * H);
  const r = Math.max(1, Math.round(blurPx));
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < H; y++) {
      let acc = 0;
      const row = y * W;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    // vertical
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
      }
    }
  }
  for (let i = 0; i < W * H; i++) {
    const v = Math.round(a[i] * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
