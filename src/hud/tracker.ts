import * as THREE from 'three';
import { HUD, RATE, damp } from '../../design-system/motion';
import spec from '../engine/tower-spec.json';
import type { Instance } from '../engine/tower';
import { MEDIA, follow, isPlaying, type Source } from './source';

/**
 * What the instrument shows for its target, as the reference does for a project: a name (typed in capitals), a subline
 * (client · year · host ↗) and one media source that every box looks through. `key` changes when the content does
 * (a new slot written on the live disk), which locks on again.
 */
export interface TrackerContent { key: string; name: string; client: string; year: string; host: string; url?: string; source: Source }

const MM = spec.mm;
const FACE = spec.disk.t / 2;
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

const LINE = 'rgb(236 236 236 / 85%)';
const SHADOW = 'rgb(0 0 0 / 70%)';
const FONT_LABEL = '500 11px Inter, "Helvetica Neue", Arial, sans-serif';
const FONT_TITLE = '600 13px Inter, "Helvetica Neue", Arial, sans-serif';
const FONT_ASCII = '600 8px "JetBrains Mono", Menlo, monospace';
const ASCII_RAMP = ['', '·', '/', '×', '□', '▣'];
const DASHES = [[], [3, 4], [6, 5], [1, 4], [12, 6]];

/** Measurement regions on the disk's label face, in millimetres (x right, y up, shutter edge at +y). Region 0 is the case outline. */
const REGIONS = [
  { x: 0, y: 0, w: 90, h: 94, labeled: true }, // case
  { x: 0, y: -19.2, w: 70, h: 55.6, labeled: true }, // label
  { x: 0.75, y: 31.45, w: 47.5, h: 30.9, labeled: true }, // shutter
  { x: 11.2, y: 30.25, w: 12, h: 25.5, labeled: false }, // shutter window
  { x: 0, y: 29.9, w: 9, h: 23.8, labeled: true }, // head window
  { x: -40, y: -38.25, w: 3.5, h: 4, labeled: true }, // write-protect
  { x: 40, y: -38.25, w: 3.5, h: 4, labeled: true }, // density hole
  { x: 42.5, y: 44.5, w: 5, h: 5, labeled: false }, // chamfer
  { x: 21.75, y: 45.75, w: 9.5, h: 2.5, labeled: false }, // drive-lever slot
  { x: -40.5, y: 37.5, w: 5, h: 8, labeled: true }, // insertion arrow
  { x: 0, y: 4.5, w: 70, h: 7.4, labeled: true }, // label header
  { x: -10, y: -6, w: 46, h: 5, labeled: false },
  { x: 26, y: -0.5, w: 16, h: 6, labeled: true },
  { x: 0, y: -1.5, w: 25, h: 25, labeled: true }, // hub, seen through the case
  { x: -41, y: 0, w: 8, h: 94, labeled: false },
  { x: 41, y: 0, w: 8, h: 94, labeled: false },
  { x: -5.1, y: 31.3, w: 61.4, h: 31.4, labeled: false }, // shutter recess
  { x: -10, y: -43.5, w: 46, h: 4, labeled: false },
  { x: 0, y: 20, w: 9, h: 9, labeled: false },
  { x: -44, y: 37, w: 3, h: 4.2, labeled: false }, // handling notch
] as const;

type Fill = 'image' | 'ascii' | 'pixels' | 'none';
type Outline = 'solid' | 'brackets' | 'dashed' | 'faint';
interface Box {
  x: number; y: number; w: number; h: number; labeled: boolean;
  delay: number; fill: Fill; outline: Outline; flash: number; focus: number; ticked: boolean;
  corners: boolean; cornerFilled: boolean; crossed: boolean; sizeLabel: boolean; labelSide: 'above' | 'below' | 'right'; nextFill: number;
}
interface Ring { angle: number; dash: number[]; dashSpeed: number; delay: number; meridian: boolean; opacity: number; tiltX: number; tiltZ: number; width: number; travellers: { square: boolean; offset: number; size: number; speed: number }[] }
interface Target { instance: Instance; content: TrackerContent; boxes: Box[]; rings: Ring[]; connection?: number[]; weights: Record<Fill, number>; shell: { x: number; y: number; z: number }; time: number }

type Rect = { left: number; top: number; width: number; height: number };

export interface TrackerOptions { onLock?: (pan: number) => void; onTick?: (pan: number) => void; reduced?: () => boolean }

export class Tracker {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private time = 0;
  private opacity = 0;
  private dim = 0;
  private reticle = 0;
  private travel = 0;
  private pointer?: { x: number; y: number };
  private pointerSpeed = 0;
  private target?: Target;
  private clear = true;
  private matrix = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private normal = new THREE.Vector3();

  constructor(private opts: TrackerOptions = {}) {
    this.canvas.className = 'tracker';
    this.canvas.setAttribute('aria-hidden', 'true');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is required for the tracker.');
    this.ctx = ctx;
    document.body.appendChild(this.canvas);
    this.resize();
  }

  get locked() { return this.target?.instance; }

  select(instance: Instance | undefined, content?: TrackerContent) {
    if (!instance || !content) return;
    // same disk and same content: keep the choreography; new content (a new slot written) locks on again
    if (instance.slab === this.target?.instance.slab && content.key === this.target.content.key) { this.target.instance = instance; return; }
    // the reference: pause the previous clip, load this source (if the stream hasn't yet) and play its clip
    if (this.target && this.target.content.source !== content.source) this.target.content.source.video?.pause();
    void content.source.load();
    content.source.video?.play().catch(() => {});
    const reduced = this.opts.reduced?.() ?? false;
    const compact = window.innerWidth < HUD.compactBelowPx; // phones and narrow windows: a smaller, sparser instrument
    const boxScale = compact ? HUD.compactBoxScale : HUD.boxScale;
    const [ringsMin, ringsMax] = compact ? HUD.compactRings : HUD.rings;
    const weights = { image: rand(0.2, 1), ascii: rand(0.1, 1), pixels: rand(0.1, 1), none: rand(0, 0.35) };
    const cornerShare = rand(0.15, 0.55);
    this.target = {
      instance,
      content,
      weights,
      connection: pick([[1, 3], [1, 3], [4, 4], [], undefined]),
      shell: { x: rand(68, 90), y: rand(70, 92), z: rand(26, 44) },
      time: this.time,
      boxes: REGIONS.slice(0, compact ? HUD.compactBoxes : HUD.boxes).map((r, i) => ({
        ...r,
        labeled: r.labeled && i < (compact ? HUD.compactLabels : HUD.labels), // few readouts so they don't pile up
        w: i === 0 ? r.w : r.w * boxScale,
        h: i === 0 ? r.h : r.h * boxScale,
        delay: i === 0 || reduced ? 0 : rand(0, HUD.boxDelayMax / 1000),
        fill: i === 0 ? 'none' : this.rollFill(weights),
        outline: i === 0 ? 'solid' : this.rollOutline(),
        flash: 0, focus: 0, ticked: false,
        corners: i !== 0 && Math.random() < cornerShare,
        cornerFilled: Math.random() < 0.5,
        crossed: Math.random() < 0.35,
        sizeLabel: r.w >= 20 && Math.random() < 0.3,
        labelSide: pick(['above', 'above', 'above', 'below', 'right'] as const),
        nextFill: this.time + rand(1, 3),
      })),
      rings: Array.from({ length: Math.floor(rand(ringsMin, ringsMax)) }, () => ({
        angle: rand(-1, 1) * (Math.random() < 0.5 ? 0.7 : Math.PI),
        dash: pick(DASHES),
        dashSpeed: rand(-30, 30),
        delay: reduced ? 0 : rand(0, HUD.ringDelayMax / 1000),
        meridian: Math.random() < 0.45,
        opacity: rand(0.18, 0.75),
        tiltX: rand(-0.35, 0.35),
        tiltZ: rand(-0.35, 0.35),
        width: pick([0.75, 1, 1, 1.5]),
        travellers: Math.random() < 0.55
          ? Array.from({ length: Math.floor(rand(1, 4)) }, () => ({ square: Math.random() < 0.3, offset: Math.random(), size: rand(1.5, 3.2), speed: rand(0.04, 0.22) * (Math.random() < 0.5 ? -1 : 1) }))
          : [],
      })),
    };
    this.opacity = 1;
    this.opts.onLock?.(this.pan(instance));
  }

  private rollFill(w: Record<Fill, number>): Fill {
    let n = Math.random() * (w.image + w.ascii + w.pixels + w.none);
    for (const k of ['image', 'ascii', 'pixels', 'none'] as const) { n -= w[k]; if (n <= 0) return k; }
    return 'image';
  }
  private rollOutline(): Outline {
    const u = Math.random();
    return u < 0.5 ? 'solid' : u < 0.68 ? 'brackets' : u < 0.85 ? 'dashed' : 'faint';
  }
  private pan(inst: Instance) { return Math.max(-1, Math.min(1, (inst.slab.box.center.x / 0.8) * 0.5)); }

  private project(camera: THREE.Camera, x: number, y: number, z: number) {
    this.v.set(x * MM, y * MM, z * MM).applyMatrix4(this.matrix).project(camera);
    if (this.v.z > 1) return undefined;
    return { x: (this.v.x * 0.5 + 0.5) * window.innerWidth, y: (-this.v.y * 0.5 + 0.5) * window.innerHeight };
  }
  private measure(camera: THREE.Camera, r: { x: number; y: number; w: number; h: number }, z: number): Rect | undefined {
    let l = Infinity, t = Infinity, rr = -Infinity, b = -Infinity;
    for (const [sx, sy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      const p = this.project(camera, r.x + sx * r.w, r.y + sy * r.h, z);
      if (!p) return undefined;
      l = Math.min(l, p.x); t = Math.min(t, p.y); rr = Math.max(rr, p.x); b = Math.max(b, p.y);
    }
    return { left: l, top: t, width: rr - l, height: b - t };
  }

  update(o: { camera: THREE.Camera; cursor: 'idle' | 'hover' | 'drag'; dt: number; matrixOf: (i: Instance, out: THREE.Matrix4) => THREE.Matrix4; focused: boolean; hovering: boolean; pointer?: { x: number; y: number } }) {
    const { dt } = o;
    this.time += dt;
    if (o.pointer && this.pointer && dt > 0) {
      const speed = Math.hypot(o.pointer.x - this.pointer.x, o.pointer.y - this.pointer.y) / dt;
      this.pointerSpeed += (speed - this.pointerSpeed) * damp(RATE.overlay, dt);
    } else this.pointerSpeed *= Math.exp(-dt * 4);
    this.pointer = o.pointer ? { ...o.pointer } : undefined;
    this.travel += dt * (1 + Math.min(this.pointerSpeed / 500, HUD.travelBoostMax));
    if (!o.hovering) this.opacity = Math.max(0, this.opacity - dt / (HUD.leave / 1000));
    this.dim += (+o.focused - this.dim) * damp(RATE.overlay, dt);
    this.reticle += ((o.cursor === 'hover' ? 1 : o.cursor === 'drag' ? -1 : 0) - this.reticle) * damp(RATE.instrument, dt);
    const c = this.ctx, t = this.target;
    if (!t || this.opacity === 0) {
      if (!this.clear) { c.clearRect(0, 0, window.innerWidth, window.innerHeight); this.clear = true; }
      if (t && this.opacity === 0) { t.content.source.video?.pause(); this.target = undefined; }
      this.drawReticle();
      return;
    }
    o.matrixOf(t.instance, this.matrix);
    this.normal.set(0, 0, 1).transformDirection(this.matrix);
    this.v.setFromMatrixPosition(this.matrix).sub((o.camera as THREE.PerspectiveCamera).position);
    const face = (this.normal.dot(this.v) < 0 ? 1 : -1) * FACE;
    const age = this.time - t.time;
    const rects = t.boxes.map((b) => this.measure(o.camera, b, face));
    const main = rects[0];
    c.clearRect(0, 0, window.innerWidth, window.innerHeight);
    this.clear = false;
    if (main && this.dim > 0.01) this.drawSpotlight(main);
    c.globalAlpha = this.opacity;
    this.drawShell(o.camera, t, age);
    if (!main) { c.globalAlpha = 1; this.drawReticle(); return; }
    follow(t.content.source);
    const diag = Math.hypot(main.width, main.height), fw = Math.max(diag * 1.15, 1), fh = (fw * MEDIA.still.height) / MEDIA.still.width;
    const frame = { left: main.left + main.width / 2 - fw / 2, top: main.top + main.height / 2 - fh / 2, width: fw, height: fh };
    this.updateFocus(t, rects, dt);
    this.drawConnections(t, rects, age);
    t.boxes.forEach((b, i) => { const r = rects[i]; if (r) this.drawBox(b, r, frame, t, age); });
    this.drawTracking(t, rects, age);
    this.drawTitle(t, main, age);
    c.globalAlpha = 1;
    this.drawReticle();
  }

  private updateFocus(t: Target, rects: (Rect | undefined)[], dt: number) {
    t.boxes.forEach((b, i) => {
      const r = rects[i];
      let f = 0;
      if (r && this.pointer && b.w < 80) f = 1 - clamp01(Math.hypot(this.pointer.x - (r.left + r.width / 2), this.pointer.y - (r.top + r.height / 2)) / HUD.proximityPx);
      b.focus += (f - b.focus) * damp(RATE.proximity, dt);
    });
  }

  private ringPoint(t: Target, ring: Ring, a: number): [number, number, number] {
    const { shell } = t;
    let x: number, y: number, z: number;
    if (ring.meridian) { x = shell.x * Math.cos(a) * Math.cos(ring.angle); y = shell.y * Math.sin(a); z = shell.z * Math.cos(a) * Math.sin(ring.angle); }
    else { const e = Math.max(-1.2, Math.min(1.2, ring.angle)); x = shell.x * Math.cos(e) * Math.cos(a); y = shell.y * Math.sin(e); z = shell.z * Math.cos(e) * Math.sin(a); }
    const cx = Math.cos(ring.tiltX), sx = Math.sin(ring.tiltX), y1 = y * cx - z * sx, z1 = y * sx + z * cx;
    const cz = Math.cos(ring.tiltZ), sz = Math.sin(ring.tiltZ);
    return [x * cz - y1 * sz, x * sz + y1 * cz, z1];
  }

  private drawShell(camera: THREE.Camera, t: Target, age: number) {
    const c = this.ctx, steps = 72;
    for (const ring of t.rings) {
      const drawn = clamp01((age - ring.delay) / (HUD.ringDraw / 1000));
      if (drawn <= 0) continue;
      const pts: ({ x: number; y: number } | undefined)[] = [];
      for (let i = 0; i <= steps; i++) pts.push(this.project(camera, ...this.ringPoint(t, ring, (i / steps) * Math.PI * 2)));
      c.save();
      c.globalAlpha *= ring.opacity;
      c.strokeStyle = LINE; c.lineWidth = ring.width; c.lineCap = 'round';
      c.setLineDash(ring.dash); c.lineDashOffset = this.travel * ring.dashSpeed;
      c.beginPath();
      let pen = false;
      for (let i = 0; i <= steps * drawn; i++) { const p = pts[i]; if (!p) { pen = false; continue; } if (pen) c.lineTo(p.x, p.y); else { c.moveTo(p.x, p.y); pen = true; } }
      c.stroke();
      c.globalAlpha = this.opacity * drawn * 0.95;
      c.fillStyle = '#fff';
      for (const tr of ring.travellers) {
        const u = ((((tr.offset + this.travel * tr.speed) % 1) + 1) % 1) * steps, n = Math.floor(u), a = pts[n], b = pts[Math.min(n + 1, steps)];
        if (!a || !b) continue;
        const x = a.x + (b.x - a.x) * (u - n), y = a.y + (b.y - a.y) * (u - n);
        if (tr.square) c.fillRect(x - tr.size, y - tr.size, tr.size * 2, tr.size * 2); else { c.beginPath(); c.arc(x, y, tr.size, 0, Math.PI * 2); c.fill(); }
      }
      c.restore();
    }
  }

  private drawConnections(t: Target, rects: (Rect | undefined)[], age: number) {
    if (!t.connection) return;
    const c = this.ctx;
    const pts = t.boxes.map((b, i) => ({ b, r: rects[i] })).filter(({ b, r }) => r && age > b.delay && b.w < 80)
      .sort((p, q) => p.b.delay - q.b.delay).map(({ r }) => ({ x: r!.left + r!.width / 2, y: r!.top + r!.height / 2 }));
    c.save();
    c.globalAlpha *= t.connection.length > 0 ? 0.4 : 0.22;
    c.strokeStyle = LINE; c.lineWidth = 1; c.setLineDash(t.connection);
    c.beginPath();
    pts.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
    c.stroke();
    c.restore();
  }

  private drawBox(b: Box, r: Rect, frame: Rect, t: Target, age: number) {
    const c = this.ctx, local = age - b.delay;
    if (local <= 0) return;
    const reduced = this.opts.reduced?.() ?? false;
    if (!b.ticked) { b.ticked = true; b.flash = this.time + HUD.flash / 1000; this.opts.onTick?.(this.pan(t.instance)); }
    if (this.time > b.nextFill && b.fill !== 'none') { b.fill = this.rollFill(t.weights); b.flash = this.time + HUD.flash / 1000; b.nextFill = this.time + rand(HUD.fillRefresh[0], HUD.fillRefresh[1]) / 1000; }
    const source = t.content.source;
    const fill: Fill = b.fill === 'none' && b.focus > 0.5 && b.w < 80 ? 'image' : b.fill;
    const popping = local < HUD.pop / 1000;
    const strobe = !reduced && popping && Math.floor(this.time * HUD.strobeHz * 2) % 2 === 0;
    const scale = (reduced ? 1 : HUD.popScaleFrom - (HUD.popScaleFrom - 1) * clamp01(local / (HUD.pop / 1000))) * (1 + b.focus * HUD.proximityGrow);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const min = fill === 'none' || b.w >= 80 ? 0 : 30;
    const w = Math.round(Math.max(r.width, min) * scale), h = Math.round(Math.max(r.height, min) * scale);
    const box = { left: Math.round(cx - w / 2), top: Math.round(cy - h / 2), width: w, height: h };
    c.save();
    c.globalAlpha *= strobe ? 0.3 : 1;
    if ((fill !== 'none' && w >= 18 && h >= 18) || this.time < b.flash) {
      c.save();
      c.beginPath(); c.rect(box.left, box.top, w, h); c.clip();
      if (this.time < b.flash) { c.fillStyle = 'rgb(255 255 255 / 85%)'; c.fillRect(box.left, box.top, w, h); }
      else if (fill === 'image') c.drawImage(source.video && isPlaying(source) ? source.video : source.image, frame.left, frame.top, frame.width, frame.height);
      else if (fill === 'pixels') { c.imageSmoothingEnabled = false; c.drawImage(source.pixels, frame.left, frame.top, frame.width, frame.height); c.imageSmoothingEnabled = true; }
      else if (fill === 'ascii') this.drawAscii(source, box, frame);
      c.restore();
    }
    this.drawOutline(b, box);
    if (b.crossed && w >= 18) { c.strokeStyle = LINE; c.beginPath(); c.moveTo(cx - 3, cy - 3); c.lineTo(cx + 3, cy + 3); c.moveTo(cx + 3, cy - 3); c.lineTo(cx - 3, cy + 3); c.stroke(); }
    if (b.labeled || b.focus > 0.4) this.drawLabel(b, box, local);
    c.restore();
  }

  private drawOutline(b: Box, r: Rect) {
    const c = this.ctx, right = r.left + r.width, bottom = r.top + r.height;
    c.save();
    c.strokeStyle = LINE; c.lineWidth = 1;
    c.globalAlpha *= b.outline === 'faint' ? 0.35 + b.focus * 0.65 : 0.85 + b.focus * 0.15;
    if (b.outline === 'brackets') {
      const arm = Math.min(7, r.width / 2, r.height / 2);
      c.beginPath();
      for (const [x, y, dx, dy] of [[r.left, r.top, 1, 1], [right, r.top, -1, 1], [right, bottom, -1, -1], [r.left, bottom, 1, -1]]) {
        c.moveTo(x + 0.5 + dx * arm, y + 0.5); c.lineTo(x + 0.5, y + 0.5); c.lineTo(x + 0.5, y + 0.5 + dy * arm);
      }
      c.stroke();
    } else { c.setLineDash(b.outline === 'dashed' ? [3, 3] : []); c.strokeRect(r.left + 0.5, r.top + 0.5, r.width, r.height); }
    if (b.corners || b.focus > 0.35) {
      const s = 4 + b.focus;
      c.setLineDash([]); c.fillStyle = '#fff';
      for (const [x, y] of [[r.left, r.top], [right, r.top], [right, bottom], [r.left, bottom]]) {
        if (b.cornerFilled) c.fillRect(x - s / 2, y - s / 2, s, s); else c.strokeRect(x - s / 2 + 0.5, y - s / 2 + 0.5, s, s);
      }
    }
    c.restore();
  }

  private text(s: string, x: number, y: number, font: string, baseline: CanvasTextBaseline) {
    const c = this.ctx;
    c.fillStyle = '#fff'; c.font = font; c.textBaseline = baseline; c.shadowBlur = 3; c.shadowColor = SHADOW;
    c.fillText(s, x, y);
    c.shadowBlur = 0;
  }

  private drawLabel(b: Box, r: Rect, local: number) {
    const dpr = window.devicePixelRatio || 1;
    const scramble = local < HUD.scramble / 1000;
    const n = (v: number) => (scramble ? Math.floor(Math.random() * 3000) : Math.round(v * dpr));
    const label = b.sizeLabel ? `w: ${n(r.width)}  h: ${n(r.height)}` : `x: ${n(r.left + r.width / 2)}  y: ${n(r.top + r.height / 2)}`;
    if (b.labelSide === 'below') this.text(label, r.left, r.top + r.height + 4, FONT_LABEL, 'top');
    else if (b.labelSide === 'right') this.text(label, r.left + r.width + 6, r.top + r.height / 2, FONT_LABEL, 'middle');
    else this.text(label, r.left, r.top - 4, FONT_LABEL, 'bottom');
  }

  private drawTracking(t: Target, rects: (Rect | undefined)[], age: number) {
    const c = this.ctx, p = this.pointer;
    if (!p) return;
    let near: { x: number; y: number } | undefined, best: number = HUD.trackingPx;
    t.boxes.forEach((b, i) => {
      const r = rects[i];
      if (!r || b.w >= 80 || age < b.delay) return;
      const q = { x: r.left + r.width / 2, y: r.top + r.height / 2 }, d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < best) { near = q; best = d; }
    });
    if (!near) return;
    c.save();
    c.globalAlpha *= 0.7;
    c.setLineDash([2, 3]); c.lineDashOffset = -this.travel * 20;
    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(near.x, near.y);
    c.strokeStyle = SHADOW; c.lineWidth = 3; c.stroke();
    c.strokeStyle = LINE; c.lineWidth = 1; c.stroke();
    this.text(`d: ${Math.round(best * (window.devicePixelRatio || 1))}`, p.x + 14, p.y + 10, FONT_LABEL, 'top');
    c.restore();
  }

  private drawSpotlight(r: Rect) {
    const c = this.ctx, cx = r.left + r.width / 2, cy = r.top + r.height / 2, rad = Math.max(Math.hypot(r.width, r.height) * 0.75, 160);
    c.save();
    c.globalAlpha = this.dim * this.opacity * 0.78;
    c.fillStyle = '#000';
    c.fillRect(0, 0, window.innerWidth, window.innerHeight);
    const g = c.createRadialGradient(cx, cy, rad * 0.45, cx, cy, rad * 1.15);
    g.addColorStop(0, 'rgb(0 0 0 / 100%)'); g.addColorStop(1, 'rgb(0 0 0 / 0%)');
    c.globalAlpha = 1; c.globalCompositeOperation = 'destination-out'; c.fillStyle = g;
    c.fillRect(0, 0, window.innerWidth, window.innerHeight);
    c.restore();
  }

  private drawAscii(s: Source, box: Rect, frame: Rect) {
    const c = this.ctx, cell = 8;
    const x0 = frame.left + Math.floor((box.left - frame.left) / cell) * cell, y0 = frame.top + Math.floor((box.top - frame.top) / cell) * cell;
    c.fillStyle = 'rgb(0 0 0 / 55%)'; c.fillRect(box.left, box.top, box.width, box.height);
    c.font = FONT_ASCII; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let y = y0; y < box.top + box.height; y += cell) for (let x = x0; x < box.left + box.width; x += cell) {
      const u = Math.floor(clamp01((x - frame.left) / frame.width) * 0.999 * MEDIA.sample.width);
      const v = Math.floor(clamp01((y - frame.top) / frame.height) * 0.999 * MEDIA.sample.height);
      const l0 = s.luminance[v * MEDIA.sample.width + u] ?? 0, l = s.isBright ? 1 - l0 : l0;
      const glyph = ASCII_RAMP[Math.min(ASCII_RAMP.length - 1, Math.floor(l * ASCII_RAMP.length))];
      if (l > 0.18) { c.fillStyle = `rgb(255 255 255 / ${Math.round(l * 45)}%)`; c.fillRect(x, y, 7, 7); }
      if (glyph) { c.fillStyle = '#fff'; c.fillText(glyph, x + cell / 2, y + cell / 2); }
    }
    c.textAlign = 'left';
  }

  /** The reference's title: the name typed in capitals 36 px above the box, then `client · year · host ↗` fading in. */
  private drawTitle(t: Target, main: Rect, age: number) {
    const c = this.ctx, { name, client, year, host, url } = t.content;
    const [t0, t1] = HUD.titleType, [s0, s1] = HUD.subline;
    const shown = Math.floor(clamp01((age * 1000 - t0) / (t1 - t0)) * name.length);
    const link = `${host}${url ? '  ↗' : ''}`;
    // compact screens: the subline breaks in two so it never runs off the edge (the reference had one line)
    const lines = window.innerWidth < HUD.compactBelowPx ? [`${client}  ·  ${year}`, link] : [`${client}  ·  ${year}  ·  ${link}`];
    c.font = FONT_LABEL;
    const width = Math.max(...lines.map((l) => c.measureText(l).width), (c.font = FONT_TITLE, c.measureText(name.toUpperCase()).width));
    const gutter = 16, lead = 16 * (lines.length - 1);
    const x = Math.round(Math.min(Math.max(main.left, gutter), window.innerWidth - gutter - width));
    const y = Math.round(Math.max(main.top, 60 + lead));
    c.save();
    this.text(name.slice(0, shown).toUpperCase(), x, y - 36 - lead, FONT_TITLE, 'bottom');
    c.globalAlpha *= clamp01((age * 1000 - s0) / (s1 - s0));
    lines.forEach((l, i) => this.text(l, x, y - 20 - lead + i * 16, FONT_LABEL, 'bottom'));
    c.restore();
  }

  private drawReticle() {
    const c = this.ctx, p = this.pointer, n = this.reticle;
    if (!p) return;
    const r = 7 + n * 4 + Math.sin(this.time * 6) * (1 + Math.max(n, 0));
    const gap = 2 + Math.max(n, 0) * 2, tick = 5 - Math.min(n, 0) * 2, turn = this.time * (0.6 + Math.max(n, 0) * 2.4);
    c.save();
    c.globalAlpha = 0.95;
    c.beginPath();
    c.arc(p.x, p.y, r, 0, Math.PI * 2);
    for (let i = 0; i < 4; i++) {
      const a = turn + (i * Math.PI) / 2, cx = Math.cos(a), cy = Math.sin(a);
      c.moveTo(p.x + cx * (r + gap), p.y + cy * (r + gap));
      c.lineTo(p.x + cx * (r + gap + tick), p.y + cy * (r + gap + tick));
    }
    c.strokeStyle = SHADOW; c.lineWidth = 3; c.stroke();
    c.strokeStyle = LINE; c.lineWidth = 1; c.stroke();
    c.fillStyle = '#fff';
    c.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
    c.restore();
    this.clear = false;
  }

  resize() {
    const r = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * r);
    this.canvas.height = Math.round(window.innerHeight * r);
    this.ctx.setTransform(r, 0, 0, r, 0, 0);
    this.clear = false;
  }
}

export const REGION_COUNT = REGIONS.length;
