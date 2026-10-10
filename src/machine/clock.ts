/**
 * The Q-Day clock: a wall-mounted red LED countdown in a clear acrylic case, modelled from docs/reference-room/clock
 * (01-hero, 02-clear, 03-macro-digits). Four large seven-segment digits count the days to the Overmind's Q-Day
 * guess, with DAYS printed beside them; a row of six small digits under them counts the hours, minutes and seconds.
 * The digits sit behind a smoked red filter; behind them the driver board (counters, crystal, capacitors), a brass
 * transformer at the left end, and a steel plate holding it to the wall.
 * Millimetres; origin on the wall under the case's centre line (x centred, y = 0 at the case bottom, +z out of the wall).
 */
import * as THREE from 'three';
import type { FloppyTextures, GlassUniforms } from '../engine/floppy/materials';
import { cyl, prism, rr } from './geom';
import { machineMaterials } from './pc';
import { Parts, T, acrylicFrame, box, bundle, capacitor, dip, header, resistor, screw, transformer, v3, type Key } from './pcParts';

export const CLOCK = { w: 720, h: 380, d: 130, off: 34 } as const;
const FRONT = CLOCK.off + CLOCK.d;
const SEG_Z = FRONT - 30; // the digit faces
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
};
const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);

/** The seven bars of a digit (w × h, bar thickness t), as flat bevelled hexagons around the digit's centre. */
function segmentShapes(w: number, h: number, t: number): Record<string, THREE.Shape> {
  const g = t * 0.12, hw = w / 2 - t / 2, hh = h / 2 - t / 2;
  const horiz = (y: number) => {
    const a = -hw + g, b = hw - g;
    return new THREE.Shape([[a, y], [a + t / 2, y + t / 2], [b - t / 2, y + t / 2], [b, y], [b - t / 2, y - t / 2], [a + t / 2, y - t / 2]].map(([x, yy]) => new THREE.Vector2(x, yy)));
  };
  const vert = (x: number, y0: number, y1: number) => {
    const a = y0 + g, b = y1 - g;
    return new THREE.Shape([[x, a], [x + t / 2, a + t / 2], [x + t / 2, b - t / 2], [x, b], [x - t / 2, b - t / 2], [x - t / 2, a + t / 2]].map(([xx, y]) => new THREE.Vector2(xx, y)));
  };
  return { a: horiz(hh), g: horiz(0), d: horiz(-hh), f: vert(-hw, 0, hh), b: vert(hw, 0, hh), e: vert(-hw, -hh, 0), c: vert(hw, -hh, 0) };
}

/** One seven-segment digit: a mesh per bar, lit or dark. */
class Digit {
  readonly group = new THREE.Group();
  private bars: Record<string, THREE.Mesh> = {};
  private shown = '';
  constructor(w: number, h: number, t: number, private lit: THREE.Material, private dark: THREE.Material, slant = 0.06) {
    const shapes = segmentShapes(w, h, t);
    for (const [k, s] of Object.entries(shapes)) {
      const g = new THREE.ShapeGeometry(s);
      g.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, slant, 0, 0, 0)); // a slight forward lean, like the macro (03)
      const m = new THREE.Mesh(g, dark);
      this.bars[k] = m;
      this.group.add(m);
    }
  }
  show(ch: string) {
    if (ch === this.shown) return;
    this.shown = ch;
    const on = SEGMENTS[ch] ?? '';
    for (const [k, m] of Object.entries(this.bars)) m.material = on.includes(k) ? this.lit : this.dark;
  }
  get meshes() { return Object.values(this.bars); }
}

function daysLabel() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8e4da'; g.font = '700 64px Inter, "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('DAYS', 128, 52);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export class QClock {
  readonly group = new THREE.Group();
  /** The lit digits: readable, and red through the grade. */
  readonly faces: THREE.Mesh[] = [];
  private days: Digit[] = [];
  private time: Digit[] = [];
  private colons: THREE.Mesh[] = [];
  /** The lit segments: they glow even while the room is dark (the clock is the first thing to catch the eye). */
  readonly lit: THREE.MeshBasicMaterial;

  constructor(t: FloppyTextures, gu: GlassUniforms) {
    const P = new Parts();
    caseAndMount(P);
    internals(P);
    const m = machineMaterials(t, gu, 'clear', new THREE.Texture());
    this.group.add(P.build(m));

    this.lit = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.07, 0.03) });
    const dark = new THREE.MeshStandardMaterial({ color: srgb(48, 8, 6), roughness: 0.5 });
    // module housings: dark red-black blocks the digits are printed on (02, 03)
    const housing = new THREE.MeshStandardMaterial({ color: srgb(22, 6, 6), roughness: 0.75 });
    const addDigit = (list: Digit[], x: number, y: number, w: number, h: number, th: number) => {
      const hm = new THREE.Mesh(prism(w + 18, h + 22, 14, 3, 1), housing);
      hm.position.set(x, y, SEG_Z - 7.4);
      this.group.add(hm);
      const d = new Digit(w, h, th, this.lit, dark);
      d.group.position.set(x, y, SEG_Z + 0.2);
      this.group.add(d.group);
      this.faces.push(...d.meshes);
      d.show('8');
      list.push(d);
    };
    for (let i = 0; i < 4; i++) addDigit(this.days, -168 + i * 122, 250, 84, 148, 17);
    const xs = [-120, -72, 2, 50, 124, 172];
    xs.forEach((x) => addDigit(this.time, x + 12, 112, 34, 60, 7.5));
    for (const x of [-35, 87]) for (const y of [100, 124]) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(3.6, 16), this.lit);
      c.position.set(x + 12, y, SEG_Z + 0.2);
      this.group.add(c);
      this.colons.push(c);
      this.faces.push(c);
    }
    // the black panel the digit modules stand on
    const panel = new THREE.Mesh(prism(548, 290, 4, 8, 1), new THREE.MeshStandardMaterial({ color: 0x080606, roughness: 0.6 }));
    panel.position.set(40, 192, SEG_Z - 16);
    this.group.add(panel);
    // the red filter in front of the digits, on standoffs, DAYS printed on it (01, 02)
    const filter = new THREE.Mesh(prism(560, 300, 6, 10, 1.6), new THREE.MeshStandardMaterial({
      color: srgb(96, 6, 6), roughness: 0.08, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false,
    }));
    filter.position.set(40, 192, FRONT - 14);
    filter.renderOrder = 2;
    this.group.add(filter);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(64, 24), new THREE.MeshBasicMaterial({ map: daysLabel(), transparent: true, depthWrite: false }));
    label.position.set(286, 196, FRONT - 10.8);
    label.renderOrder = 3;
    this.group.add(label);
  }

  /** Shows a count: days (up to 9999) and the remaining hours, minutes and seconds. */
  show(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const days = String(Math.min(9999, Math.floor(s / 86400))).padStart(4, ' ');
    const hms = [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, '0')).join('');
    this.days.forEach((d, i) => d.show(days[i]));
    this.time.forEach((d, i) => d.show(hms[i]));
  }
  /** Blanks or dashes the display (no guess yet). */
  dashes() { for (const d of [...this.days, ...this.time]) d.show('-'); }
  /** Colons blink on the half second. */
  update(now: number) { const on = now % 1000 < 500; for (const c of this.colons) c.visible = on; }
}

/* ------------------------------------------------------------------ case, wall plate */
function caseAndMount(P: Parts) {
  const { w, h, d, off } = CLOCK, c = v3(0, h / 2, off + d / 2);
  acrylicFrame(P, c, w, h, d, { size: 13, every: 80, screwR: 3.4 });
  P.add('case', box(w - 16, h - 16, 5).translate(0, h / 2, FRONT - 2.5));
  P.add('pane', box(w - 16, h - 16, 4).translate(0, h / 2, off + 2));
  for (const s of [-1, 1]) {
    P.add('pane', box(4, h - 16, d - 16).translate(s * (w / 2 - 2), h / 2, c.z));
    P.add('pane', box(w - 16, 4, d - 16).translate(0, h / 2 + s * (h / 2 - 2), c.z));
  }
  // layered front frame (02: the stacked clear rails along the front edges)
  P.add('acrylic', prism(w + 4, h + 4, 8, 14, 2, [rr(-w / 2 + 22, -h / 2 + 22, w / 2 - 22, h / 2 - 22, 6)]).translate(0, h / 2, FRONT + 4));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) screw(P, v3(sx * (w / 2 - 12), h / 2 + sy * (h / 2 - 12), FRONT + 8.2), 'z', 5);
  for (const sy of [-1, 1]) screw(P, v3(0, h / 2 + sy * (h / 2 - 11), FRONT + 8.2), 'z', 3.4);
  // filter standoffs and screws
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    P.add('tin', cyl(4, 10, 12).rotateX(Math.PI / 2).translate(40 + sx * 266, 192 + sy * 136, FRONT - 21));
    screw(P, v3(40 + sx * 266, 192 + sy * 136, FRONT - 10.6), 'z', 2.6);
  }
  // steel wall plate behind the left end, standoffs into the case (02)
  P.add('metal', prism(150, h - 40, 5, 6, 1).translate(-w / 2 + 40, h / 2, 2.5));
  for (const sy of [-1, 1]) {
    screw(P, v3(-w / 2 + 2, h / 2 + sy * (h / 2 - 60), 5.2), 'z', 6);
    P.add('tin', cyl(6, off - 5, 14).rotateX(Math.PI / 2).translate(-w / 2 + 70, h / 2 + sy * 110, 5 + (off - 5) / 2));
  }
  P.add('metal', prism(110, h - 80, 5, 6, 1).translate(w / 2 - 70, h / 2, 2.5));
  for (const sy of [-1, 1]) P.add('tin', cyl(6, off - 5, 14).rotateX(Math.PI / 2).translate(w / 2 - 70, h / 2 + sy * 100, 5 + (off - 5) / 2));
}

/* ------------------------------------------------------------------ driver board, transformer */
function internals(P: Parts) {
  const { w, off } = CLOCK, bz = off + 22, onFace = (x: number, y: number, z: number, rz = 0) => T(x, y, z, Math.PI / 2, 0, rz);
  const Lm: Key[] = ['wireA', 'wireB', 'wireC', 'dark'];
  // the board behind the digits, wider below them where the counters are (02)
  P.add('board', box(w - 150, 110, 1.6).translate(40, 62, bz));
  P.add('board', box(150, 300, 1.6).translate(-w / 2 + 165, 190, bz));
  for (let i = 0; i < 5; i++) dip(P, onFace(-120 + i * 92, 58, bz + 0.8), 30, 8);
  for (let i = 0; i < 4; i++) dip(P, onFace(-110 + i * 92, 30, bz + 0.8), 22, 7);
  for (let i = 0; i < 12; i++) resistor(P, onFace(-150 + i * 34, 82, bz + 0.8, Math.PI / 2), i);
  // crystal can and its capacitors (02: 16.000 MHz)
  P.add('tin', prism(32, 12, 10, 4, 1.2).translate(-200, 120, bz + 6));
  for (const x of [-180, -220]) P.add('orange', cyl(2.6, 1.4, 12).rotateX(Math.PI / 2).translate(x, 98, bz + 3));
  for (let i = 0; i < 3; i++) capacitor(P, onFace(-240 + i * 22, 64, bz + 0.8), i ? 4 : 6, i ? 10 : 15);
  header(P, onFace(250, 46, bz + 0.8), 6, 1, 'cream', 9);
  bundle(P, ['wireA', 'dark', 'wireB'], [v3(250, 52, bz + 10), v3(280, 40, bz + 30), v3(330, 30, bz + 40)], { r: 1.1, ties: [0.5] });
  // driver headers to each digit row
  for (let i = 0; i < 4; i++) header(P, onFace(-168 + i * 122, 330, bz + 0.8), 8, 1, 'header', 6);
  // the transformer at the left end, standing on the case floor, its loom up to the board (02)
  transformer(P, T(-w / 2 + 70, 8, off + 70, 0, Math.PI / 2, 0), 64, 70, 56);
  bundle(P, Lm, [v3(-w / 2 + 70, 82, off + 70), v3(-w / 2 + 80, 140, off + 60), v3(-w / 2 + 120, 200, bz + 14), v3(-230, 240, bz + 8)], { r: 1.2, ties: [0.3, 0.7] });
  P.add('cream', box(30, 16, 14).translate(-w / 2 + 120, 280, off + 40));
}
