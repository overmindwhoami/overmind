/**
 * The DIRTYPXLS treatment for the places in the room (docs/reference-dirtypxls, our own reconstruction of its
 * techniques). When the camera arrives at a place, the picture dissolves block by block into 1-bit ordered dither:
 * soft grey ink on black, hard pixels three CSS pixels wide, the place itself held still. Out of it streams a field of
 * short marks following a current, stepping every 40 ms like the reference (1–3 drawn pixels a step). Readable
 * content (the computer's screen) is masked out by the composer and stays clean.
 *
 * This class simulates the marks and draws them into a low-resolution target (one texel per drawn pixel) that the
 * composer's final pass reads: red = ink, green = the accent (one red pixel, the live point of the place).
 */
import * as THREE from 'three';

export const DIRTY = {
  /** CSS pixels per drawn pixel. */
  pixel: 3,
  ink: new THREE.Color('#d0d0d0'),
  accent: new THREE.Color('#ff0000'),
  /** Seconds per step of the marks (the reference's 40 ms frames). */
  step: 0.04,
  marks: 5200,
  /** Each mark is drawn as a dash this many steps long (its recent path). */
  dash: 2.6,
};

/** A place's current: where marks are born and which way they flow. Coordinates are drawn pixels, y down. */
export interface Current {
  /** The place's outline on screen (drawn pixels): marks are born along it. */
  rect: { x0: number; y0: number; x1: number; y1: number };
  /** The live point (the cursor, the write head): one red pixel that breathes. */
  live?: { x: number; y: number };
  kind: 'rise' | 'pour' | 'rain' | 'spiral' | 'radial';
}

const TAU = Math.PI * 2;

export class Dirty {
  readonly target: THREE.WebGLRenderTarget;
  /** 0 = the normal render, 1 = fully dirty (the composer dissolves block by block in between). */
  amount = 0;
  private w = 1;
  private h = 1;
  private pos: Float32Array;
  private prev: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private speed: Float32Array;
  private lines: THREE.LineSegments;
  private positions: Float32Array;
  private colors: Float32Array;
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private scene = new THREE.Scene();
  private clock = 0;
  private steps = 0;
  private seeded = false;

  constructor() {
    const n = DIRTY.marks;
    this.pos = new Float32Array(n * 2);
    this.prev = new Float32Array(n * 2);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.speed = new Float32Array(n);
    this.positions = new Float32Array((n + 2) * 6);
    this.colors = new Float32Array((n + 2) * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.scene.add(this.lines);
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
  }

  /** Drawing-buffer size and pixel ratio: the marks live on the drawn-pixel grid. */
  resize(width: number, height: number, ratio: number) {
    const p = Math.max(1, Math.round(DIRTY.pixel * ratio));
    this.w = Math.max(1, Math.floor(width / p));
    this.h = Math.max(1, Math.floor(height / p));
    this.target.setSize(this.w, this.h);
    this.seeded = false;
    return p;
  }
  get size() { return { w: this.w, h: this.h }; }

  private flow(x: number, y: number, t: number, kind: Current['kind'], cx: number, cy: number): [number, number] {
    const a = TAU * (Math.sin(x * 0.018 + t * 0.6) * Math.cos(y * 0.021 - t * 0.4) + 0.35 * Math.sin((x + y) * 0.043 + t));
    let vx = Math.cos(a) * 0.6, vy = Math.sin(a) * 0.6;
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) + 1e-3;
    if (kind === 'rise') { vx += 0.35; vy -= 1.0; }
    else if (kind === 'rain') { vx = vx * 0.25 + 0.1; vy = 1.2; }
    else if (kind === 'radial') { vx += (dx / d) * 1.1; vy += (dy / d) * 1.1; }
    else if (kind === 'spiral') { vx += (-dy / d) * 1.1 - (dx / d) * 0.25; vy += (dx / d) * 1.1 - (dy / d) * 0.25; }
    else { vx += 1.0; vy += 0.25; } // pour: sideways, a little down, like a cape in wind
    const n = Math.hypot(vx, vy) + 1e-6;
    return [vx / n, vy / n];
  }

  private born(i: number, c: Current) {
    // along the place's outline, a little outside it
    const { x0, y0, x1, y1 } = c.rect;
    const u = Math.random(), side = Math.random();
    let x: number, y: number;
    if (c.kind === 'rain') { x = x0 + (x1 - x0) * u; y = y0 - Math.random() * 30; }
    else if (side < 0.3) { x = x0 + (x1 - x0) * u; y = y0; }
    else if (side < 0.5) { x = x0 + (x1 - x0) * u; y = y1; }
    else if (side < 0.75) { x = x0; y = y0 + (y1 - y0) * u; }
    else { x = x1; y = y0 + (y1 - y0) * u; }
    this.pos[i * 2] = this.prev[i * 2] = x + (Math.random() - 0.5) * 4;
    this.pos[i * 2 + 1] = this.prev[i * 2 + 1] = y + (Math.random() - 0.5) * 4;
    this.age[i] = 0;
    this.life[i] = 25 + Math.random() * 55;
    this.speed[i] = 1.2 + Math.random() * 2; // drawn pixels a step, as measured in the reference
  }

  private stepOnce(c: Current) {
    const n = DIRTY.marks, t = this.steps * DIRTY.step;
    const cx = (c.rect.x0 + c.rect.x1) / 2, cy = (c.rect.y0 + c.rect.y1) / 2;
    for (let i = 0; i < n; i++) {
      const x = this.pos[i * 2], y = this.pos[i * 2 + 1];
      const [vx, vy] = this.flow(x, y, t, c.kind, cx, cy);
      this.prev[i * 2] = x; this.prev[i * 2 + 1] = y;
      this.pos[i * 2] = x + vx * this.speed[i];
      this.pos[i * 2 + 1] = y + vy * this.speed[i];
      this.age[i]++;
      const px = this.pos[i * 2], py = this.pos[i * 2 + 1];
      if (this.age[i] > this.life[i] || px < -8 || py < -8 || px > this.w + 8 || py > this.h + 8) this.born(i, c);
    }
    this.steps++;
  }

  /** Advances the marks on the 40 ms grid (only while the treatment shows) and redraws them. */
  update(dt: number, current: Current | undefined, renderer: THREE.WebGLRenderer) {
    if (this.amount <= 0 || !current) return;
    if (!this.seeded) {
      for (let i = 0; i < DIRTY.marks; i++) { this.born(i, current); this.age[i] = Math.random() * this.life[i]; }
      for (let s = 0; s < 40; s++) this.stepOnce(current); // a full field from the first frame
      this.seeded = true;
    }
    this.clock += dt;
    while (this.clock >= DIRTY.step) { this.clock -= DIRTY.step; this.stepOnce(current); }
    // short dashes: each mark draws its last step; every third one rests, which breaks the strands up
    const P = this.positions, C = this.colors, n = DIRTY.marks;
    const nx = (x: number) => (x / this.w) * 2 - 1, ny = (y: number) => 1 - (y / this.h) * 2;
    for (let i = 0; i < n; i++) {
      const o = i * 6, show = this.age[i] > 1 && (i + this.steps) % 3 !== 0;
      const tx = this.pos[i * 2] - (this.pos[i * 2] - this.prev[i * 2]) * DIRTY.dash, ty = this.pos[i * 2 + 1] - (this.pos[i * 2 + 1] - this.prev[i * 2 + 1]) * DIRTY.dash;
      P[o] = show ? nx(tx) : -9; P[o + 1] = show ? ny(ty) : -9; P[o + 2] = 0;
      P[o + 3] = show ? nx(this.pos[i * 2]) : -9; P[o + 4] = show ? ny(this.pos[i * 2 + 1]) : -9; P[o + 5] = 0;
      C[o] = C[o + 3] = 1; C[o + 1] = C[o + 4] = 0; C[o + 2] = C[o + 5] = 0;
    }
    // the accent: a 2-pixel red mark at the live point, on for six steps, off for six
    const o = n * 6, live = current.live, on = live && Math.floor(this.steps / 6) % 2 === 0;
    for (let k = 0; k < 2; k++) {
      const q = o + k * 6;
      P[q] = on ? nx(live!.x - 0.5) : -9; P[q + 1] = on ? ny(live!.y + k - 0.5) : -9; P[q + 2] = 0;
      P[q + 3] = on ? nx(live!.x + 1.5) : -9; P[q + 4] = on ? ny(live!.y + k - 0.5) : -9; P[q + 5] = 0;
      C[q] = C[q + 3] = 0; C[q + 1] = C[q + 4] = 1; C[q + 2] = C[q + 5] = 0;
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.lines.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.target.dispose();
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}
