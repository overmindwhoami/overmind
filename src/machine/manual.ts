/**
 * The manual (docs), modelled from docs/reference-room/manual (01-hero, 02-open-spread, 03-open-angle, 04-grid):
 * a spiral-bound 1988 operator's manual lying open on the desk. Cream card covers a little larger than the pages,
 * two page blocks rising slightly toward the black twin-loop coil, five coloured index tabs down the right edge.
 * The open spread is one canvas (`canvas`), so the docs can be printed on it.
 * Millimetres; origin on the desk at the middle of the coil, spine along z, pages along ±x, +y up.
 */
import * as THREE from 'three';
import type { FloppyTextures, GlassUniforms } from '../engine/floppy/materials';
import { machineMaterials } from './pc';
import { Parts, box, type Key } from './pcParts';

export const MANUAL = { pageW: 220, pageD: 290, cover: 1.6, gutter: 12, left: 8, right: 12 } as const;
const PX = 5.4; // canvas pixels per millimetre of page

/** Height of a page surface above the cover at distance `u` from the spine edge (mm): a rise into the coil, a slight droop at the edge. */
const lift = (u: number, th: number) => th + 5.5 * Math.exp(-u / 16) - 1.2 * (u / MANUAL.pageW) ** 2;

/** Mirrors a geometry across x = 0, keeping its faces outward. */
function mirrorX(src: THREE.BufferGeometry) {
  const g = src.index ? src.toNonIndexed() : src;
  g.scale(-1, 1, 1);
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name), n = a.itemSize;
    for (let i = 0; i < a.count; i += 3) for (let k = 0; k < n; k++) {
      const t = a.array[(i + 1) * n + k]; (a.array as Float32Array)[(i + 1) * n + k] = a.array[(i + 2) * n + k]; (a.array as Float32Array)[(i + 2) * n + k] = t;
    }
  }
  g.computeVertexNormals();
  return g;
}

export class Manual {
  readonly group = new THREE.Group();
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  /** The printed pages: readable, kept clean by the dither treatment. */
  readonly pages: THREE.Mesh;

  constructor(t: FloppyTextures, gu: GlassUniforms) {
    const { pageW, pageD, cover, gutter } = MANUAL;
    const P = new Parts();
    // covers: card, slightly larger than the pages
    for (const s of [-1, 1]) P.add('accent', box(pageW + 10, cover, pageD + 10).translate(s * (gutter - 2 + (pageW + 10) / 2), cover / 2, 0));
    // page blocks: the cross-section (rise toward the coil) extruded along the spine; paper edges show on three sides
    for (const s of [-1, 1]) {
      const th = s < 0 ? MANUAL.left : MANUAL.right;
      const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
      for (let i = 0; i <= 30; i++) { const u = (i / 30) * pageW; pts.push(new THREE.Vector2(u, lift(u, th) - 0.4)); }
      pts.push(new THREE.Vector2(pageW, 0));
      let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: pageD, bevelEnabled: false, curveSegments: 1 });
      g.translate(0, 0, -pageD / 2);
      if (s < 0) g = mirrorX(g);
      P.add('label', g.translate(s * gutter, cover, 0));
      // page edges: faint lines along the block's outer edge
      for (let k = 1; k < th / 1.2; k++) P.add('seam', box(0.3, 0.12, pageD - 2).translate(s * (gutter + pageW + 0.2), cover + k * 1.2, 0));
    }
    // the coil: twin loops through punched slots, black plastic (01, 04)
    for (let i = 0; i < 21; i++) {
      const z = -pageD / 2 + 10 + (i * (pageD - 20)) / 20;
      for (const dz of [-1.8, 1.8]) P.add('chip', new THREE.TorusGeometry(9.5, 1.15, 8, 28).translate(0, cover + 7, z + dz));
    }
    // index tabs down the right edge, each at its own depth in the block (01, 02)
    const tabs: Key[] = ['wireA', 'wireB', 'board', 'blue', 'part'];
    tabs.forEach((k, i) => P.add(k, box(16, 1.1, 42).translate(gutter + pageW + 5, cover + MANUAL.right - 2 - i * 2.1, pageD / 2 - 40 - i * 50)));
    this.group.add(P.build(machineMaterials(t, gu, 'clear', new THREE.Texture())));

    // the spread: one curved sheet over both blocks, printed from the canvas
    this.canvas.width = Math.round(pageW * 2 * PX); this.canvas.height = Math.round(pageD * PX);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 16;
    const seg = 48, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const [side, s] of [[0, -1], [1, 1]] as const) {
      const th = s < 0 ? MANUAL.left : MANUAL.right, base = pos.length / 3;
      for (let i = 0; i <= seg; i++) for (const j of [0, 1]) {
        const u = (i / seg) * pageW, x = s * (gutter + u), z = (j - 0.5) * pageD;
        pos.push(x, cover + lift(u, th) + 0.05, z);
        uv.push(side === 0 ? 0.5 - (i / seg) * 0.5 : 0.5 + (i / seg) * 0.5, 1 - j);
      }
      for (let i = 0; i < seg; i++) {
        const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
        if (s > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    this.pages = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.86 }));
    this.group.add(this.pages);
    this.print();
  }

  /** Prints the spread: `content` draws onto each page (0 = left, 1 = right) in page millimetres; default is the layout of 02. */
  print(content: (g: CanvasRenderingContext2D, page: 0 | 1) => void = samplePage) {
    const g = this.canvas.getContext('2d')!, w = MANUAL.pageW * PX, h = MANUAL.pageD * PX;
    for (const page of [0, 1] as const) {
      g.save();
      g.translate(page * w, 0);
      // aged paper: warm, a little darker toward the edges, a faint mottling
      const grd = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
      grd.addColorStop(0, '#ebe3cf'); grd.addColorStop(1, '#ddd2b8');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(120,100,60,${Math.random() * 0.025})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 8 + Math.random() * 60, 0, 7); g.fill(); }
      // punched slots along the inner edge
      g.fillStyle = '#1a1814';
      for (let k = 0; k < 21; k++) { const y = (10 + (k * (MANUAL.pageD - 20)) / 20) * PX; g.fillRect(page === 0 ? w - 9 * PX : 3 * PX, y - 2.6 * PX, 6 * PX, 5.2 * PX); }
      g.scale(PX, PX);
      content(g, page);
      g.restore();
    }
    this.texture.needsUpdate = true;
  }
}

/** The reference layout with no readable words: heading bars, text lines, a diagram, a table, page numbers. */
function samplePage(g: CanvasRenderingContext2D, page: 0 | 1) {
  const m = 14, w = MANUAL.pageW, h = MANUAL.pageD, col = (w - 2 * m - 8) / 2;
  const bar = (x: number, y: number, len: number, tone = '#8d887d', th = 2.2) => { g.fillStyle = tone; g.fillRect(x, y, len, th); };
  bar(m, 14, w - 2 * m, '#9a958a', 5);
  g.fillStyle = '#b6b0a2'; g.fillRect(m + col + 3.6, 26, 0.4, h - 52);
  const text = (x: number, y: number, lines: number) => { for (let i = 0; i < lines; i++) bar(x, y + i * 4.6, col * (i === lines - 1 ? 0.55 : 0.9 + Math.random() * 0.1), '#a7a297', 1.3); return y + lines * 4.6 + 4; };
  for (const c of [0, 1]) {
    const x = m + c * (col + 8);
    let y = 28;
    bar(x, y, col * 0.62, '#8b867b', 3.2); y += 9;
    y = text(x, y, 5);
    if ((page + c) % 2 === 1) { // a diagram box
      g.strokeStyle = '#6f6a60'; g.lineWidth = 0.5; g.strokeRect(x, y, col, 54);
      g.strokeRect(x + col * 0.15, y + 30, col * 0.35, 12); g.strokeRect(x + col * 0.55, y + 16, col * 0.32, 22);
      g.beginPath(); g.moveTo(x + col * 0.42, y + 34); g.lineTo(x + col * 0.6, y + 28); g.stroke();
      y += 62;
    } else { // a table
      g.strokeStyle = '#6f6a60'; g.lineWidth = 0.4;
      for (let r = 0; r <= 5; r++) { g.beginPath(); g.moveTo(x, y + r * 7); g.lineTo(x + col, y + r * 7); g.stroke(); }
      g.beginPath(); g.moveTo(x + col * 0.45, y); g.lineTo(x + col * 0.45, y + 35); g.stroke();
      bar(x, y, col, '#b9b3a5', 7);
      y += 43;
    }
    bar(x, y, col * 0.5, '#8b867b', 3.2); y += 9;
    for (let i = 0; i < 3; i++) { g.fillStyle = '#6f6a60'; g.fillRect(x, y + 0.4, 1.6, 1.6); y = text(x + 5, y, 2) - 2; }
    y = text(x, y + 2, Math.max(2, Math.floor((h - 34 - y) / 4.6)));
  }
  // page number in the outer bottom corner
  g.strokeStyle = '#6f6a60'; g.lineWidth = 0.5;
  g.beginPath(); g.arc(page === 0 ? m + 3 : w - m - 3, h - 12, 3, 0, 7); g.stroke();
  bar(m + 9, h - 12, w - 2 * m - 18, '#b6b0a2', 0.4);
}
