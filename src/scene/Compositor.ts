import * as THREE from 'three';

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Linear HDR inputs. The seat map (A) is rendered without tone mapping and the
// cabin (B) with Khronos PBR Neutral, so each input gets its own curve before the
// blend; the result matches frames rendered straight to the screen.
const fragment = /* glsl */ `
  uniform sampler2D tA;
  uniform sampler2D tB;
  uniform float mixT;
  uniform float useA;
  uniform float useB;
  uniform float blur;
  uniform vec2 center;
  varying vec2 vUv;

  vec3 neutralTM(vec3 color) {
    const float StartCompression = 0.8 - 0.04;
    const float Desaturation = 0.15;
    float x = min(color.r, min(color.g, color.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    color -= offset;
    float peak = max(color.r, max(color.g, color.b));
    if (peak < StartCompression) return color;
    float d = 1.0 - StartCompression;
    float newPeak = 1.0 - d * d / (peak + d - StartCompression);
    color *= newPeak / peak;
    float g = 1.0 - 1.0 / (Desaturation * (peak - newPeak) + 1.0);
    return mix(color, vec3(newPeak), g);
  }

  vec4 samp(vec2 uv) {
    vec3 c = vec3(0.0);
    if (useA > 0.5) c += clamp(texture2D(tA, uv).rgb, 0.0, 1.0) * (useB > 0.5 ? 1.0 - mixT : 1.0);
    if (useB > 0.5) c += neutralTM(max(texture2D(tB, uv).rgb, 0.0)) * (useA > 0.5 ? mixT : 1.0);
    return vec4(c, 1.0);
  }

  void main() {
    vec4 col;
    if (blur < 0.0005) {
      col = samp(vUv);
    } else {
      vec2 dir = vUv - center;
      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      vec4 acc = vec4(0.0);
      for (int i = 0; i < 14; i++) {
        float t = (float(i) + n) / 14.0;
        acc += samp(center + dir * (1.0 - blur * t));
      }
      col = acc / 14.0;
    }
    gl_FragColor = vec4(col.rgb, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Compositor {
  private readonly rtA: THREE.WebGLRenderTarget;
  private readonly rtB: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const opts = { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 } as const;
    this.rtA = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, opts);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tA: { value: this.rtA.texture },
        tB: { value: this.rtB.texture },
        mixT: { value: 0 },
        useA: { value: 1 },
        useB: { value: 0 },
        blur: { value: 0 },
        center: { value: new THREE.Vector2(0.5, 0.5) },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    const quad = new THREE.Mesh(geo, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** A render target to compile/warm the linear-output shader variants against. */
  get warmTarget() {
    return this.rtA;
  }

  setSize(width: number, height: number) {
    const w = Math.max(4, Math.floor(width));
    const h = Math.max(4, Math.floor(height));
    if (this.rtA.width !== w || this.rtA.height !== h) {
      this.rtA.setSize(w, h);
      this.rtB.setSize(w, h);
    }
  }

  /** Render one or both scenes and blend them with an optional zoom blur towards `center` (uv). */
  render(
    renderer: THREE.WebGLRenderer,
    a: { scene: THREE.Scene; camera: THREE.Camera } | null,
    b: { scene: THREE.Scene; camera: THREE.Camera } | null,
    mix: number,
    blur: number,
    center: THREE.Vector2,
  ) {
    const u = this.material.uniforms;
    if (a) {
      renderer.setRenderTarget(this.rtA);
      renderer.clear();
      renderer.render(a.scene, a.camera);
    }
    if (b) {
      renderer.setRenderTarget(this.rtB);
      renderer.clear();
      renderer.render(b.scene, b.camera);
    }
    renderer.setRenderTarget(null);
    u.useA.value = a ? 1 : 0;
    u.useB.value = b ? 1 : 0;
    u.mixT.value = mix;
    u.blur.value = blur;
    (u.center.value as THREE.Vector2).copy(center);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.material.dispose();
  }
}
