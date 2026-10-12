/**
 * Label atlas: one die-cut paper label per replica, drawn in millimetres along the wrap path
 * (front panel, the bend round the bottom edge, then the Side 0 flap, which is printed upside down so it reads
 * correctly when the disk is turned over). Original Overmind designs; no real brand marks.
 */
import * as THREE from 'three';
import { FEATURES, LABEL, LABEL_LENGTH, Z1 } from './spec';
import { rng } from './textures';

export interface LabelData { index: number; gen: number; parent: number | null; hash: string; block: number; born: string; label: number; seed: number; alive: boolean;
  /** Slots written so far on a live disk (draws 90 ticks along the bottom of the front panel). */
  progress?: number;
  /** A coin launched through the Overmind (COIN_LABEL): its picture, ticker and name, printed on the wall's disks. */
  coin?: { ticker: string; name: string; mint: string; date: string; image?: CanvasImageSource } }

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
/**
 * Every label prints in PP NeueBit, the site's bitmap face. Its capitals are about two thirds the height of the
 * faces the templates were laid out with (and narrower), so sizes scale up to keep each line's height.
 */
const BIT = '"PP NeueBit", Menlo, monospace';
const BIT_SCALE = 1.45;
const sans = (c: Ctx, t: string, x: number, y: number, size: number, w = 500, align: CanvasTextAlign = 'left', ls = 0) => {
  c.font = `${w >= 600 ? 700 : 400} ${size * BIT_SCALE}px ${BIT}`; c.letterSpacing = `${ls}px`; c.textAlign = align; c.fillText(t, x, y); c.letterSpacing = '0px';
};
const mono = (c: Ctx, t: string, x: number, y: number, size: number, w = 400, align: CanvasTextAlign = 'left') => {
  c.font = `${w >= 600 ? 700 : 400} ${size * BIT_SCALE}px ${BIT}`; c.textAlign = align; c.fillText(t, x, y);
};
/** The written-on lines: NeueBit too, still a little crooked and in pen colours (`font` picks only the tilt's seed now). */
function hand(c: Ctx, t: string, x: number, y: number, size: number, font: string, r: () => number, ink = '#1d2433') {
  void font;
  c.save();
  c.translate(x, y); c.rotate((r() - 0.5) * 0.06);
  c.font = `400 ${size * 1.35}px ${BIT}`; c.textAlign = 'left'; c.fillStyle = ink; c.globalAlpha = 0.9;
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

/** The face every label prints in. Load these before painting. */
export const LABEL_FONTS = ['400 12px "PP NeueBit"', '700 12px "PP NeueBit"'];

/** 90 ruled ticks along the bottom of the front panel: filled for written slots, hollow for the rest. */
function drawProgress(c: Ctx, written: number) {
  const x0 = 4, x1 = W - 4, y = FRONT - 9.5, step = (x1 - x0) / 90;
  c.save();
  c.fillStyle = 'rgba(244,242,236,0.92)'; c.fillRect(x0 - 1.5, y - 1.6, x1 - x0 + 3, 6.4);
  for (let k = 0; k < 90; k++) {
    const x = x0 + k * step;
    c.fillStyle = k < written ? '#151515' : 'rgba(21,21,21,0.18)';
    c.fillRect(x + 0.1, y, step * 0.62, k % 10 === 9 ? 3.6 : 2.6);
  }
  c.fillStyle = '#151515';
  sans(c, `${written}/90`, x1, y - 2.4, 1.6, 600, 'right', 0.2);
  c.restore();
}

/** A label with nothing on it yet: the blank disks in the vending machine and on the explorer wall. */
export const BLANK_LABEL = 1000;
function blank(c: Ctx) {
  dieCut(c); c.fillStyle = PAPER[0]; c.fill();
  c.strokeStyle = 'rgba(30,30,30,0.16)';
  for (let y = 16; y < FRONT - 6; y += 6.2) rule(c, 5, y, W - 5, y, 0.18);
}

/** A coin's label: a black header strip, its picture, $TICKER and name, the day it launched; its mint on the flap. */
export const COIN_LABEL = 1001;
function coinLabel(c: Ctx, d: LabelData) {
  const k = d.coin!;
  dieCut(c); c.fillStyle = PAPER[2]; c.fill();
  c.save(); dieCut(c); c.clip();
  c.fillStyle = '#111'; c.fillRect(0, 0, W, 7.2);
  c.fillStyle = '#f2f2f2'; sans(c, 'OVERMIND', 4, 5.2, 2.6, 700, 'left', 0.5); sans(c, 'LAUNCHED HERE', W - 4, 5.2, 2.2, 400, 'right', 0.3);
  c.restore();
  // the picture, square, with a hairline
  const x = 4, y = 10.5, s = 27;
  if (k.image) { c.save(); c.beginPath(); c.rect(x, y, s, s); c.clip(); c.drawImage(k.image, x, y, s, s); c.restore(); }
  else { c.fillStyle = '#dcdad3'; c.fillRect(x, y, s, s); c.fillStyle = '#9a978e'; sans(c, '$', x + s / 2, y + s / 2 + 3, 8, 700, 'center'); }
  c.strokeStyle = 'rgba(20,20,20,0.35)'; c.lineWidth = 0.25; c.strokeRect(x, y, s, s);
  // ticker and name, fitted to the column beside it
  const col = W - (x + s + 3) - 4, tx = x + s + 3;
  c.fillStyle = '#121212';
  let size = 7.2; c.font = `700 ${size * BIT_SCALE}px ${BIT}`;
  while (size > 3 && c.measureText(`$${k.ticker}`).width > col) { size -= 0.3; c.font = `700 ${size * BIT_SCALE}px ${BIT}`; }
  sans(c, `$${k.ticker}`, tx, y + 7.5, size, 700);
  c.fillStyle = '#3a3a3a';
  const words = k.name.split(/\s+/), lines: string[] = []; let line = '';
  c.font = `400 ${3.2 * BIT_SCALE}px ${BIT}`;
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (c.measureText(t).width > col && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((l, i) => sans(c, l, tx, y + 13.5 + i * 4.4, 3.2, 400));
  // the line it was written on
  c.strokeStyle = 'rgba(30,30,30,0.3)'; rule(c, 4, 42, W - 4, 42, 0.2);
  c.fillStyle = '#4a4a4a'; mono(c, k.date, 4, 47.2, 2.4); mono(c, `${k.mint.slice(0, 4)}…${k.mint.slice(-4)}`, W - 4, 47.2, 2.4, 400, 'right');
  flap(c, () => { c.fillStyle = '#555'; mono(c, k.mint, W / 2, 9, 1.55, 400, 'center'); });
}

function paint(c: Ctx, d: LabelData) {
  if (d.label === BLANK_LABEL) { blank(c); return; }
  if (d.label === COIN_LABEL && d.coin) { coinLabel(c, d); return; }
  TEMPLATES[d.label % TEMPLATES.length](c, d, rng(d.seed ^ 0x51ab));
  if (d.progress !== undefined) drawProgress(c, d.progress);
}

/**
 * Label atlas painted on demand: cols × rows cells of W × LABEL_LENGTH mm, transparent outside each die-cut label.
 * `cell(key, data)` returns a cell for a disk, painting it the first time (or when `repaint` is set) and evicting the
 * least recently used label. With a renderer, each label is copied into its cell on the GPU (no full re-upload).
 */
export class LabelAtlas {
  readonly tex: THREE.CanvasTexture;
  readonly canvas = document.createElement('canvas');
  private cellCanvas = document.createElement('canvas');
  private cellTex: THREE.Texture;
  private cw: number;
  private ch: number;
  private owner: (number | undefined)[] = [];
  private lookup = new Map<number, number>();
  private used: number[] = [];
  private clock = 0;

  /** `cols` × `rows` cells (the tower's atlas is 10 × 6; the explorer wall keeps one of its own, a cell per cubby). */
  constructor(width: number, private renderer?: THREE.WebGLRenderer, readonly cols = 10, readonly rows = 6) {
    this.cw = Math.floor(width / this.cols);
    this.ch = Math.floor((this.cw * LABEL_LENGTH) / W);
    this.canvas.width = this.cw * this.cols; this.canvas.height = this.ch * this.rows;
    this.cellCanvas.width = this.cw; this.cellCanvas.height = this.ch;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.cellTex = new THREE.Texture(this.cellCanvas);
    this.owner = Array.from({ length: this.cols * this.rows }, () => undefined);
    this.used = this.owner.map(() => -1);
  }

  get capacity() { return this.cols * this.rows; }

  /** Cell index for disk `key`; paints `data` into it when new or when `repaint` is set. */
  cell(key: number, data: LabelData, repaint = false) {
    this.clock++;
    let cell = this.lookup.get(key);
    if (cell === undefined) {
      cell = this.used.indexOf(Math.min(...this.used));
      const old = this.owner[cell];
      if (old !== undefined) this.lookup.delete(old);
      this.owner[cell] = key;
      this.lookup.set(key, cell);
      repaint = true;
    }
    this.used[cell] = this.clock;
    if (repaint) this.paintCell(cell, data);
    return cell;
  }

  private paintCell(cell: number, data: LabelData) {
    const c = this.cellCanvas.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.cw, this.ch);
    c.textBaseline = 'alphabetic';
    if (data.label >= 0) { c.save(); c.setTransform(this.cw / W, 0, 0, this.ch / LABEL_LENGTH, 0, 0); paint(c, data); c.restore(); }
    const col = cell % this.cols, row = Math.floor(cell / this.cols);
    if (this.renderer) {
      this.cellTex.needsUpdate = true;
      this.renderer.copyTextureToTexture(this.cellTex, this.tex, null, new THREE.Vector2(col * this.cw, this.canvas.height - (row + 1) * this.ch));
    } else {
      const g = this.canvas.getContext('2d')!;
      g.clearRect(col * this.cw, row * this.ch, this.cw, this.ch);
      g.drawImage(this.cellCanvas, col * this.cw, row * this.ch);
      this.tex.needsUpdate = true;
    }
  }
}
