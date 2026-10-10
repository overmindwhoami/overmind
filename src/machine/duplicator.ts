/**
 * The duplicator (launch), modelled from docs/reference-room/duplicator (01-hero, 02-clear, 03-front, 04-side, 05-top):
 * a tall clear acrylic tower that takes blank disks from a sprung hopper on top, picks them with rubber rollers into
 * a 3.5" drive, prints a label on the thermal printer and drops them into the output tray at the bottom front. A green
 * two-line LCD and four keys sit under the drive; the logic board stands along the left side; the power supply,
 * transformer and capacitors fill the base. Millimetres; origin on the floor under the body's centre, +z toward the user.
 */
import * as THREE from 'three';
import type { FloppyTextures, GlassUniforms } from '../engine/floppy/materials';
import { cyl, prism } from './geom';
import { machineMaterials } from './pc';
import {
  Parts, T, acrylicFrame, box, bundle, capacitor, dip, header, perforated, qfp, rail, resistor, ribbon, screw, transformer, v3, type Key,
} from './pcParts';

export const DUP = { w: 300, d: 340, h: 470, tray: 110, hopper: { w: 230, d: 220, h: 150 } } as const;
const HW = DUP.w / 2, FZ = DUP.d / 2; // half width, body front
const LOOM: Key[] = ['wireA', 'wireB', 'wireC', 'dark'];

/** A blank 3.5" disk lying flat (label up, shutter toward −z), as merged geometry; `labelled` adds the white label. */
export function flatBlank(P: Parts, x: number, y: number, z: number, labelled = false, ry = 0) {
  const m = T(x, y, z, 0, ry, 0);
  P.put('chip', box(90, 3.2, 94).translate(0, 1.6, 0), m.clone());
  P.put('tin', box(46, 0.4, 30).translate(4, 3.3, -32), m.clone());
  P.put('seam', box(10, 0.3, 15).translate(14, 3.55, -36), m.clone());
  if (labelled) P.put('label', box(68, 0.3, 50).translate(0, 3.35, 18), m.clone());
}

/** The LCD: two lines of dark characters on a yellow-green backlight. */
export class Lcd {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  constructor() {
    this.canvas.width = 512; this.canvas.height = 160;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 8;
    this.print('COPY   1/20', 'VERIFY OK');
  }
  print(a: string, b: string) {
    const g = this.canvas.getContext('2d')!, W = this.canvas.width, H = this.canvas.height;
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#9fd04a'); grd.addColorStop(1, '#86bb36');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1d3010'; g.font = '600 54px "JetBrains Mono", "Courier New", monospace'; g.textBaseline = 'middle';
    g.fillText(a.slice(0, 16), 24, H * 0.3); g.fillText(b.slice(0, 16), 24, H * 0.74);
    this.texture.needsUpdate = true;
  }
}

export class Duplicator {
  readonly group = new THREE.Group();
  readonly lcd = new Lcd();
  /** Readable surfaces (the LCD). */
  readonly faces: THREE.Mesh[] = [];
  constructor(t: FloppyTextures, gu: GlassUniforms) {
    const P = new Parts();
    frame(P);
    hopper(P);
    picker(P);
    drive(P);
    panel(P);
    printer(P);
    base(P);
    logic(P);
    this.group.add(P.build(machineMaterials(t, gu, 'clear', new THREE.Texture())));
    const lcd = new THREE.Mesh(new THREE.PlaneGeometry(112, 35), new THREE.MeshBasicMaterial({ map: this.lcd.texture, color: new THREE.Color(1.15, 1.15, 1.15) }));
    lcd.position.set(-30, 322, FZ + 8.6);
    this.group.add(lcd);
    this.faces.push(lcd);
  }
}

/* ------------------------------------------------------------------ acrylic frame: body, upper step, tray bay */
function frame(P: Parts) {
  const { w, d, h } = DUP;
  acrylicFrame(P, v3(0, h / 2 + 8, 0), w, h - 16, d, { size: 11, every: 70, screwR: 2.8 });
  // shelves dividing the sections (02: base, printer, drive, picker)
  for (const y of [190, 300, 410]) {
    P.add('pane', box(w - 22, 4, d - 22).translate(0, y, 0));
    for (const z of [-d / 2 + 6, d / 2 - 6]) rail(P, 'acrylic', v3(-HW + 6, y, z), v3(HW - 6, y, z), 8); // shelf edges
    for (const x of [-HW + 6, HW - 6]) rail(P, 'acrylic', v3(x, y, -d / 2 + 6), v3(x, y, d / 2 - 6), 8);
  }
  for (const z of [-d / 2 + 6, d / 2 - 6]) rail(P, 'acrylic', v3(-HW + 64, 12, z), v3(-HW + 64, h - 4, z), 8); // posts beside the logic board
  // output tray bay protruding at the bottom front (01, 02): a clear box with a steel side plate
  const tz = FZ + DUP.tray / 2;
  acrylicFrame(P, v3(26, 92, tz - 6), w - 52, 160, DUP.tray + 12, { size: 10, every: 60, screwR: 2.6, skip: ['back'] });
  P.add('pane', box(w - 70, 6, DUP.tray).translate(26, 16, tz));
  P.add('steel', prism(66, 74, 3, 5, 0.8).rotateY(Math.PI / 2).translate(-HW + 30, 60, tz));
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) screw(P, v3(-HW + 28.2, 60 + sy * 28, tz + sz * 24), '-x', 2.2);
  // feet
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add('rubber', cyl(14, 10, 20).translate(sx * (HW - 24), 5, sz * (d / 2 - 24)));
}

/* ------------------------------------------------------------------ hopper of blanks on top, with springs and lid */
function hopper(P: Parts) {
  const { w, d, h } = DUP.hopper, y0 = DUP.h, cz = -10;
  acrylicFrame(P, v3(0, y0 + h / 2, cz), w, h, d, { size: 9, every: 60, screwR: 2.4, skip: ['bottom'] });
  // the angled front lid (02: a clear hood leaning forward)
  P.add('case', box(w - 20, 6, 90).translate(0, 0, 0).applyMatrix4(T(0, y0 + h - 8, cz + d / 2 - 10, -0.62, 0, 0)));
  // the stack of blanks, the push plate and the two compression springs with brass caps (02, 05)
  for (let i = 0; i < 20; i++) flatBlank(P, 0, y0 + 10 + i * 3.4, cz + 6);
  P.add('alu', box(110, 4, 110).translate(0, y0 + 6, cz + 6));
  for (const s of [-1, 1]) {
    const x = s * 82, curve = new THREE.CatmullRomCurve3(Array.from({ length: 120 }, (_, i) => v3(x + Math.cos(i * 0.6) * 9, y0 + 14 + i * 0.95, cz - 60 + Math.sin(i * 0.6) * 9)));
    P.add('steel', new THREE.TubeGeometry(curve, 360, 1.1, 6, false));
    for (const y of [y0 + 10, y0 + 130]) P.add('brass', cyl(11, 6, 20).translate(x, y, cz - 60));
    rail(P, 'steel', v3(x, y0 + 6, cz - 60), v3(x, y0 + 140, cz - 60), 3.4, 1.6);
    rail(P, 'steel', v3(x * 0.7, y0 + 4, cz + 64), v3(x * 0.7, y0 + 120, cz + 64), 3, 1.4); // guide rods
  }
}

/* ------------------------------------------------------------------ the pick mechanism: rods, rollers, motor, gears */
function picker(P: Parts) {
  const y = 440, z = -20;
  for (const dz of [-40, 30]) rail(P, 'steel', v3(-HW + 70, y, z + dz), v3(HW - 14, y, z + dz), 6, 3);
  for (const dz of [-40, 30]) P.add('rubber', cyl(13, 50, 24).rotateZ(Math.PI / 2).translate(20, y, z + dz));
  P.add('alu', box(70, 30, 26).translate(60, y + 18, z - 5)); // carriage
  P.add('dark', box(40, 20, 34).translate(60, y + 30, z - 5));
  // DC motor and brass gear train at the right (02)
  P.add('alu', cyl(14, 38, 24).rotateZ(Math.PI / 2).translate(HW - 50, y + 4, z + 70));
  P.add('alu', cyl(15, 6, 24).rotateZ(Math.PI / 2).translate(HW - 70, y + 4, z + 70));
  for (const [r, dz] of [[12, 70], [18, 40], [10, 8]] as const) P.add('brass', cyl(r, 5, 28).rotateZ(Math.PI / 2).translate(HW - 82, y + 4 + (dz === 40 ? -6 : 0), z + dz));
  bundle(P, ['wireA', 'dark'], [v3(HW - 30, y + 6, z + 70), v3(HW - 20, y + 30, z + 40), v3(-HW + 80, y + 40, z - 40)], { r: 1, ties: [0.5] });
}

/* ------------------------------------------------------------------ the drive, front-facing in its clear cage */
function drive(P: Parts) {
  const y = 376, w = 150, h = 32, x = 30;
  P.add('cream', prism(w, h, 12, 2, 1).translate(x, y, FZ + 2)); // beige bezel (01, 02)
  P.add('seam', box(96, 5, 2).translate(x - 6, y + 4, FZ + 8.2));
  P.add('dark', box(98, 7, 1).translate(x - 6, y + 4, FZ + 7.7));
  P.add('ledGreen', box(6, 3, 1).translate(x - 54, y - 8, FZ + 8.3));
  P.add('cream', box(14, 7, 3).translate(x + 56, y - 7, FZ + 9));
  P.add('metal', box(w - 6, h - 4, 140).translate(x, y, FZ - 74)); // drive body
  P.add('board', box(w - 16, 1.6, 120).translate(x, y - h / 2 - 2, FZ - 80));
  ribbon(P, [v3(x - 20, y, FZ - 146), v3(x - 40, y + 10, -FZ + 60), v3(-HW + 80, y + 20, -FZ + 40)], 26, v3(0, 1, 0));
}

/* ------------------------------------------------------------------ LCD and keys */
function panel(P: Parts) {
  const y = 322;
  P.add('cream', prism(250, 56, 10, 3, 1.2).translate(0, y, FZ + 3)); // beige keypad plate
  P.add('dark', box(120, 42, 2).translate(-30, y, FZ + 7.4)); // LCD bezel
  for (const [kx, ky] of [[66, 11], [66, -11], [100, 11], [100, -11]] as const) P.add('keyLight', prism(26, 18, 7, 2.5, 1).translate(kx, y + ky, FZ + 10));
  for (let i = 0; i < 4; i++) screw(P, v3(-118 + (i % 2) * 236, y + (i < 2 ? 22 : -22), FZ + 8.4), 'z', 2);
}

/* ------------------------------------------------------------------ the thermal label printer */
function printer(P: Parts) {
  const y = 240;
  // label roll on its spindle (02: the white roll at the left), a stepper and rollers feeding the strip forward
  P.add('label', cyl(36, 50, 40).rotateX(Math.PI / 2).translate(-HW + 112, y + 6, 40));
  P.add('alu', cyl(10, 54, 20).rotateX(Math.PI / 2).translate(-HW + 112, y + 6, 40));
  P.add('alu', box(110, 6, 70).translate(0, y - 28, 60));
  for (const dx of [0, 34]) P.add('rubber', cyl(8, 56, 20).rotateX(Math.PI / 2).translate(-20 + dx, y - 10, 60));
  P.add('alu', prism(42, 42, 34, 4, 0.8).translate(40, y + 8, 30)); // stepper
  P.add('dark', box(36, 36, 16).translate(40, y + 8, 6));
  P.add('label', box(60, 0.6, 70).translate(8, y - 22, 108)); // the strip coming out with a label on it
  P.add('dark', box(60, 10, 14).translate(8, y - 14, 94)); // print head
  bundle(P, LOOM, [v3(40, y + 32, 14), v3(10, y + 50, -20), v3(-HW + 80, y + 40, -60)], { r: 1, ties: [0.5] });
}

/* ------------------------------------------------------------------ base: power, transformer, finished disks in the tray */
function base(P: Parts) {
  perforated(P, v3(-HW + 70, 80, -50), 112, 130, 150, ['front', 'top', 'left'], { pitch: 6.5, hole: 2, margin: 9 });
  transformer(P, T(10, 12, -60), 56, 60, 50);
  for (let i = 0; i < 3; i++) capacitor(P, T(70 + i * 22, 12, -40), 8, 26);
  P.add('header', box(40, 30, 8).translate(80, 50, -FZ + 6)); // inlet on the back
  bundle(P, ['wireA', 'dark', 'wireB', 'wireC'], [v3(-HW + 126, 110, -50), v3(-20, 140, -40), v3(60, 170, -80), v3(HW - 30, 260, -110), v3(HW - 30, 400, -80)], { r: 1.1, ties: [0.25, 0.6, 0.85] });
  // the output tray's stack of finished disks with white labels (01)
  for (let i = 0; i < 12; i++) flatBlank(P, 26, 20 + i * 3.4, FZ + DUP.tray / 2 - 4, i === 11);
}

/* ------------------------------------------------------------------ logic board along the left side */
function logic(P: Parts) {
  const x = -HW + 30, onSide = (y: number, z: number) => T(x - 0.8, y, z, 0, 0, Math.PI / 2);
  P.add('board', box(1.6, 300, 240).translate(x, 360, -20));
  for (let i = 0; i < 6; i++) dip(P, onSide(260 + (i % 3) * 70, -80 + Math.floor(i / 3) * 90), 26, 8);
  qfp(P, onSide(450, -10), 26, 0.8, 2.4);
  for (let i = 0; i < 5; i++) resistor(P, onSide(230 + i * 12, 80), i);
  for (let i = 0; i < 3; i++) capacitor(P, onSide(480, 60 + i * 18), 3, 8);
  header(P, onSide(500, -100), 10, 2, 'cream', 7);
  ribbon(P, [v3(x - 6, 500, -100), v3(x - 12, 440, -70), v3(x - 12, 300, -50), v3(x - 8, 180, -30)], 30, v3(1, 0, 0));
}
