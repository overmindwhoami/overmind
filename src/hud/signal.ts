import type { Replica } from '../engine/tower';

/**
 * Placeholder "mind state" imagery for each replica: the only colour on the site, shown inside the instrument
 * the way the reference shows project media. Generated on demand from the replica hash (tiny canvases, no decode).
 */
export interface Signal { image: HTMLCanvasElement; pixels: HTMLCanvasElement; luminance: Float32Array; isBright: boolean }

export const SIGNAL = { width: 640, height: 360, sample: { width: 96, height: 54 }, pixels: { width: 28, height: 16 } } as const;
const cache = new Map<number, Signal>();

function canvas(w: number, h: number, opts?: CanvasRenderingContext2DSettings) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', opts);
  if (!ctx) throw new Error('2D canvas is required for replica signals.');
  return { c, ctx };
}

function rng(seed: number) {
  let s = seed >>> 0;
  return (a = 0, b = 1) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return a + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (b - a);
  };
}

export function signalFor(rep: Replica): Signal {
  const hit = cache.get(rep.index);
  if (hit) return hit;
  const r = rng(rep.seed ^ 0x51a7);
  const { width: W, height: H } = SIGNAL;
  const { c: image, ctx } = canvas(W, H);
  const hue = (parseInt(rep.hash.slice(0, 3), 16) / 4096) * 360;
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, `hsl(${hue} 70% 12%)`);
  base.addColorStop(1, `hsl(${(hue + 40) % 360} 80% 22%)`);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  // Interference bands: one per strand of inherited / learned activity
  const bands = 6 + Math.floor(r(0, 6));
  for (let b = 0; b < bands; b++) {
    const learned = b / bands > rep.inherited;
    const h = learned ? (hue + 150 + r(-20, 20)) % 360 : (hue + r(-25, 25) + 360) % 360;
    const amp = r(20, 90), freq = r(0.006, 0.02), phase = r(0, Math.PI * 2), y0 = r(40, H - 40);
    ctx.strokeStyle = `hsl(${h} 90% ${learned ? 62 : 48}% / ${learned ? 0.55 : 0.35})`;
    ctx.lineWidth = r(6, 28);
    ctx.beginPath();
    for (let x = -20; x <= W + 20; x += 8) {
      const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 2.7 + phase * 1.3) * amp * 0.3;
      if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Activation nodes
  const nodes = rep.alive ? 40 : 16;
  for (let n = 0; n < nodes; n++) {
    const x = r(0, W), y = r(0, H), rad = r(4, 26);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `hsl(${(hue + 160) % 360} 100% 75% / 0.8)`);
    g.addColorStop(1, 'hsl(0 0% 0% / 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.globalCompositeOperation = 'source-over';

  const { c: pixels, ctx: px } = canvas(SIGNAL.pixels.width, SIGNAL.pixels.height);
  px.drawImage(image, 0, 0, SIGNAL.pixels.width, SIGNAL.pixels.height);
  const { ctx: sample } = canvas(SIGNAL.sample.width, SIGNAL.sample.height, { willReadFrequently: true });
  sample.drawImage(image, 0, 0, SIGNAL.sample.width, SIGNAL.sample.height);
  const data = sample.getImageData(0, 0, SIGNAL.sample.width, SIGNAL.sample.height).data;
  const luminance = new Float32Array(SIGNAL.sample.width * SIGNAL.sample.height);
  let total = 0;
  for (let i = 0; i < luminance.length; i++) {
    luminance[i] = (data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722) / 255;
    total += luminance[i];
  }
  const signal = { image, pixels, luminance, isBright: total / luminance.length > 0.55 };
  cache.set(rep.index, signal);
  return signal;
}
