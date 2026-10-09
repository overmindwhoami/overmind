import * as THREE from 'three';

/** Post chain: velocity blur + circle of confusion → bokeh gather → bloom pyramid → grade (CA, bloom, vignette, ACES, sRGB, saturation, contrast, grain). */
const COMMON = `precision highp float;
in vec2 vUv; out vec4 fragColor;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;
const VERT = `in vec2 position; out vec2 vUv; void main() { vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;
const FRAG = {
  motion: `uniform sampler2D tColor; uniform sampler2D tDepth;
uniform mat4 uProjectionInverse; uniform mat4 uReproject; uniform vec2 uResolution;
uniform float uAperture; uniform float uFocus; uniform float uFrame; uniform float uLensMaximum; uniform float uShutter; uniform float uCap;
void main() {
  float depth = texture(tDepth, vUv).r;
  vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjectionInverse * clip;
  float dist = -view.z / view.w;
  vec2 velocity = vec2(0.0);
  if (depth < 1.0) { vec4 prev = uReproject * clip; velocity = (clip.xy - prev.xy / prev.w) * 0.5 * uShutter; }
  float travel = length(velocity * uResolution), cap = uResolution.y * uCap;
  if (travel > cap) velocity *= cap / travel;
  float jitter = hash12(gl_FragCoord.xy + fract(uFrame * 0.618) * 97.0) - 0.5;
  vec3 color = vec3(0.0);
  for (int i = 0; i < 12; i++) color += texture(tColor, vUv - velocity * ((float(i) + 0.5 + jitter) / 12.0 - 0.5)).rgb;
  color /= 12.0;
  float coc = depth < 1.0 ? uAperture * (dist - uFocus) / dist * uResolution.y : uLensMaximum;
  fragColor = vec4(color, clamp(coc, -uLensMaximum, uLensMaximum));
}`,
  lens: `uniform sampler2D tMap; uniform vec2 uTexel; uniform float uFrame; uniform float uMaximum;
void main() {
  vec4 center = texture(tMap, vUv);
  float centerSize = abs(center.a);
  vec3 color = center.rgb; float total = 1.0; float radius = 1.25;
  float angle = hash12(gl_FragCoord.xy + fract(uFrame * 0.618) * 113.0) * 6.28318;
  for (int i = 0; i < 160; i++) {
    if (radius >= uMaximum) break;
    vec4 tap = texture(tMap, vUv + vec2(cos(angle), sin(angle)) * radius * uTexel);
    float size = abs(tap.a);
    if (tap.a > center.a) size = clamp(size, 0.0, centerSize * 2.0);
    color += mix(color / total, tap.rgb, smoothstep(radius - 0.5, radius + 0.5, size));
    total += 1.0; radius += 1.25 / radius; angle += 2.39996323;
  }
  fragColor = vec4(color / total, 1.0);
}`,
  prefilter: `uniform sampler2D tMap; uniform vec2 uTexel; uniform float uThreshold;
vec3 tap(vec2 o) { vec3 c = texture(tMap, vUv + o * uTexel).rgb; return c / (1.0 + luma(c)); }
void main() {
  vec3 c = (tap(vec2(-1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0))) * 0.25;
  c /= max(1.0 - luma(c), 1e-4);
  fragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.5, luma(c)), 1.0);
}`,
  down: `uniform sampler2D tMap; uniform vec2 uTexel;
vec3 s(vec2 o) { return texture(tMap, vUv + o * uTexel).rgb; }
void main() {
  vec3 c = s(vec2(0.0)) * 0.125;
  c += (s(vec2(-2.0, -2.0)) + s(vec2(2.0, -2.0)) + s(vec2(-2.0, 2.0)) + s(vec2(2.0, 2.0))) * 0.03125;
  c += (s(vec2(0.0, -2.0)) + s(vec2(-2.0, 0.0)) + s(vec2(2.0, 0.0)) + s(vec2(0.0, 2.0))) * 0.0625;
  c += (s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0))) * 0.125;
  fragColor = vec4(c, 1.0);
}`,
  up: `uniform sampler2D tCurrent; uniform sampler2D tSmaller; uniform vec2 uTexel; uniform float uRadius;
void main() {
  vec2 d = uTexel * uRadius;
  vec3 c = texture(tSmaller, vUv).rgb * 4.0;
  c += (texture(tSmaller, vUv + vec2(-d.x, 0.0)).rgb + texture(tSmaller, vUv + vec2(d.x, 0.0)).rgb
      + texture(tSmaller, vUv + vec2(0.0, -d.y)).rgb + texture(tSmaller, vUv + vec2(0.0, d.y)).rgb) * 2.0;
  c += texture(tSmaller, vUv - d).rgb + texture(tSmaller, vUv + d).rgb
     + texture(tSmaller, vUv + vec2(-d.x, d.y)).rgb + texture(tSmaller, vUv + vec2(d.x, -d.y)).rgb;
  fragColor = vec4(texture(tCurrent, vUv).rgb + c / 16.0, 1.0);
}`,
  final: `uniform sampler2D tFrame; uniform sampler2D tBloom; uniform vec2 uResolution; uniform vec3 uTint;
uniform float uAberration; uniform float uBloom; uniform float uContrast; uniform float uExposure;
uniform float uGrain; uniform float uSaturation; uniform float uTime; uniform float uVignette;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 p = vUv - 0.5; float r = length(p); vec2 shift = p * r * uAberration;
  vec3 c = vec3(texture(tFrame, vUv + shift).r, texture(tFrame, vUv).g, texture(tFrame, vUv - shift).b);
  vec3 b = texture(tBloom, vUv).rgb;
  c += mix(b, uTint * luma(b), 0.35) * uBloom;
  c *= 1.0 - smoothstep(0.25, 0.85, r) * uVignette;
  c = srgb(aces(c * uExposure));
  c = mix(vec3(luma(c)), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;
  c += (hash12(floor(vUv * uResolution) + fract(uTime) * vec2(1931.0, 2713.0)) - 0.5) * uGrain;
  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
};

export interface PostSettings {
  aperture: number; lensMaximum: number; shutter: number; blurCap: number; threshold: number; bloomRadius: number;
  bloom: number; aberration: number; contrast: number; exposure: number; grain: number; saturation: number; vignette: number;
}

type Uniforms = Record<string, THREE.IUniform>;
export class Composer {
  readonly scene: THREE.WebGLRenderTarget;
  private motion: THREE.WebGLRenderTarget;
  private lens: THREE.WebGLRenderTarget;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private size = new THREE.Vector2();
  private u: Record<keyof typeof FRAG, Uniforms>;
  private pass: Record<keyof typeof FRAG, THREE.Mesh>;

  constructor(private renderer: THREE.WebGLRenderer) {
    renderer.getDrawingBufferSize(this.size);
    const { x, y } = this.size;
    const target = (w: number, h: number) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.scene = new THREE.WebGLRenderTarget(x, y, { type: THREE.HalfFloatType, samples: 2, depthTexture: new THREE.DepthTexture(x, y) });
    this.motion = target(x, y);
    this.lens = target(x, y);
    for (let i = 0; i < 6; i++) {
      const s = this.levelSize(i);
      this.down.push(target(s.w, s.h));
      if (i < 5) this.up.push(target(s.w, s.h));
    }
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
    tri.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
    const f = (value: unknown = 0) => ({ value });
    const v2 = () => f(new THREE.Vector2());
    const m4 = () => f(new THREE.Matrix4());
    this.u = {
      motion: { tColor: f(this.scene.texture), tDepth: f(this.scene.depthTexture), uProjectionInverse: m4(), uReproject: m4(), uResolution: v2(), uAperture: f(), uFocus: f(1), uFrame: f(), uLensMaximum: f(), uShutter: f(), uCap: f(0.035) },
      lens: { tMap: f(this.motion.texture), uTexel: v2(), uFrame: f(), uMaximum: f() },
      prefilter: { tMap: f(this.lens.texture), uTexel: v2(), uThreshold: f(1) },
      down: { tMap: f(null), uTexel: v2() },
      up: { tCurrent: f(null), tSmaller: f(null), uTexel: v2(), uRadius: f(1) },
      final: { tFrame: f(this.lens.texture), tBloom: f(this.up[0].texture), uResolution: v2(), uTint: f(new THREE.Color('#ffffff')), uAberration: f(), uBloom: f(), uContrast: f(1), uExposure: f(1), uGrain: f(), uSaturation: f(1), uTime: f(), uVignette: f() },
    };
    const make = (k: keyof typeof FRAG) => {
      const mesh = new THREE.Mesh(tri, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: COMMON + FRAG[k], uniforms: this.u[k], depthTest: false, depthWrite: false }));
      mesh.frustumCulled = false;
      return mesh;
    };
    this.pass = { motion: make('motion'), lens: make('lens'), prefilter: make('prefilter'), down: make('down'), up: make('up'), final: make('final') };
  }

  private levelSize(i: number) {
    const d = 2 ** (i + 1);
    return { w: Math.max(1, Math.round(this.size.x / d)), h: Math.max(1, Math.round(this.size.y / d)) };
  }

  private draw(k: keyof typeof FRAG, target: THREE.WebGLRenderTarget | null) {
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.pass[k], this.camera);
  }

  render(o: { dt: number; focus: number; frame: number; time: number; projectionInverse: THREE.Matrix4; reproject: THREE.Matrix4; settings: PostSettings }) {
    const { x, y } = this.size, s = o.settings, u = this.u;
    u.motion.uAperture.value = s.aperture;
    u.motion.uFocus.value = o.focus;
    u.motion.uFrame.value = o.frame;
    u.motion.uLensMaximum.value = s.lensMaximum;
    (u.motion.uProjectionInverse.value as THREE.Matrix4).copy(o.projectionInverse);
    (u.motion.uReproject.value as THREE.Matrix4).copy(o.reproject);
    (u.motion.uResolution.value as THREE.Vector2).set(x, y);
    u.motion.uShutter.value = s.shutter / Math.max(o.dt * 60, 0.25);
    u.motion.uCap.value = s.blurCap;
    this.draw('motion', this.motion);
    u.lens.uFrame.value = o.frame;
    u.lens.uMaximum.value = s.lensMaximum;
    (u.lens.uTexel.value as THREE.Vector2).set(1 / x, 1 / y);
    this.draw('lens', this.lens);
    (u.prefilter.uTexel.value as THREE.Vector2).set(1 / x, 1 / y);
    u.prefilter.uThreshold.value = s.threshold;
    this.draw('prefilter', this.down[0]);
    for (let i = 1; i < this.down.length; i++) {
      const src = this.down[i - 1];
      u.down.tMap.value = src.texture;
      (u.down.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      this.draw('down', this.down[i]);
    }
    u.up.uRadius.value = s.bloomRadius;
    for (let i = this.up.length - 1; i >= 0; i--) {
      const smaller = i === this.up.length - 1 ? this.down[i + 1] : this.up[i + 1];
      u.up.tCurrent.value = this.down[i].texture;
      u.up.tSmaller.value = smaller.texture;
      (u.up.uTexel.value as THREE.Vector2).set(1 / smaller.width, 1 / smaller.height);
      this.draw('up', this.up[i]);
    }
    const fu = u.final;
    fu.uAberration.value = s.aberration; fu.uBloom.value = s.bloom; fu.uContrast.value = s.contrast; fu.uExposure.value = s.exposure;
    fu.uGrain.value = s.grain; fu.uSaturation.value = s.saturation; fu.uTime.value = o.time; fu.uVignette.value = s.vignette;
    (fu.uResolution.value as THREE.Vector2).set(x, y);
    this.draw('final', null);
  }

  resize() {
    this.renderer.getDrawingBufferSize(this.size);
    const { x, y } = this.size;
    this.scene.setSize(x, y);
    this.motion.setSize(x, y);
    this.lens.setSize(x, y);
    this.down.forEach((t, i) => { const s = this.levelSize(i); t.setSize(s.w, s.h); });
    this.up.forEach((t, i) => { const s = this.levelSize(i); t.setSize(s.w, s.h); });
  }
}
