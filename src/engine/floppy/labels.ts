/**
 * Label atlas: one die-cut paper label per replica, drawn in millimetres along the wrap path
 * (front panel, the bend round the bottom edge, then the Side 0 flap, which is printed upside down so it reads
 * correctly when the disk is turned over). Original Overmind designs; no real brand marks.
 */
import * as THREE from 'three';
import { FEATURES, LABEL, LABEL_LENGTH, Z1 } from './spec';
import { rng } from './textures';

export interface LabelData { index: number; gen: number; parent: number | null; hash: string; block: number; born: string; label: number; seed: number; alive: boolean }

const W = LABEL.w;
const FRONT = LABEL.front - (LABEL.edge + LABEL.bend); // straight front panel length
const WRAP = Math.PI * LABEL.bend + 2 * (Z1 - FEATURES.side1.labelRecess.depth + LABEL.paper - LABEL.bend);
const BACK_AT = FRONT + WRAP; // start of the Side 0 flap
const BACK = LABEL_LENGTH - BACK_AT;

export const LABEL_TEMPLATES = ['Index', 'Registry', 'Obsidian', 'Stripe', 'Marker'] as const;

const fmtBlock = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');
const gen3 = (g: number) => String(g).padStart(3, '0');
const HAND = ['"Bradley Hand"', 'Noteworthy', '"Marker Felt"', '"Chalkboard SE"', '"Comic Sans MS"', 'cursive'];
const PAPER = ['#f4f2ec', '#efede6', '#f6f6f4', '#ebe7dc'];

type Ctx = CanvasRenderingContext2D;
const sans = (c: Ctx, t: string, x: number, y: number, size: number, w = 500, align: CanvasTextAlign = 'left', ls = 0) => {
  c.font = `${w} ${size}px Inter, "Helvetica Neue", Arial, sans-serif`; c.letterSpacing = `${ls}px`; c.textAlign = align; c.fillText(t, x, y); c.letterSpacing = '0px';
};
const mono = (c: Ctx, t: string, x: number, y: number, size: number, w = 400, align: CanvasTextAlign = 'left') => {
  c.font = `${w} ${size}px "JetBrains Mono", Menlo, Consolas, monospace`; c.textAlign = align; c.fillText(t, x, y);
};
function hand(c: Ctx, t: string, x: number, y: number, size: number, font: string, r: () => number, ink = '#1d2433') {
  c.save();
  c.translate(x, y); c.rotate((r() - 0.5) * 0.06);
  c.font = `${size}px ${font}, cursive`; c.textAlign = 'left'; c.fillStyle = ink; c.globalAlpha = 0.9;
  c.fillText(t, 0, 0);
  c.restore();
}
const rule = (c: Ctx, x1: number, y1: number, x2: number, y2: number, w = 0.2) => { c.lineWidth = w; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };

function dataMatrix(c: Ctx, hash: string, x: number, y: number, cells: number, cell: number) {
  const bits = hash.split('').flatMap((h) => parseInt(h, 16).toString(2).padStart(4, '0').split('').map(Number));
  let b = 0;
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const on = i === 0 || j === cells - 1 ? 1 : j === 0 ? (i % 2 === 0 ? 1 : 0) : i === cells - 1 ? (j % 2 === 1 ? 1 : 0) : bits[b++ % bits.length];
    if (on) c.fillRect(x + i * cell, y + j * cell, cell * 0.94, cell * 0.94);
  }
}

/** Die-cut outline: rounded corners at the front top and at the flap top. */
function dieCut(c: Ctx) {
  c.beginPath(); c.roundRect(0, 0, W, LABEL_LENGTH, LABEL.corner);
}

/** Back flap: content drawn in flap coordinates (0..W × 0..BACK), rotated 180° to read upright from Side 0. */
function flap(c: Ctx, draw: () => void) {
  c.save();
  c.translate(W, BACK_AT + BACK); c.rotate(Math.PI);
  draw();
  c.restore();
}

const TEMPLATES: ((c: Ctx, d: LabelData, r: (a?: number, b?: number) => number) => void)[] = [
  // Index: black header band, ruled lines, handwritten entries
  (c, d, r) => {
    const font = HAND[Math.floor(r(0, HAND.length - 1))];
    c.fillStyle = PAPER[Math.floor(r(0, PAPER.length))]; dieCut(c); c.fill();
    c.fillStyle = '#111'; c.fillRect(0, 0, W, 7.4);
    c.fillStyle = '#f2f2f2';
    sans(c, 'OVERMIND', 3, 5.1, 3.1, 600, 'left', 0.55);
    sans(c, 'MF-2HD  1.44 MB', W - 3, 5, 2.1, 500, 'right', 0.2);
    c.strokeStyle = '#9a9a9a';
    for (let k = 0; k < 6; k++) rule(c, 3, 15.5 + k * 6.2, W - 3, 15.5 + k * 6.2, 0.16);
    c.fillStyle = '#444';
    sans(c, 'REPLICA', 3, 10.6, 1.45, 600, 'left', 0.3);
    sans(c, 'GEN', W - 16, 10.6, 1.45, 600, 'left', 0.3);
    hand(c, d.parent ? `fork of G${gen3(d.parent)}` : 'genesis', 4, 14.6, 4.2, font, r);
    hand(c, `G${gen3(d.gen)}`, W - 16, 14.6, 4.6, font, r);
    hand(c, `0x${d.hash.slice(0, 6)}…${d.hash.slice(-4)}`, 4, 20.8, 4, font, r);
    hand(c, `blk ${fmtBlock(d.block)}`, 4, 27, 3.8, font, r);
    if (d.alive) hand(c, 'LIVE — do not erase', 4, 33.2, 3.6, font, r, '#7a1a1a');
    hand(c, d.born.replace(/-/g, '.'), W - 22, 45.6, 3.4, font, r);
    c.fillStyle = '#555';
    sans(c, 'DOUBLE SIDED · HIGH DENSITY · 135 TPI', 3, FRONT - 3, 1.35, 500, 'left', 0.2);
    flap(c, () => { c.fillStyle = '#111'; sans(c, `OVERMIND  ·  G${gen3(d.gen)}`, 3, 5.4, 2.2, 600, 'left', 0.3); });
  },
  // Registry: printed field grid filled in by typewriter
  (c, d) => {
    c.fillStyle = '#f1efe8'; dieCut(c); c.fill();
    c.strokeStyle = '#2a2a2a'; c.fillStyle = '#2a2a2a';
    sans(c, 'OVERMIND', 3, 6, 3.4, 600, 'left', 0.7);
    sans(c, 'REPLICA REGISTRY', W - 3, 6, 1.7, 600, 'right', 0.35);
    rule(c, 3, 8.4, W - 3, 8.4, 0.35);
    const rows: [string, string][] = [['GENERATION', `G·${gen3(d.gen)}`], ['PARENT', d.parent ? `G·${gen3(d.parent)}` : '—'], ['BLOCK', fmtBlock(d.block)], ['BORN', d.born]];
    rows.forEach(([k, v], i) => {
      const y = 11 + i * 7;
      c.lineWidth = 0.18; c.strokeRect(3, y, W - 6, 6);
      sans(c, k, 4.2, y + 2.4, 1.3, 600, 'left', 0.25);
      mono(c, v, 24, y + 4.6, 2.8, 400);
    });
    mono(c, d.hash.slice(0, 32).replace(/(.{4})/g, '$1 ').trim(), 3, 43, 1.75);
    mono(c, d.hash.slice(32).replace(/(.{4})/g, '$1 ').trim(), 3, 45.8, 1.75);
    dataMatrix(c, d.hash, W - 13.5, FRONT - 13, 12, 0.85);
    sans(c, '2HD', 3, FRONT - 3.2, 3, 600, 'left', 0.2);
    flap(c, () => { c.fillStyle = '#2a2a2a'; mono(c, `G·${gen3(d.gen)}  ${d.hash.slice(0, 16)}`, 3, 5.6, 2, 400); });
  },
  // Obsidian: black label, white print, oversized generation numeral
  (c, d) => {
    c.fillStyle = '#121212'; dieCut(c); c.fill();
    c.fillStyle = c.strokeStyle = '#e9e9e9';
    sans(c, 'OVERMIND', 3.4, 6.4, 2.8, 600, 'left', 0.9);
    sans(c, d.parent ? `REPLICA OF G·${gen3(d.parent)}` : 'GENESIS', W - 3.4, 6.4, 1.6, 500, 'right', 0.3);
    rule(c, 3.4, 9, W - 3.4, 9, 0.22);
    mono(c, gen3(d.gen), 2.4, 33, 21, 600);
    rule(c, 3.4, 37, W - 3.4, 37, 0.22);
    mono(c, `BLOCK ${fmtBlock(d.block)}`, 3.4, 41.4, 1.9, 400);
    mono(c, d.born, W - 3.4, 41.4, 1.9, 400, 'right');
    mono(c, `0x${d.hash.slice(0, 40)}`, 3.4, 44.6, 1.45, 400);
    for (let k = 0; k < 4; k++) c.fillRect(3.4, FRONT - 6 + k * 1.1, W - 6.8, 0.5);
    flap(c, () => { c.fillStyle = '#e9e9e9'; sans(c, 'OVERMIND', 3, 5.6, 2.2, 600, 'left', 0.6); mono(c, `G·${gen3(d.gen)}`, W - 3, 5.6, 2.2, 600, 'right'); });
  },
  // Stripe: brushed-silver label with a diagonal band and a handwritten title
  (c, d, r) => {
    const font = HAND[Math.floor(r(0, HAND.length - 1))];
    const g = c.createLinearGradient(0, 0, W, LABEL_LENGTH);
    g.addColorStop(0, '#bdbdc0'); g.addColorStop(0.5, '#e4e4e6'); g.addColorStop(1, '#8f8f93');
    c.fillStyle = g; dieCut(c); c.fill();
    c.save(); dieCut(c); c.clip();
    c.fillStyle = 'rgba(0,0,0,0.16)';
    for (let x = -LABEL_LENGTH; x < W + LABEL_LENGTH; x += 1.6) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 0.6, 0); c.lineTo(x + 0.6 + 16, 16); c.lineTo(x + 16, 16); c.fill(); }
    c.restore();
    c.fillStyle = '#f6f6f4'; c.fillRect(3, 19, W - 6, 26);
    c.fillStyle = '#151515';
    sans(c, 'OVERMIND', 3, 7.5, 4.2, 700, 'left', 0.6);
    sans(c, 'MF2HD · 1.44', W - 3, 7.2, 2.1, 600, 'right', 0.2);
    hand(c, `gen ${d.gen}`, 6, 29, 6.2, font, r);
    hand(c, d.parent ? `← g${d.parent}` : 'origin', 6, 38, 4.4, font, r);
    hand(c, d.born.slice(2).replace(/-/g, '/'), W - 24, 38, 3.6, font, r);
    sans(c, 'REPLICA MEDIUM', 3, FRONT - 3, 1.6, 600, 'left', 0.4);
    flap(c, () => { c.fillStyle = '#151515'; sans(c, `OVERMIND MF2HD`, 3, 5.6, 2, 700, 'left', 0.5); });
  },
  // Marker: bare paper, quick marker handwriting, an earlier entry crossed out
  (c, d, r) => {
    const font = HAND[Math.floor(r(0, 3))];
    c.fillStyle = PAPER[Math.floor(r(0, PAPER.length))]; dieCut(c); c.fill();
    hand(c, 'overmind', 6, 15, 7.2, font, r, '#141414');
    hand(c, `g${d.gen}`, 6, 27, 9, font, r, '#141414');
    if (d.parent) {
      const old = `g${Math.max(1, d.parent - 1)} tmp`;
      hand(c, old, 38, 27, 4.2, font, r, '#141414');
      c.strokeStyle = '#141414'; rule(c, 37, 25.6, 37 + old.length * 2.2, 25, 0.5);
    }
    hand(c, `blk ${fmtBlock(d.block)}`, 6, 37, 4, font, r, '#2b3a6b');
    if (d.alive) hand(c, 'keep!!', W - 22, 46, 5, font, r, '#8a1414');
  },
];

/** Faces the printed templates use (handwriting uses system fonts). Load these before painting. */
export const LABEL_FONTS = ['500 12px Inter', '600 12px Inter', '700 12px Inter', '400 12px "JetBrains Mono"', '600 12px "JetBrains Mono"'];

/**
 * Atlas of cols × rows cells of W × LABEL_LENGTH mm, transparent outside each die-cut label.
 * `paint()` draws the labels; call it once the web fonts have loaded (canvas text silently falls back otherwise).
 */
export function buildLabelAtlas(labels: LabelData[], width: number) {
  const cols = 10; // 4096 px → 409 px per 70 mm label (≈ 1:1 at the closest tower view), 41 MB like the slab atlas
  const cw = Math.floor(width / cols);
  const ch = Math.floor((cw * LABEL_LENGTH) / W);
  const rows = Math.ceil(Math.max(1, Math.max(...labels.map((l) => l.index)) + 1) / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cw * cols; canvas.height = ch * rows;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('2D canvas is required for the label atlas.');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const paint = () => {
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.textBaseline = 'alphabetic';
    for (const d of labels) {
      if (d.label < 0) continue;
      const x0 = (d.index % cols) * cw, y0 = Math.floor(d.index / cols) * ch;
      c.save();
      c.beginPath(); c.rect(x0, y0, cw, ch); c.clip();
      c.setTransform(cw / W, 0, 0, ch / LABEL_LENGTH, x0, y0);
      TEMPLATES[d.label % TEMPLATES.length](c, d, rng(d.seed ^ 0x51ab));
      c.restore();
    }
    tex.needsUpdate = true;
  };
  return { tex, cols, rows, canvas, paint };
}
