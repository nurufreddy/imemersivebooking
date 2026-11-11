import * as THREE from 'three';
import { SCENERY } from '../../config/demoFlight';

const BASE = import.meta.env.BASE_URL;

/** Loads, uploads and caches the exterior photographs. */
export class SceneryLibrary {
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly pending = new Map<string, Promise<THREE.Texture | null>>();
  private readonly failed = new Set<string>();
  private readonly loader = new THREE.TextureLoader();

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly onReady: (id: string) => void) {}

  get(id: string): THREE.Texture | null {
    return this.textures.get(id) ?? null;
  }

  has(id: string) {
    return this.textures.has(id);
  }

  load(id: string): Promise<THREE.Texture | null> {
    const cached = this.textures.get(id);
    if (cached) return Promise.resolve(cached);
    if (this.failed.has(id)) return Promise.resolve(null);
    const existing = this.pending.get(id);
    if (existing) return existing;
    const def = SCENERY[id];
    if (!def) return Promise.resolve(null);
    const p = new Promise<THREE.Texture | null>((resolve) => {
      this.loader.load(
        BASE + def.src,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          // upload now so first use never stalls a scrub
          this.renderer.initTexture(tex);
          this.textures.set(id, tex);
          this.pending.delete(id);
          this.onReady(id);
          resolve(tex);
        },
        undefined,
        () => {
          this.failed.add(id);
          this.pending.delete(id);
          console.warn(`[scenery] could not load ${def.src}; using sky fallback`);
          resolve(null);
        },
      );
    });
    this.pending.set(id, p);
    return p;
  }

  /** Load in priority order, one at a time, without blocking interaction. */
  async preload(ids: string[]) {
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      await this.load(id);
    }
  }
}

const backdropVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const backdropFragment = /* glsl */ `
  uniform sampler2D mapA;
  uniform sampler2D mapB;
  uniform vec4 xfA;
  uniform vec4 xfB;
  uniform float hasA;
  uniform float hasB;
  uniform float mixT;
  uniform float exposure;
  uniform float haze;
  uniform vec3 hazeColor;
  uniform float saturation;
  uniform float contrast;
  uniform vec3 tint;
  uniform vec3 skyTint;
  uniform float skyTintAmount;
  uniform vec3 skyTop;
  uniform vec3 skyBottom;
  uniform float edgeFade;
  varying vec2 vUv;

  vec3 sky(vec2 uv) { return mix(skyBottom, skyTop, smoothstep(0.0, 1.0, uv.y)); }

  vec3 img(sampler2D m, vec4 xf, float has) {
    if (has < 0.5) return sky(vUv);
    return texture2D(m, vUv * xf.xy + xf.zw).rgb;
  }

  void main() {
    vec3 a = img(mapA, xfA, hasA);
    vec3 col = a;
    if (mixT > 0.0005) col = mix(a, img(mapB, xfB, hasB), mixT);
    col *= exposure;
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(mix(vec3(luma), col, saturation), 0.0);
    col = max((col - 0.18) * contrast + 0.18, 0.0);
    col *= tint;
    // cool the upper sky (screen-blend keeps the sun and bright cloud tops)
    float skyW = skyTintAmount * smoothstep(0.5, 0.98, vUv.y);
    col = mix(col, 1.0 - (1.0 - col) * (1.0 - skyTint * 0.85), skyW * 0.35);
    col = mix(col, col * skyTint * 1.6, skyW * (1.0 - smoothstep(0.55, 1.2, luma)));
    // atmospheric grade: lift towards the haze colour, more near the horizon (top of the frame)
    col = mix(col, hazeColor, haze * mix(0.55, 1.0, smoothstep(0.2, 0.95, vUv.y)));
    vec2 e = smoothstep(vec2(0.0), vec2(edgeFade), vUv) * smoothstep(vec2(0.0), vec2(edgeFade), 1.0 - vUv);
    col = mix(sky(vUv), col, e.x * e.y);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createBackdropMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      mapA: { value: null },
      mapB: { value: null },
      xfA: { value: new THREE.Vector4(1, 1, 0, 0) },
      xfB: { value: new THREE.Vector4(1, 1, 0, 0) },
      hasA: { value: 0 },
      hasB: { value: 0 },
      mixT: { value: 0 },
      exposure: { value: 1 },
      haze: { value: 0 },
      saturation: { value: 1 },
      contrast: { value: 1 },
      tint: { value: new THREE.Color(1, 1, 1) },
      skyTint: { value: new THREE.Color(1, 1, 1) },
      skyTintAmount: { value: 0 },
      hazeColor: { value: new THREE.Color('#e8d2b4') },
      skyTop: { value: new THREE.Color('#7fa6d8') },
      skyBottom: { value: new THREE.Color('#dfe7f0') },
      edgeFade: { value: 0.08 },
    },
    vertexShader: backdropVertex,
    fragmentShader: backdropFragment,
    depthWrite: true,
  });
}

/**
 * UV transform that "cover"-fits an image on a plane of the given aspect,
 * keeping `focus` centred, applying extra zoom and a horizontal drift.
 */
export function coverTransform(
  imageAspect: number,
  planeAspect: number,
  focus: [number, number],
  zoom: number,
  drift: number,
  target: THREE.Vector4,
) {
  let sx = 1;
  let sy = 1;
  if (imageAspect > planeAspect) sx = planeAspect / imageAspect;
  else sy = imageAspect / planeAspect;
  sx /= zoom;
  sy /= zoom;
  const fx = focus[0] + drift;
  const fy = 1 - focus[1];
  const ox = THREE.MathUtils.clamp(fx - sx / 2, 0, 1 - sx);
  const oy = THREE.MathUtils.clamp(fy - sy / 2, 0, 1 - sy);
  return target.set(sx, sy, ox, oy);
}

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 top;
  uniform vec3 horizon;
  uniform vec3 bottom;
  varying vec3 vDir;
  void main() {
    float h = normalize(vDir).y;
    vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, bottom, pow(clamp(-h, 0.0, 1.0), 0.45));
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color('#6f98d0') },
      horizon: { value: new THREE.Color('#dce6f2') },
      bottom: { value: new THREE.Color('#a9b4bf') },
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

/* ------------------------------------------------------------------ */
/* Exterior wing (seen from over-wing seats)                           */
/* ------------------------------------------------------------------ */

const wingVertex = /* glsl */ `
  attribute float aChord;
  attribute float aSpan;
  varying vec3 vN;
  varying vec3 vW;
  varying float vChord;
  varying float vSpan;
  void main() {
    vChord = aChord;
    vSpan = aSpan;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const wingFragment = /* glsl */ `
  uniform vec3 albedo;
  uniform vec3 skyColor;
  uniform vec3 groundColor;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  uniform float sunIntensity;
  uniform vec3 camPos;
  varying vec3 vN;
  varying vec3 vW;
  varying float vChord;
  varying float vSpan;
  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    // paint and panelling: leading-edge slat line, spars, flap hinge, spanwise ribs
    float le = 1.0 - smoothstep(0.0, 0.05, vChord);
    float aft = smoothstep(0.55, 1.0, vChord);
    float line = 0.0;
    line += 1.0 - smoothstep(0.0, 0.006, abs(vChord - 0.1));
    line += 0.6 * (1.0 - smoothstep(0.0, 0.005, abs(vChord - 0.42)));
    line += 1.0 - smoothstep(0.0, 0.008, abs(vChord - 0.72));
    float rib = 1.0 - smoothstep(0.0, 0.05, abs(fract(vSpan * 16.0) - 0.5) * 2.0 - 0.9);
    line += 0.35 * rib * step(0.1, vChord);
    vec3 paint = albedo * (1.0 - 0.12 * aft - 0.18 * clamp(line, 0.0, 1.0)) + vec3(0.05) * le;
    // fuselage shadow near the root, slight soiling towards the tip
    paint *= mix(0.72, 1.0, smoothstep(0.0, 0.22, vSpan));
    paint *= 1.0 - 0.08 * smoothstep(0.7, 1.0, vSpan);
    float hemi = n.y * 0.5 + 0.5;
    vec3 amb = mix(groundColor, skyColor, hemi);
    float diff = max(dot(n, normalize(sunDir)), 0.0);
    vec3 v = normalize(camPos - vW);
    vec3 hv = normalize(normalize(sunDir) + v);
    float spec = pow(max(dot(n, hv), 0.0), 40.0) * 0.35;
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.28;
    vec3 col = paint * (amb + sunColor * diff * sunIntensity) + sunColor * spec * sunIntensity + skyColor * fres;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createWingMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      albedo: { value: new THREE.Color('#a9b0b9') },
      skyColor: { value: new THREE.Color('#9fb6d6') },
      groundColor: { value: new THREE.Color('#6b6d70') },
      sunColor: { value: new THREE.Color('#fff4e0') },
      sunDir: { value: new THREE.Vector3(-0.4, 0.6, 0.3) },
      sunIntensity: { value: 0.8 },
      camPos: { value: new THREE.Vector3() },
    },
    vertexShader: wingVertex,
    fragmentShader: wingFragment,
    side: THREE.DoubleSide,
  });
}

/**
 * Swept, tapered wing with dihedral and a simple airfoil, extending towards −X
 * from the fuselage side (port). Root leading edge at z = 0.
 */
export function createWingGeometry() {
  const span = 15;
  const rootChord = 5.6;
  const tipChord = 1.35;
  const sweep = Math.tan(THREE.MathUtils.degToRad(28));
  const dihedral = Math.tan(THREE.MathUtils.degToRad(5));
  const stations = 24;
  const chordPts = 28;
  const positions: number[] = [];
  const chordAttr: number[] = [];
  const spanAttr: number[] = [];
  const index: number[] = [];
  const airfoil = (t: number) => 0.6 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t * t * t - 0.1036 * t * t * t * t);
  const ring = chordPts * 2;
  for (let s = 0; s <= stations; s++) {
    const f = s / stations;
    const y = f * span;
    const chord = THREE.MathUtils.lerp(rootChord, tipChord, f);
    const le = y * sweep;
    const thick = THREE.MathUtils.lerp(0.13, 0.1, f);
    const lift = y * dihedral;
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < chordPts; i++) {
        const t = side === 0 ? i / (chordPts - 1) : 1 - i / (chordPts - 1);
        const tt = Math.pow(t, 1.5);
        const half = airfoil(tt) * chord * thick * 5;
        const camber = Math.sin(tt * Math.PI) * chord * 0.012;
        const yy = lift + (side === 0 ? half : -half) + camber;
        positions.push(-y, yy, le + tt * chord);
        chordAttr.push(tt);
        spanAttr.push(f);
      }
    }
  }
  for (let s = 0; s < stations; s++) {
    for (let i = 0; i < ring; i++) {
      const a = s * ring + i;
      const b = s * ring + ((i + 1) % ring);
      const c = (s + 1) * ring + i;
      const d = (s + 1) * ring + ((i + 1) % ring);
      index.push(a, c, b, b, c, d);
    }
  }
  // sharklet: a short canted fin rising from the tip
  {
    const tipY = span * dihedral;
    const tipLe = span * sweep;
    const base = positions.length / 3;
    const pts = [
      [-span, tipY, tipLe + 0.1], [-span, tipY, tipLe + tipChord], [-span - 0.35, tipY + 1.5, tipLe + tipChord + 0.75], [-span - 0.3, tipY + 1.5, tipLe + tipChord + 0.25],
    ];
    for (const [x, y, z] of pts) {
      positions.push(x, y, z);
      chordAttr.push(0.5);
      spanAttr.push(1);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aChord', new THREE.Float32BufferAttribute(chordAttr, 1));
  g.setAttribute('aSpan', new THREE.Float32BufferAttribute(spanAttr, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
