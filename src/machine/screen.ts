/**
 * What the Overmind's monitor shows (a 1024 × 768 canvas on the CRT):
 *   live   the page being saved right now and the writer window typing its note
 *   dir    a disk's directory, A:\ style, one row per slot
 *   entry  one saved item: its picture, excerpt, the note, the link to the real thing
 *   load   the drive reading a disk
 * Hit regions are reported in canvas pixels so the app can turn a click on the tube into an action.
 */
import * as THREE from 'three';
import { fmtDate, fmtDisk, fmtTime } from '../archive/sim';
import { sourceName } from '../archive/types';
import { SLOTS, SLOT_BYTES, type Disk, type Slot, type Verification } from '../archive/types';
import { isPlaying, type Source } from '../hud/source';

export const SCREEN_PX = { w: 1024, h: 768 } as const;
export type ScreenState =
  | { mode: 'live'; disk: Disk; slot?: Slot; typed: number; source?: Source; clock: number }
  | { mode: 'load'; disk: Disk; t: number; clock: number }
  | { mode: 'dir'; disk: Disk; slots: Slot[]; selected: number; scroll: number; clock: number; check?: CheckView }
  | { mode: 'entry'; disk: Disk; slot: Slot; source?: Source; clock: number }
  | { mode: 'term'; lines: { who: 'you' | 'om' | 'sys'; text: string; shown: number }[]; input: string; busy: boolean; clock: number };
export interface Hit { kind: 'row' | 'link' | 'back' | 'eject' | 'check' | 'seal'; index?: number }
/** CHECK as it prints: seconds since it started, and what it found (or why it couldn't run). */
export interface CheckView { t: number; result?: Verification; error?: string }

const W = SCREEN_PX.w, H = SCREEN_PX.h;
const SANS = (s: number, w = 400) => `${w} ${s}px Geneva, Inter, "Helvetica Neue", Arial, sans-serif`;
const MONO = (s: number, w = 400) => `${w} ${s}px "JetBrains Mono", Menlo, monospace`;
const SERIF = (s: number, w = 400) => `${w} ${s}px "Times New Roman", Times, serif`;
export const ROWS = 15; // directory rows visible at once

export class ScreenRenderer {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private hits: { x: number; y: number; w: number; h: number; hit: Hit }[] = [];

  constructor() {
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  hitAt(x: number, y: number): Hit | undefined {
    return this.hits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h)?.hit;
  }

  draw(s: ScreenState) {
    const g = this.g;
    this.hits = [];
    g.save();
    g.fillStyle = '#4a4a5a'; g.fillRect(0, 0, W, H); // desktop
    this.menuBar(s.clock);
    if (s.mode === 'live') this.live(s);
    else if (s.mode === 'load') this.load(s);
    else if (s.mode === 'dir') this.dir(s);
    else if (s.mode === 'term') this.term(s);
    else this.entry(s);
    // scanlines and the tube's vignette
    g.fillStyle = 'rgba(0,0,0,0.1)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.36, W / 2, H / 2, H * 0.8); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.36)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    g.restore();
    this.texture.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- chrome */
  private menuBar(clock: number) {
    const g = this.g;
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, W, 28); g.fillStyle = '#000'; g.fillRect(0, 27, W, 1);
    g.lineWidth = 3; g.strokeStyle = '#000'; g.beginPath(); g.arc(22, 14, 6, 0, Math.PI * 2); g.stroke();
    g.font = SANS(17, 700); g.fillStyle = '#000';
    ['File', 'Edit', 'View', 'Go', 'Disk', 'Window'].reduce((x, m) => { g.fillText(m, x, 20); return x + g.measureText(m).width + 26; }, 48);
    g.textAlign = 'right'; g.fillText(fmtTime(clock), W - 14, 20); g.textAlign = 'left';
  }
  private bevel(x: number, y: number, w: number, h: number, inset = false) {
    const g = this.g;
    g.fillStyle = '#c6c6c6'; g.fillRect(x, y, w, h);
    g.fillStyle = inset ? '#7a7a7a' : '#ffffff'; g.fillRect(x, y, w, 2); g.fillRect(x, y, 2, h);
    g.fillStyle = inset ? '#ffffff' : '#6a6a6a'; g.fillRect(x, y + h - 2, w, 2); g.fillRect(x + w - 2, y, 2, h);
  }
  private window(x: number, y: number, w: number, h: number, title: string, dark = false) {
    const g = this.g;
    g.fillStyle = '#000'; g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = '#e8e8e8'; g.fillRect(x, y, w, 26);
    g.fillStyle = '#202020'; for (let k = 5; k < 24; k += 3) g.fillRect(x + 30, y + k, w - 60, 1);
    g.font = SANS(15, 700); const tw = g.measureText(title).width;
    g.fillStyle = '#e8e8e8'; g.fillRect(x + w / 2 - tw / 2 - 10, y + 2, tw + 20, 22);
    g.fillStyle = '#000'; g.textAlign = 'center'; g.fillText(title, x + w / 2, y + 19); g.textAlign = 'left';
    g.strokeStyle = '#000'; g.lineWidth = 1.5; g.strokeRect(x + 9, y + 6, 14, 14);
    g.fillStyle = dark ? '#060606' : '#c0c0c0'; g.fillRect(x, y + 26, w, h - 26);
  }
  private wrap(text: string, font: string, width: number) {
    const g = this.g; g.font = font;
    const out: string[] = []; let line = '';
    for (const w of text.split(/\s+/)) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > width && line) { out.push(line); line = w; } else line = t; }
    if (line) out.push(line);
    return out;
  }
  private picture(src: Source | undefined, x: number, y: number, w: number, h: number) {
    const g = this.g;
    g.fillStyle = '#111'; g.fillRect(x, y, w, h);
    if (src) {
      const media = src.video && isPlaying(src) ? src.video : src.image;
      const iw = media instanceof HTMLVideoElement ? media.videoWidth : media.width, ih = media instanceof HTMLVideoElement ? media.videoHeight : media.height;
      const s = Math.max(w / iw, h / ih);
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
      g.drawImage(media, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
      g.restore();
    }
    g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w, h);
  }

  /** The saved page, as the period browser shows it (live and entry modes). */
  private page(x: number, y: number, w: number, h: number, slot: Slot | undefined, sig: Source | undefined, link: boolean) {
    const g = this.g, item = slot?.item;
    this.bevel(x, y, w, 40);
    g.font = SANS(14, 700); g.fillStyle = '#000'; g.fillText('Location:', x + 10, y + 26);
    this.bevel(x + 86, y + 7, w - 96, 26, true); g.fillStyle = '#fff'; g.fillRect(x + 88, y + 9, w - 100, 22);
    g.font = SANS(14); g.fillStyle = '#000';
    g.save(); g.beginPath(); g.rect(x + 90, y + 9, w - 104, 22); g.clip(); g.fillText(item?.url ?? 'about:blank', x + 94, y + 25); g.restore();
    const px = x + 2, py = y + 42, pw = w - 4, ph = h - 44;
    g.fillStyle = '#c0c0c0'; g.fillRect(px, py, pw, ph);
    if (!item) {
      g.fillStyle = '#444'; g.font = SERIF(26, 700); g.fillText('Nothing came through.', px + 30, py + 60);
      g.font = SERIF(18); g.fillText('The source did not answer this minute. The slot stays empty.', px + 30, py + 96);
      return;
    }
    const iw = Math.min(320, pw * 0.38), ih = iw * 0.5625; // the 16:9 still
    this.picture(sig, px + 20, py + 20, iw, ih);
    const tx = px + iw + 44, tw = pw - iw - 66;
    g.fillStyle = '#000080';
    const titleLines = this.wrap(item.title, SERIF(28, 700), tw).slice(0, 3);
    titleLines.forEach((l, i) => g.fillText(l, tx, py + 48 + i * 32));
    let ty = py + 48 + titleLines.length * 32 + 4;
    g.fillStyle = '#222'; g.font = SERIF(17, 700);
    g.fillText([item.year, item.creator, sourceName(item)].filter(Boolean).join(' · '), tx, ty);
    ty += 30;
    g.fillStyle = '#000';
    for (const l of this.wrap(item.excerpt || '(no description)', SERIF(19), tw).slice(0, 6)) { g.font = SERIF(19); g.fillText(l, tx, ty); ty += 25; }
    if (link) {
      ty += 10; g.font = SERIF(20); g.fillStyle = '#0000ee';
      const label = '⏎  Open the real thing';
      g.fillText(label, tx, ty); const lw = g.measureText(label).width; g.fillRect(tx, ty + 3, lw, 1.5);
      this.hits.push({ x: tx - 6, y: ty - 22, w: lw + 12, h: 32, hit: { kind: 'link' } });
    }
  }

  /* ---------------------------------------------------------------- modes */
  private live(s: Extract<ScreenState, { mode: 'live' }>) {
    const g = this.g;
    this.window(14, 38, W - 28, H - 50, s.slot?.item ? `Overmind — saving: ${s.slot.item.title.slice(0, 48)}` : 'Overmind — waiting');
    this.page(16, 64, W - 32, H - 78, s.slot, s.source, false);
    // writer window over the page
    const OX = W - 470, OY = H - 318, OW = 440, OH = 270;
    this.window(OX, OY, OW, OH, `OVERMIND — A:\\`, true);
    g.shadowColor = 'rgba(255,255,255,0.5)'; g.shadowBlur = 6;
    g.fillStyle = '#e6e6e6'; g.font = MONO(15, 600);
    g.fillText(`${fmtDisk(s.disk.n)}   SLOT ${String(s.disk.written).padStart(2, '0')}/${SLOTS}   ${fmtTime(s.clock)}`, OX + 16, OY + 52);
    for (let k = 0; k < SLOTS; k++) {
      const col = k % 30, row = Math.floor(k / 30);
      g.shadowBlur = k < s.disk.written ? 6 : 0;
      g.fillStyle = k < s.disk.written - 1 ? '#e6e6e6' : k === s.disk.written - 1 ? '#ffffff' : '#2e2e2e';
      g.fillRect(OX + 16 + col * 13.6, OY + 66 + row * 13, 9.5, 9.5);
    }
    g.shadowBlur = 6; g.fillStyle = '#e6e6e6'; g.font = MONO(14);
    g.fillText(s.slot ? `writing ${s.slot.file}` : 'waiting for the first slot', OX + 16, OY + 130);
    g.font = MONO(15);
    const note = s.slot ? `> ${s.slot.note}` : '> ';
    const shown = note.slice(0, Math.floor(note.length * s.typed));
    const lines = this.wrap(shown, MONO(15), OW - 40).slice(-5);
    lines.forEach((l, i) => g.fillText(l, OX + 16, OY + 160 + i * 21));
    const last = lines[lines.length - 1] ?? '';
    if (Math.floor(s.clock / 500) % 2 === 0 || s.typed < 1) g.fillRect(OX + 18 + g.measureText(last).width, OY + 160 + (lines.length - 1) * 21 - 15, 9, 18);
    g.shadowBlur = 0;
  }

  /** The terminal: the conversation, newest at the bottom, the visitor's line under it. */
  private term(s: Extract<ScreenState, { mode: 'term' }>) {
    const g = this.g, x = 14, y = 38, w = W - 28, h = H - 50, pad = 22, lh = 25;
    this.window(x, y, w, h, 'OVERMIND — A:\\ — TERMINAL', true);
    g.font = MONO(18);
    // wrap every line, keep what fits above the input line
    const rows: { text: string; color: string; glow: boolean }[] = [];
    for (const l of s.lines) {
      const prefix = l.who === 'you' ? 'A:\\> ' : l.who === 'om' ? '> ' : '';
      const body = l.text.slice(0, l.shown);
      const wrapped = this.wrap(prefix + body, MONO(18), w - pad * 2);
      const color = l.who === 'you' ? '#9a9a9a' : l.who === 'om' ? '#f0f0f0' : '#7c7c7c';
      wrapped.forEach((t) => rows.push({ text: t, color, glow: l.who === 'om' }));
      if (l.who !== 'sys') rows.push({ text: '', color, glow: false });
    }
    const room = Math.floor((h - 26 - pad - 60) / lh);
    const visible = rows.slice(-room);
    visible.forEach((r, i) => {
      g.fillStyle = r.color; g.shadowColor = 'rgba(255,255,255,0.45)'; g.shadowBlur = r.glow ? 6 : 0;
      g.fillText(r.text, x + pad, y + 26 + pad + 18 + i * lh);
    });
    // the input line
    g.shadowBlur = 0; g.fillStyle = '#2a2a2a'; g.fillRect(x + 10, y + h - 54, w - 20, 1);
    g.font = MONO(19, 600); g.fillStyle = '#e6e6e6'; g.shadowBlur = 6;
    const prompt = s.busy ? '…' : `A:\\> ${s.input}`;
    const fitted = this.wrap(prompt, MONO(19, 600), w - pad * 2 - 20).slice(-1)[0] ?? '';
    g.fillText(fitted, x + pad, y + h - 22);
    if (!s.busy && Math.floor(s.clock / 500) % 2 === 0) g.fillRect(x + pad + g.measureText(fitted).width + 3, y + h - 38, 11, 20);
    g.shadowBlur = 0;
  }

  private load(s: Extract<ScreenState, { mode: 'load' }>) {
    const g = this.g;
    this.window(60, 80, W - 120, H - 160, 'A:\\', true);
    g.fillStyle = '#e6e6e6'; g.font = MONO(22); g.shadowColor = 'rgba(255,255,255,0.5)'; g.shadowBlur = 8;
    g.fillText('A:\\> DIR', 100, 170);
    g.fillText(`reading ${fmtDisk(s.disk.n)}${'.'.repeat(1 + (Math.floor(s.t * 8) % 3))}`, 100, 210);
    g.fillRect(100, 240, (W - 200) * Math.min(1, s.t), 10);
    g.shadowBlur = 0;
  }

  private dir(s: Extract<ScreenState, { mode: 'dir' }>) {
    const g = this.g, d = s.disk;
    const x = 30, y = 46, w = W - 60, h = H - 70;
    this.window(x, y, w, h, `A:\\ — ${fmtDisk(d.n)}${d.sealed ? ` · sealed ${fmtDate(d.sealedAt)} ${fmtTime(d.sealedAt)}` : ' · writing now'}`, true);
    g.fillStyle = '#e6e6e6'; g.shadowColor = 'rgba(255,255,255,0.45)'; g.shadowBlur = 6;
    g.font = MONO(17);
    g.fillText(` Volume in drive A is ${fmtDisk(d.n).replace(' ', '_')}`, x + 18, y + 58);
    g.fillStyle = '#9a9a9a'; g.font = MONO(15);
    g.fillText(d.sealed ? ` Fingerprint ${d.fingerprint.slice(0, 16)}…${d.fingerprint.slice(-8)}` : ` Writing: slot ${d.written + 1} of ${SLOTS} in under a minute`, x + 18, y + 82);
    if (d.sealed) { // the seal on Solana, as a link once it's there
      g.textAlign = 'right';
      if (d.chain?.url) {
        const label = `SEALED ON SOLANA  TX ${(d.chain.tx ?? '').slice(0, 4)}…${(d.chain.tx ?? '').slice(-4)} ↗`;
        g.fillStyle = '#e6e6e6'; g.fillText(label, x + w - 24, y + 82);
        const lw = g.measureText(label).width;
        this.hits.push({ x: x + w - 24 - lw, y: y + 64, w: lw, h: 26, hit: { kind: 'seal' } });
      } else g.fillText(d.chain?.pending ? 'Solana seal pending' : 'write-protected', x + w - 24, y + 82);
      g.textAlign = 'left';
    }
    const top = y + 112, rowH = 30;
    const from = Math.max(0, Math.min(s.scroll, Math.max(0, s.slots.length - ROWS)));
    s.slots.slice(from, from + ROWS).forEach((slot, i) => {
      const k = from + i, ry = top + i * rowH, sel = k === s.selected;
      if (sel) { g.shadowBlur = 0; g.fillStyle = '#e6e6e6'; g.fillRect(x + 10, ry - 21, w - 40, rowH - 2); }
      g.shadowBlur = sel ? 0 : 6;
      g.fillStyle = sel ? '#060606' : slot.item ? '#e6e6e6' : '#6e6e6e';
      g.font = MONO(18, sel ? 600 : 400);
      g.fillText(` ${String(k + 1).padStart(2, '0')}  ${fmtTime(slot.time)}  ${slot.file.padEnd(31, ' ')}`, x + 14, ry);
      g.textAlign = 'right'; g.fillText(slot.item ? SLOT_BYTES.toLocaleString('en-US') : '------', x + w - 40, ry); g.textAlign = 'left';
      this.hits.push({ x: x + 10, y: ry - 21, w: w - 40, h: rowH - 2, hit: { kind: 'row', index: k } });
    });
    // scrollbar
    g.shadowBlur = 0;
    const sbH = ROWS * rowH, frac = s.slots.length > ROWS ? from / (s.slots.length - ROWS) : 0;
    g.fillStyle = '#2a2a2a'; g.fillRect(x + w - 22, top - 21, 8, sbH);
    g.fillStyle = '#bdbdbd'; g.fillRect(x + w - 22, top - 21 + frac * sbH * (1 - Math.min(1, ROWS / Math.max(1, s.slots.length))), 8, sbH * Math.min(1, ROWS / Math.max(1, s.slots.length)));
    g.fillStyle = '#9a9a9a'; g.font = MONO(15);
    // and, for a sealed disk on the live archive, how many visitors have checked it themselves
    const checks = d.sealed && d.checks !== undefined ? `   ${d.checks ? `checked by ${d.checks.toLocaleString('en-US')} visitor${d.checks === 1 ? '' : 's'}` : 'not checked yet'}` : '';
    g.fillText(`${String(s.slots.length).padStart(3)} file(s)   ${(s.slots.filter((x2) => x2.item).length * SLOT_BYTES).toLocaleString('en-US')} bytes${checks}`, x + 18, y + h - 46);
    g.fillText(d.sealed ? '↑↓ select   ⏎ open   c check   esc eject' : '↑↓ select   ⏎ open   esc eject', x + 18, y + h - 20);
    g.fillStyle = '#e6e6e6'; g.textAlign = 'right'; g.fillText('[ EJECT ]', x + w - 24, y + h - 20); g.textAlign = 'left';
    this.hits.push({ x: x + w - 140, y: y + h - 40, w: 120, h: 30, hit: { kind: 'eject' } });
    if (d.sealed) {
      g.textAlign = 'right'; g.fillText('[ CHECK ]', x + w - 150, y + h - 20); g.textAlign = 'left';
      this.hits.push({ x: x + w - 270, y: y + h - 40, w: 120, h: 30, hit: { kind: 'check' } });
    }
    if (s.check) this.checkPanel(s.check, x + 40, y + 300, w - 80, h - 360);
  }

  /** CHECK, printed line by line over the directory: the record re-hashed here, the seal, the chain. */
  private checkPanel(c: CheckView, x: number, y: number, w: number, h: number) {
    const g = this.g, r = c.result, short = (v: string) => `${v.slice(0, 16)}…${v.slice(-8)}`;
    g.shadowBlur = 0;
    g.fillStyle = '#060606'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#e6e6e6'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    g.shadowColor = 'rgba(255,255,255,0.45)'; g.shadowBlur = 6; g.fillStyle = '#e6e6e6'; g.font = MONO(18);
    const lines: [number, string, string?][] = [[0, 'A:\> CHECK']];
    if (c.error === 'simulator') lines.push([0.4, 'This is the simulator: there is no sealed record to check.']);
    else if (c.error === 'unsealed') lines.push([0.4, 'This disk is still being written. Only sealed disks can be checked.']);
    else if (c.error) lines.push([0.4, 'CHECK could not reach the archive. Try again in a moment.']);
    else {
      lines.push([0.4, r ? `read the record ........ ${r.bytes.toLocaleString('en-US')} bytes, ${r.records} records` : `reading the record ${'.'.repeat(1 + (Math.floor(c.t * 6) % 3))}`]);
      if (r) {
        lines.push([1.0, `sha256, worked out here  ${short(r.hash)}`]);
        lines.push([1.5, `fingerprint at sealing   ${short(r.sealed)}`]);
        lines.push([2.1, r.match ? 'MATCH' : 'MISMATCH', r.match ? 'the disk is exactly what was sealed.' : 'the record has changed since it was sealed.']);
        const chain = r.chain.state === 'match' ? `on Solana: the memo in tx ${(r.chain.tx ?? '').slice(0, 4)}…${(r.chain.tx ?? '').slice(-4)} says the same ↗`
          : r.chain.state === 'mismatch' ? 'on Solana: the memo does NOT match.'
            : r.chain.state === 'pending' ? 'on Solana: on its way. A seal lands a minute or two after the disk fills.'
              : r.chain.state === 'unreachable' ? 'on Solana: no answer from the network right now.' : 'on Solana: this disk was never sealed on chain.';
        lines.push([2.7, chain]);
      }
    }
    let ly = y + 40;
    for (const [at, text, after] of lines) {
      if (c.t < at) break;
      if (text === 'MATCH' || text === 'MISMATCH') {
        g.font = MONO(30, 700); g.fillText(text, x + 24, ly + 8);
        const tw = g.measureText(text).width; g.font = MONO(18); g.fillText(`  ${after ?? ''}`, x + 24 + tw, ly + 8);
        ly += 46;
      } else {
        g.fillText(text, x + 24, ly);
        if (text.endsWith('↗')) this.hits.push({ x: x + 20, y: ly - 22, w: w - 40, h: 30, hit: { kind: 'seal' } });
        ly += 32;
      }
    }
    g.shadowBlur = 0;
  }

  private entry(s: Extract<ScreenState, { mode: 'entry' }>) {
    const g = this.g, slot = s.slot;
    this.window(14, 38, W - 28, H - 50, `${fmtDisk(s.disk.n)} · ${String(slot.index + 1).padStart(2, '0')}/${SLOTS} · ${slot.file}`);
    this.page(16, 64, W - 32, H - 250, slot, s.source, !!slot.item);
    // the Overmind's note, in its own window
    const OX = 16, OY = H - 184, OW = W - 32, OH = 170;
    this.window(OX, OY, OW, OH, `the overmind's note · saved ${fmtDate(slot.time)} ${fmtTime(slot.time)}`, true);
    g.fillStyle = '#e6e6e6'; g.font = MONO(17); g.shadowColor = 'rgba(255,255,255,0.45)'; g.shadowBlur = 6;
    this.wrap(`> ${slot.note}`, MONO(17), OW - 40).slice(0, 3).forEach((l, i) => g.fillText(l, OX + 18, OY + 58 + i * 24));
    g.fillStyle = '#9a9a9a'; g.font = MONO(14);
    g.fillText('⌫ back to A:\\   esc eject', OX + 18, OY + OH - 14);
    g.shadowBlur = 0;
    this.hits.push({ x: OX + 10, y: OY + OH - 34, w: 220, h: 28, hit: { kind: 'back' } });
  }
}
