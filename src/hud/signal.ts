/**
 * What the instrument shows inside its boxes: the only colour on the site. For archive slots that is the saved
 * item's own preview image (cached by scripts/thumbs.py so the canvas can read its pixels); papers and old web pages
 * get a typographic card; empty slots a dim field. Signals are filled in place when an image finishes loading.
 */
import type { Item, Slot } from '../archive/types';

export interface Signal { image: HTMLCanvasElement; pixels: HTMLCanvasElement; luminance: Float32Array; isBright: boolean }

export const SIGNAL = { width: 640, height: 360, sample: { width: 96, height: 54 }, pixels: { width: 28, height: 16 } } as const;
const cache = new Map<string, Signal>();

function canvas(w: number, h: number, opts?: CanvasRenderingContext2DSettings) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', opts);
  if (!ctx) throw new Error('2D canvas is required for signals.');
  return { c, ctx };
}
const hashOf = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** Derive the small copies the instrument samples (pixel mosaic, luminance for the ASCII fill) from `image`. */
function derive(sig: Signal) {
  const px = sig.pixels.getContext('2d')!;
  px.clearRect(0, 0, sig.pixels.width, sig.pixels.height);
  px.drawImage(sig.image, 0, 0, SIGNAL.pixels.width, SIGNAL.pixels.height);
  const { ctx: sample } = canvas(SIGNAL.sample.width, SIGNAL.sample.height, { willReadFrequently: true });
  sample.drawImage(sig.image, 0, 0, SIGNAL.sample.width, SIGNAL.sample.height);
  const data = sample.getImageData(0, 0, SIGNAL.sample.width, SIGNAL.sample.height).data;
  let total = 0;
  for (let i = 0; i < sig.luminance.length; i++) {
    sig.luminance[i] = (data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722) / 255;
    total += sig.luminance[i];
  }
  sig.isBright = total / sig.luminance.length > 0.55;
  return sig;
}
function blank(): Signal {
  return { image: canvas(SIGNAL.width, SIGNAL.height).c, pixels: canvas(SIGNAL.pixels.width, SIGNAL.pixels.height).c, luminance: new Float32Array(SIGNAL.sample.width * SIGNAL.sample.height), isBright: false };
}

/** A card for items without a picture: the title set large on a field of the item's own colour. */
function card(sig: Signal, item: Item | undefined) {
  const g = sig.image.getContext('2d')!, W = SIGNAL.width, H = SIGNAL.height;
  if (!item) {
    g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 900; i++) g.fillRect((i * 97) % W, (i * 57) % H, 2, 2);
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.font = '600 22px "JetBrains Mono", Menlo, monospace'; g.fillText('-- nothing came through --', 40, H / 2);
    return derive(sig);
  }
  const hue = hashOf(item.id) % 360;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, `hsl(${hue} 55% 14%)`); bg.addColorStop(1, `hsl(${(hue + 50) % 360} 70% 30%)`);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const y = 40 + ((hashOf(item.id + i) % 280)), amp = 10 + (hashOf(item.id + 'a' + i) % 40);
    g.strokeStyle = `hsl(${(hue + 140 + i * 9) % 360} 90% 60% / 0.18)`; g.lineWidth = 6 + (i % 3) * 8;
    g.beginPath(); for (let x = -10; x <= W + 10; x += 10) { const yy = y + Math.sin(x * 0.012 + i) * amp; if (x < 0) g.moveTo(x, yy); else g.lineTo(x, yy); } g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(255,255,255,0.86)';
  g.font = '600 15px "JetBrains Mono", Menlo, monospace';
  g.fillText(`${item.source === 'arxiv' ? 'ARXIV' : item.source === 'wayback' ? 'WAYBACK MACHINE' : 'INTERNET ARCHIVE'}${item.year ? ' · ' + item.year : ''}`, 36, 52);
  g.font = '600 38px Inter, "Helvetica Neue", Arial, sans-serif';
  const words = item.title.split(/\s+/), lines: string[] = [];
  let line = '';
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > W - 72) { lines.push(line); line = w; } else line = t; }
  lines.push(line);
  lines.slice(0, 5).forEach((l, i) => g.fillText(i === 4 && lines.length > 5 ? l + '…' : l, 36, 120 + i * 46));
  return derive(sig);
}

/** Signal for a saved slot: its preview image when there is one (filled in when loaded), else a card. */
export function slotSignal(slot: Slot | undefined): Signal {
  const item = slot?.item;
  const key = item ? item.id : `empty-${slot?.disk}-${slot?.index}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sig = card(blank(), item);
  cache.set(key, sig);
  if (item?.thumb) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const g = sig.image.getContext('2d')!, W = SIGNAL.width, H = SIGNAL.height;
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight); // cover the frame
      g.drawImage(img, (W - img.naturalWidth * s) / 2, (H - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
      derive(sig);
    };
    img.src = item.thumb;
  }
  return sig;
}
