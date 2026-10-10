/**
 * The $OMD board: a wall-mounted split-flap display in a clear acrylic case, modelled from docs/reference-room/board
 * (02-clear, 03-grid, 04-side, 05-macro-flap, 06-macro-back). Four large modules spell $OMD across the top; three
 * rows of fourteen small modules below show the coin's numbers. Each row's flap drums turn on one shaft, driven by a
 * stepper at its left end through brass gears; looms run down the left side to the control strip along the bottom, and
 * the logic board, power supply and transformer sit behind the modules. The wall bracket holds it off the wall.
 * Millimetres; origin on the wall under the case's centre line (x centred, y = 0 at the case bottom, +z out of the wall).
 */
import * as THREE from 'three';
import type { FloppyTextures, GlassUniforms } from '../engine/floppy/materials';
import { cyl, prism, rr } from './geom';
import { machineMaterials } from './pc';
import {
  Parts, T, acrylicFrame, box, bundle, capacitor, ceramic, dip, header, perforated, qfp, rail, resistor, ribbon, screw, transformer, v3, type Key,
} from './pcParts';
import { FlapAtlas, FlapModule } from './flaps';

export const BOARD = { w: 1200, h: 800, d: 190, off: 62 } as const;
const FRONT = BOARD.off + BOARD.d; // outer front face
const FZ = FRONT - 34; // plane of the flap faces
/** The rows: centre of the first module, pitch, face size, hinge height. Row 0 is the big $OMD row. */
export const ROWS = [
  { n: 4, x0: -214, pitch: 194, w: 176, h: 220, y: 602, pack: 20, gap: 2.4 },
  { n: 14, x0: -335.5, pitch: 65, w: 61, h: 110, y: 418, pack: 15, gap: 1.8 },
  { n: 14, x0: -335.5, pitch: 65, w: 61, h: 110, y: 296, pack: 15, gap: 1.8 },
  { n: 14, x0: -335.5, pitch: 65, w: 61, h: 110, y: 174, pack: 15, gap: 1.8 },
] as const;
const LOOM: Key[] = ['wireA', 'wireB', 'wireC', 'dark'];

/** Spur gear, axis along x, centred at the origin. */
function gear(P: Parts, m: THREE.Matrix4, r: number, t: number, teeth: number, k: Key = 'brass') {
  P.put(k, cyl(r - 1.4, t, 32).rotateZ(Math.PI / 2), m.clone());
  P.put('steel', cyl(r * 0.32, t + 1.2, 16).rotateZ(Math.PI / 2), m.clone());
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    P.put(k, box(t, 2.6, (Math.PI * 2 * r) / teeth / 2).translate(0, r - 1.1, 0).rotateX(a), m.clone());
  }
}

/** Stepper motor, shaft along +x from its face at the origin (size = flange width, len = body length). */
function stepper(P: Parts, m: THREE.Matrix4, size: number, len: number) {
  const s = size;
  P.put('alu', prism(len * 0.22, s, s, 4, 0.8).rotateY(Math.PI / 2).translate(-len * 0.11, 0, 0), m.clone()); // front flange
  P.put('dark', prism(len * 0.5, s - 2, s - 2, 3.5, 0.6).rotateY(Math.PI / 2).translate(-len * 0.47, 0, 0), m.clone()); // laminations
  P.put('alu', prism(len * 0.28, s, s, 4, 0.8).rotateY(Math.PI / 2).translate(-len * 0.86, 0, 0), m.clone()); // rear cap
  P.put('alu', cyl(s * 0.2, 2, 24).rotateZ(Math.PI / 2).translate(1, 0, 0), m.clone()); // boss
  P.put('steel', cyl(2.5, 16, 12).rotateZ(Math.PI / 2).translate(8, 0, 0), m.clone()); // shaft
  for (const [y, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) P.put('tin', cyl(1.8, 1.2, 10).rotateZ(Math.PI / 2).translate(0.6, (y * s * 0.39), (z * s * 0.39)), m.clone());
  P.put('cream', box(len * 0.3, 6, 12).translate(-len * 0.86, s / 2 + 3, 0), m.clone()); // connector
}

export class Board {
  /** In millimetres: put it in a group scaled to world units. */
  readonly group = new THREE.Group();
  readonly rows: FlapModule[][] = [];
  /** The flap faces: readable, so the dither treatment leaves them clean. */
  readonly faces: THREE.Mesh[] = [];
  private atlases: FlapAtlas[] = [];

  constructor(t: FloppyTextures, gu: GlassUniforms) {
    const P = new Parts();
    caseAndBracket(P);
    ROWS.forEach((row, r) => mechanism(P, row, r));
    electronics(P);
    const m = machineMaterials(t, gu, 'clear', new THREE.Texture());
    this.group.add(P.build(m));

    const big = new FlapAtlas(ROWS[0].w, ROWS[0].h, { cell: 256, size: 0.64, condense: 0.84, bold: 0.016 });
    const small = new FlapAtlas(ROWS[1].w, ROWS[1].h, { cell: 128, size: 0.64, condense: 0.8, bold: 0.018 });
    this.atlases = [big, small];
    const face = (a: FlapAtlas) => new THREE.MeshStandardMaterial({ map: a.texture, roughness: 0.66, metalness: 0 });
    const mats = [face(big), face(small)];
    ROWS.forEach((row, r) => {
      const list: FlapModule[] = [];
      for (let i = 0; i < row.n; i++) {
        const mod = new FlapModule(r === 0 ? big : small, mats[r === 0 ? 0 : 1], r === 0 ? 0.13 : 0.075);
        mod.group.position.set(row.x0 + i * row.pitch, row.y, FZ);
        this.group.add(mod.group);
        this.faces.push(...mod.meshes);
        list.push(mod);
      }
      this.rows.push(list);
    });
  }

  /** Text for a row (0 = the big top row), aligned in its modules; the flaps run in a cascade from the left. */
  set(row: number, text: string, align: 'left' | 'centre' | 'right' = 'centre', instant = false) {
    const mods = this.rows[row], n = mods.length, s = text.slice(0, n);
    const start = align === 'left' ? 0 : align === 'right' ? n - s.length : Math.floor((n - s.length) / 2);
    mods.forEach((m, i) => {
      const ch = s[i - start] ?? ' ';
      if (instant) m.jump(ch);
      else m.set(ch, i * 0.035 + Math.random() * 0.04);
    });
  }
  get busy() { return this.rows.some((r) => r.some((m) => m.busy)); }
  update(dt: number) { for (const r of this.rows) for (const m of r) m.update(Math.min(dt, 0.05)); }
  dispose() { for (const a of this.atlases) a.texture.dispose(); }
}

/* ------------------------------------------------------------------ case and wall bracket */
function caseAndBracket(P: Parts) {
  const { w, h, d, off } = BOARD, c = v3(0, h / 2, off + d / 2);
  acrylicFrame(P, c, w, h, d, { size: 16, every: 96, screwR: 3.6 });
  // panels: front and back sheets, the sides, top and bottom (thick clear sheet)
  P.add('case', box(w - 20, h - 20, 6).translate(0, h / 2, FRONT - 3));
  P.add('pane', box(w - 20, h - 20, 5).translate(0, h / 2, off + 2.5));
  for (const s of [-1, 1]) {
    P.add('pane', box(5, h - 20, d - 20).translate(s * (w / 2 - 2.5), h / 2, c.z));
    P.add('pane', box(w - 20, 5, d - 20).translate(0, h / 2 + s * (h / 2 - 2.5), c.z));
  }
  // the thick bezels front and back: polished frames with round corner bosses and big screws (02, 05)
  for (const [z, f] of [[FRONT + 4, 'z'], [off - 4, '-z']] as const) {
    const ring = prism(w + 6, h + 6, 10, 22, 2.4, [rr(-w / 2 + 26, -h / 2 + 26, w / 2 - 26, h / 2 - 26, 9)]);
    P.add('acrylic', ring.translate(0, h / 2, z));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const p = v3(sx * (w / 2 - 14), h / 2 + sy * (h / 2 - 14), z);
      P.add('acrylic', cyl(13, 14, 28).rotateX(Math.PI / 2).translate(p.x, p.y, p.z + (f === 'z' ? 2 : -2)));
      screw(P, v3(p.x, p.y, p.z + (f === 'z' ? 9.2 : -9.2)), f, 5.2);
    }
    for (let i = 1; i < 5; i++) for (const sy of [-1, 1]) screw(P, v3(-w / 2 + (i * w) / 5, h / 2 + sy * (h / 2 - 12), z + (f === 'z' ? 5.2 : -5.2)), f, 3.4);
    for (let i = 1; i < 3; i++) for (const sx of [-1, 1]) screw(P, v3(sx * (w / 2 - 12), (i * h) / 3, z + (f === 'z' ? 5.2 : -5.2)), f, 3.4);
  }
  // inner posts at the left loom channel and the right end (02: clear posts between the side and the modules)
  for (const x of [-472, 552]) rail(P, 'acrylic', v3(x, 26, FZ - 20), v3(x, h - 26, FZ - 20), 8);
  // wall bracket: two steel channels on the wall, arms out to the case back (04)
  for (const x of [-430, 430]) {
    P.add('metal', box(40, h - 80, 4).translate(x, h / 2, 2));
    for (const s of [-1, 1]) P.add('metal', box(4, h - 80, 16).translate(x + s * 18, h / 2, 10));
    for (const y of [110, h - 110]) {
      P.add('metal', box(30, 30, off - 18).translate(x, y, 18 + (off - 18) / 2 - 4));
      P.add('metal', box(52, 52, 4).translate(x, y, off - 6));
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) screw(P, v3(x + sx * 19, y + sy * 19, off - 3.8), 'z', 2.2);
    }
    for (const y of [70, h / 2, h - 70]) screw(P, v3(x, y, 4.2), 'z', 3);
  }
  // cable conduit out of the bottom right, down and into the wall (04)
  const conduit = new THREE.CatmullRomCurve3([v3(520, 8, off + 40), v3(520, -40, off + 40), v3(520, -90, off + 18), v3(520, -110, 22), v3(520, -112, 4)], false, 'catmullrom', 0.3);
  P.add('part', new THREE.TubeGeometry(conduit, 40, 11, 14, false));
  P.add('metal', box(46, 70, 4).translate(520, -112, 2));
  for (const s of [-1, 1]) screw(P, v3(520, -112 + s * 26, 4.2), 'z', 2.4);
}

/* ------------------------------------------------------------------ flap mechanism, one row */
function mechanism(P: Parts, row: (typeof ROWS)[number], r: number) {
  const big = r === 0, x0 = row.x0 - row.pitch / 2, x1 = row.x0 + (row.n - 0.5) * row.pitch;
  const drum = row.h * (big ? 0.11 : 0.13), axleZ = FZ - 4 - drum;
  // flap packs: the spare flaps standing behind the visible pair, edge-on from the side as black ribs (04)
  for (let i = 0; i < row.n; i++) {
    const cx = row.x0 + i * row.pitch;
    for (let k = 0; k < row.pack; k++) {
      const z = FZ - 2.2 - k * row.gap, lean = k / row.pack;
      const half = row.h / 2 - 2 - lean * row.h * 0.06;
      P.add('dark', box(row.w - 1.5, half - 1.5, 0.7).translate(cx, row.y + 1.1 + (half - 1.5) / 2, z));
      P.add('dark', box(row.w - 1.5, half - 1.5, 0.7).translate(cx, row.y - 1.1 - (half - 1.5) / 2, z));
    }
    // drum: a hub on the axle with brass rims at both ends (05)
    P.add('seam', cyl(drum * 0.82, row.w - 6, 24).rotateZ(Math.PI / 2).translate(cx, row.y, axleZ));
    for (const s of [-1, 1]) {
      if (big) gear(P, T(cx + s * (row.w / 2 + 3), row.y, axleZ), drum + 4, 3, 34);
      else P.add('brass', cyl(drum + 1.5, 2.2, 28).rotateZ(Math.PI / 2).translate(cx + s * (row.w / 2 - 2), row.y, axleZ));
      P.add('brass', cyl(big ? 6 : 4, 4, 16).rotateZ(Math.PI / 2).translate(cx + s * (row.w / 2 + 0.6), row.y, axleZ));
    }
  }
  // side plates between modules with brass spacer nuts at their front corners (02: the bright lines between flaps)
  for (let i = 0; i <= row.n; i++) {
    const x = x0 + i * row.pitch, depth = FZ - axleZ + drum + 18;
    P.add('dark', box(1.4, row.h + 6, depth).translate(x, row.y, FZ - 1 - depth / 2));
    for (const s of [-1, 1]) {
      P.add('brass', cyl(big ? 3.6 : 2.6, 6, 6).rotateX(Math.PI / 2).translate(x, row.y + s * (row.h / 2 + 2), FZ - 2));
      P.add('brass', cyl(big ? 3.6 : 2.6, 6, 6).rotateX(Math.PI / 2).translate(x, row.y + s * (row.h / 2 + 2), axleZ - drum - 8));
    }
  }
  // row frame: aluminium rails along the top and bottom edges, the shaft through every drum
  for (const s of [-1, 1]) rail(P, 'metal', v3(x0 - 8, row.y + s * (row.h / 2 + 6), FZ - 3), v3(x1 + 8, row.y + s * (row.h / 2 + 6), FZ - 3), 6);
  for (const s of [-1, 1]) rail(P, 'alu', v3(x0 - 8, row.y + s * (row.h / 2 + 6), axleZ - drum - 10), v3(x1 + 8, row.y + s * (row.h / 2 + 6), axleZ - drum - 10), 6);
  P.add('steel', cyl(big ? 4 : 3, x1 - x0 + 70, 12).rotateZ(Math.PI / 2).translate((x0 + x1) / 2 - 35, row.y, axleZ));
  // drive: the stepper at the left end, its pinion meshing with a gear on the shaft (02, 05); the big row has one each end
  const size = big ? 72 : 56, len = big ? 66 : 52, mz = axleZ - drum - 6;
  const drive = (side: 1 | -1) => {
    const fx = side < 0 ? x0 - 30 : x1 + 30;
    stepper(P, T(fx, row.y - drum * 0.4, mz, 0, side < 0 ? 0 : Math.PI, 0), size, len);
    gear(P, T(fx - side * 12, row.y - drum * 0.4, mz), big ? 10 : 8, 6, big ? 14 : 12);
    gear(P, T(fx - side * 12, row.y, axleZ), big ? 22 : 15, 6, big ? 30 : 22);
    // loom from the connector to the left channel, then down
    const cy = row.y - drum * 0.4 + size / 2 + 6, cx = fx - side * (len * 0.86);
    const xs = side < 0 ? -540 : 575;
    bundle(P, LOOM, [v3(cx, cy, mz), v3(cx, cy + 14, mz - 6), v3((cx + xs) / 2, cy + 18, mz - 14), v3(xs, cy, mz - 20), v3(xs, cy - 40, mz - 22)], { r: 1.05, ties: [0.45] });
  };
  drive(-1);
  if (big) drive(1);
  // a ribbon from each module group to the logic board behind (06)
  const rx = (x0 + x1) / 2;
  ribbon(P, [v3(rx, row.y - row.h / 2 - 2, axleZ - drum - 12), v3(rx + 6, row.y - row.h / 2 - 20, axleZ - drum - 40), v3(rx + 10, row.y - row.h / 2 - 34, BOARD.off + 34)], big ? 44 : 34, v3(0, 0, 1));
}

/* ------------------------------------------------------------------ control strips, logic board, power */
function electronics(P: Parts) {
  const { w, h, off } = BOARD, onFace = (x: number, y: number, z: number, rz = 0) => T(x, y, z, Math.PI / 2, 0, rz);
  // left channel: the looms come down it to the bottom strip, tied to the post every so often
  bundle(P, ['wireA', 'wireB', 'wireC', 'dark', 'wireA', 'wireB', 'wireC', 'dark'], [v3(-540, 560, FZ - 92), v3(-544, 400, FZ - 96), v3(-546, 240, FZ - 98), v3(-540, 112, FZ - 98), v3(-500, 96, FZ - 100)], { r: 1.1, ties: [0.15, 0.4, 0.65, 0.88] });
  // top and bottom control strips facing the front (02: green boards above the $OMD row and under the last row)
  const strips = [{ y: 756, hh: 40, z: FZ - 96 }, { y: 66, hh: 70, z: FZ - 96 }];
  for (const s of strips) {
    P.add('board', box(w - 120, s.hh, 1.6).translate(10, s.y, s.z));
    for (let i = 0; i < 9; i++) dip(P, onFace(-440 + i * 112, s.y - 6, s.z + 0.8), i % 3 ? 22 : 32, 7);
    for (let i = 0; i < 6; i++) header(P, onFace(-400 + i * 180, s.y + s.hh / 2 - 9, s.z + 0.8), 8, 2, 'cream', 6);
    for (let i = 0; i < 14; i++) resistor(P, onFace(-470 + i * 74, s.y + (i % 2 ? 12 : -16), s.z + 0.8), i);
    for (let i = 0; i < 5; i++) capacitor(P, onFace(-330 + i * 220, s.y + 8, s.z + 0.8), 3.2, 9);
    for (let i = 0; i < 4; i++) ceramic(P, onFace(-250 + i * 230, s.y - 18, s.z + 0.8));
  }
  // logic board behind the rows (06: FPGA, ARM chip, memory, connectors)
  const bz = off + 14, bx = -40;
  P.add('board', box(860, 330, 1.6).translate(bx, 300, bz));
  qfp(P, onFace(bx - 160, 300, bz + 0.8), 34, 0.8, 2.6);
  qfp(P, onFace(bx + 20, 300, bz + 0.8), 30, 0.8, 2.6);
  for (let i = 0; i < 6; i++) dip(P, onFace(bx + 170 + (i % 2) * 70, 230 + Math.floor(i / 2) * 60, bz + 0.8), 26, 8);
  for (let i = 0; i < 8; i++) dip(P, onFace(bx - 330 + (i % 4) * 60, i < 4 ? 400 : 200, bz + 0.8), 20, 7);
  for (let i = 0; i < 10; i++) capacitor(P, onFace(bx - 380 + i * 80, 160 + (i % 3) * 8, bz + 0.8), i % 4 ? 3 : 5, i % 4 ? 8 : 14);
  for (let i = 0; i < 4; i++) header(P, onFace(bx - 250 + i * 170, 455, bz + 0.8), 10, 2, 'cream', 7);
  // power: perforated supply bottom left, brass transformer, the inlet bottom right with its cord into the conduit (06, 04)
  perforated(P, v3(-380, 82, off + 52), 170, 100, 74, ['front', 'top', 'left'], { pitch: 7, hole: 2.2, margin: 10 });
  transformer(P, T(-200, 16, off + 52), 70, 74, 60);
  for (let i = 0; i < 3; i++) capacitor(P, T(-110 + i * 26, 16, off + 40), 9, 26);
  P.add('header', box(46, 34, 30).translate(520, 52, off + 40));
  P.add('dark', box(30, 20, 2).translate(520, 52, off + 56));
  bundle(P, ['wireA', 'dark', 'wireB'], [v3(495, 52, off + 40), v3(400, 60, off + 50), v3(-100, 60, off + 60), v3(-290, 70, off + 70)], { r: 1.3, ties: [0.3, 0.7] });
  bundle(P, ['wireA', 'wireB', 'wireC', 'dark', 'wireD'], [v3(-290, 120, off + 60), v3(-200, 150, off + 30), v3(bx - 300, 170, bz + 6)], { r: 1.1, ties: [0.5] });
  void h;
}
