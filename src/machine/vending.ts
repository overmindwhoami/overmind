/**
 * The vending machine (mint, coming soon), modelled from docs/reference-room/vending (01-hero, 02-clear, 03-front,
 * 04-side, 05-macro-panel, 06-macro-coils): a full-size 1988 snack machine built in clear acrylic on a steel frame,
 * selling blank disks. Five shelves of five steel spiral coils, each turned by a geared motor at its back, hold disks
 * standing face out; a COMING SOON card is taped inside the glass. The control column on the right has a red LED
 * display, a beige keypad, a chrome coin slot and a bill acceptor, with the coin mech and board behind; the pickup
 * flap and the power supply sit in the base. Millimetres; origin on the floor under the cabinet's centre, +z out front.
 */
import * as THREE from 'three';
import type { FloppyTextures, GlassUniforms } from '../engine/floppy/materials';
import { cyl, prism } from './geom';
import { machineMaterials } from './pc';
import {
  Parts, T, acrylicFrame, box, bundle, capacitor, dip, header, perforated, rail, ribbon, screw, transformer, v3, type Key,
} from './pcParts';

export const VEND = { w: 900, d: 780, h: 1830, col: 190, feet: 50 } as const;
const FZ = VEND.d / 2, X0 = -VEND.w / 2, XC = VEND.w / 2 - VEND.col; // cabinet front, left side, control column's left edge
const SHELVES = 5, LANES = 5, Y_SHELF0 = 640, SHELF_PITCH = 210;
const LOOM: Key[] = ['wireA', 'wireB', 'wireC', 'dark'];
const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);

/** A blank disk standing face out (label +z, shutter up), merged geometry. */
function standingBlank(P: Parts, x: number, y: number, z: number) {
  P.add('chip', box(90, 94, 3.2).translate(x, y + 47, z));
  P.add('tin', box(46, 30, 0.4).translate(x + 4, y + 79, z + 1.8));
  P.add('seam', box(10, 15, 0.3).translate(x + 14, y + 83, z + 2.05));
}

/** Seven-segment style text on a dark red window, drawn to a canvas (the display reads SOON). */
function displayTexture(text: string) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1a0504'; g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#ff2a12'; g.shadowColor = '#ff2a12'; g.shadowBlur = 10;
  g.font = 'italic 700 70px "JetBrains Mono", "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 52);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function cardTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 360;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e6dfcc'; g.fillRect(0, 0, 512, 360);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(110,90,50,${Math.random() * 0.05})`; g.fillRect(Math.random() * 512, Math.random() * 360, 30, 20); }
  g.fillStyle = '#26221c'; g.font = '700 92px "Comic Sans MS", "Marker Felt", "Chalkboard SE", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('COMING', 256, 130); g.fillText('SOON', 256, 245);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export class Vending {
  readonly group = new THREE.Group();
  /** Readable surfaces: the card and the display. */
  readonly faces: THREE.Mesh[] = [];
  constructor(t: FloppyTextures, gu: GlassUniforms) {
    const P = new Parts();
    cabinet(P);
    shelves(P);
    column(P);
    base(P);
    this.group.add(P.build(machineMaterials(t, gu, 'clear', new THREE.Texture())));
    // the COMING SOON card taped inside the glass, a little crooked (01, 02)
    const card = new THREE.Mesh(new THREE.PlaneGeometry(240, 170), new THREE.MeshStandardMaterial({ map: cardTexture(), roughness: 0.8 }));
    card.position.set(-60, Y_SHELF0 + 3 * SHELF_PITCH + 100, FZ - 14);
    card.rotation.z = 0.12;
    const tape = new THREE.MeshStandardMaterial({ color: srgb(214, 196, 150), roughness: 0.6, transparent: true, opacity: 0.85 });
    for (const [x, y, r] of [[-110, 78, 0.7], [112, 76, -0.6], [-112, -80, -0.7], [110, -78, 0.6]] as const) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(46, 16), tape);
      p.position.set(x, y, 0.3); p.rotation.z = r;
      card.add(p);
    }
    this.group.add(card);
    const display = new THREE.Mesh(new THREE.PlaneGeometry(120, 44), new THREE.MeshBasicMaterial({ map: displayTexture('SOON'), color: new THREE.Color(2.2, 2.2, 2.2) }));
    display.position.set(XC + VEND.col / 2, 1440, FZ + 10.5);
    this.group.add(display);
    this.faces.push(card, display);
  }
}

/* ------------------------------------------------------------------ cabinet: steel frame, clear panels, glass door */
function cabinet(P: Parts) {
  const { w, d, h, feet } = VEND, hh = h - feet, cy = feet + hh / 2;
  acrylicFrame(P, v3(0, cy, 0), w, hh, d, { size: 16, every: 120, screwR: 3.6 });
  // steel corner posts inside the acrylic (02: brushed uprights at the door and the column)
  for (const x of [X0 + 22, XC, VEND.w / 2 - 22]) rail(P, 'alu', v3(x, feet + 10, FZ - 22), v3(x, h - 10, FZ - 22), 22, 3);
  for (const x of [X0 + 22, VEND.w / 2 - 22]) rail(P, 'alu', v3(x, feet + 10, -FZ + 22), v3(x, h - 10, -FZ + 22), 22, 3);
  // sides, back, top: clear sheet
  for (const s of [-1, 1]) P.add('pane', box(6, hh - 30, d - 30).translate(s * (w / 2 - 3), cy, 0));
  P.add('pane', box(w - 30, hh - 30, 6).translate(0, cy, -FZ + 3));
  // the glass door over the display area, framed (01: a thick bezel round the glass)
  const gx = (X0 + XC) / 2, gw = XC - X0 - 30, gy0 = 560, gy1 = h - 70;
  P.add('case', box(gw, gy1 - gy0, 6).translate(gx, (gy0 + gy1) / 2, FZ - 3));
  P.add('acrylic', prism(gw + 30, gy1 - gy0 + 30, 14, 10, 2.4, [[[-gw / 2 + 12, -(gy1 - gy0) / 2 + 12], [gw / 2 - 12, -(gy1 - gy0) / 2 + 12], [gw / 2 - 12, (gy1 - gy0) / 2 - 12], [-gw / 2 + 12, (gy1 - gy0) / 2 - 12]]]).translate(gx, (gy0 + gy1) / 2, FZ + 4));
  P.add('steel', box(10, 120, 14).translate(X0 + 10, 1100, FZ + 6)); // hinge side
  for (const y of [gy0 + 200, gy1 - 200]) P.add('steel', cyl(6, 60, 12).translate(X0 + 12, y, FZ + 2));
  // light tube along the top of the display (01, 02)
  P.add('ledDim', cyl(9, gw - 60, 16).rotateZ(Math.PI / 2).translate(gx, gy1 - 30, FZ - 60));
  P.add('alu', box(gw - 40, 8, 40).translate(gx, gy1 - 18, FZ - 60));
  // feet
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    P.add('rubber', cyl(22, 30, 20).translate(sx * (w / 2 - 50), 15, sz * (d / 2 - 50)));
    P.add('steel', cyl(8, 26, 12).translate(sx * (w / 2 - 50), 40, sz * (d / 2 - 50)));
  }
}

/* ------------------------------------------------------------------ shelves: coils, disks, motors */
function shelves(P: Parts) {
  const lane = (XC - X0 - 60) / LANES, depth = VEND.d - 140, zf = FZ - 40;
  for (let s = 0; s < SHELVES; s++) {
    const y = Y_SHELF0 + s * SHELF_PITCH;
    P.add('pane', box(XC - X0 - 40, 6, depth + 40).translate((X0 + XC) / 2, y, zf - depth / 2 - 10));
    rail(P, 'alu', v3(X0 + 20, y - 8, zf + 4), v3(XC - 10, y - 8, zf + 4), 14, 2); // price rail along the front
    for (let l = 0; l < LANES; l++) {
      const x = X0 + 40 + (l + 0.5) * lane;
      // the spiral: steel wire round the lane, its free end curling out at the front (06)
      const turns = 7, r = 44, pts: THREE.Vector3[] = [];
      for (let i = 0; i <= turns * 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        pts.push(v3(x + Math.sin(a) * r, y + 10 + r * 0.9 + Math.cos(a) * r * 0.9, zf - 6 - (i / (turns * 24)) * (depth - 30)));
      }
      P.add('steel', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 40, 2.2, 6, false));
      // disks standing in the turns
      for (let k = 0; k < 6; k++) standingBlank(P, x, y + 8, zf - 30 - k * ((depth - 50) / 6));
      // lane divider and the geared motor at the back (04, 06)
      P.add('alu', cyl(16, 44, 20).rotateX(Math.PI / 2).translate(x, y + 52, -FZ + 70));
      P.add('cream', cyl(14, 10, 20).rotateX(Math.PI / 2).translate(x, y + 52, -FZ + 98));
      P.add('brass', cyl(10, 6, 16).rotateX(Math.PI / 2).translate(x, y + 52, -FZ + 106));
    }
    bundle(P, LOOM, [v3(X0 + 60, y + 90, -FZ + 50), v3((X0 + XC) / 2, y + 96, -FZ + 46), v3(XC - 10, y + 90, -FZ + 50), v3(XC + 20, y + 40, -FZ + 60)], { r: 1.2, ties: [0.3, 0.6] });
    // shelf label strip A1 … (03) as small dark plates
    for (let l = 0; l < LANES; l++) P.add('dark', box(32, 10, 1).translate(X0 + 40 + (l + 0.5) * lane, y - 8, zf + 11.5));
  }
}

/* ------------------------------------------------------------------ control column */
function column(P: Parts) {
  const cx = XC + VEND.col / 2, z = FZ;
  P.add('case', box(VEND.col - 30, VEND.h - 640, 6).translate(cx, 640 + (VEND.h - 640) / 2 - 40, z - 3));
  // display window
  P.add('dark', prism(150, 70, 10, 4, 1.2).translate(cx, 1440, z + 5));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) screw(P, v3(cx + sx * 66, 1440 + sy * 28, z + 10.2), 'z', 2.2);
  // keypad: twelve beige keys on a beige plate (05)
  P.add('cream', prism(140, 180, 10, 6, 1.6).translate(cx, 1260, z + 5));
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) P.add('keyLight', prism(34, 30, 10, 4, 2).translate(cx - 40 + c * 40, 1316 - r * 38, z + 13));
  // coin slot plate with return button, price card (05)
  P.add('steel', prism(100, 130, 10, 5, 1.4).translate(cx - 18, 1080, z + 5));
  P.add('seam', box(8, 56, 2).translate(cx - 30, 1094, z + 10.5));
  P.add('steel', cyl(12, 12, 20).rotateX(Math.PI / 2).translate(cx - 2, 1046, z + 14));
  P.add('cream', prism(40, 80, 4, 3, 0.8).translate(cx + 56, 1080, z + 3));
  // bill acceptor (05)
  P.add('chip', prism(130, 110, 40, 6, 2).translate(cx, 930, z + 14));
  P.add('steel', box(110, 30, 6).translate(cx, 948, z + 36));
  P.add('seam', box(90, 6, 4).translate(cx, 918, z + 35));
  // behind the panel: the coin mech, the board, looms down the column (02, 03)
  P.add('steel', box(90, 120, 70).translate(cx - 10, 1080, z - 70));
  P.add('board', box(1.6, 300, 180).translate(cx + 40, 720, z - 140));
  for (let i = 0; i < 6; i++) dip(P, T(cx + 39.2, 610 + i * 44, z - 160, 0, 0, Math.PI / 2), 24, 8);
  for (let i = 0; i < 3; i++) capacitor(P, T(cx + 39.2, 820, z - 220 + i * 20, 0, 0, Math.PI / 2), 3.4, 9);
  header(P, T(cx + 39.2, 860, z - 120, 0, 0, Math.PI / 2), 8, 2, 'cream', 6);
  ribbon(P, [v3(cx + 34, 860, z - 120), v3(cx + 10, 900, z - 90), v3(cx, 930, z - 20)], 26, v3(1, 0, 0));
  bundle(P, LOOM, [v3(cx - 40, 1500, z - 60), v3(cx - 50, 1200, z - 80), v3(cx - 46, 900, z - 100), v3(cx - 30, 600, z - 160), v3(cx - 20, 300, z - 200)], { r: 1.3, ties: [0.2, 0.4, 0.6, 0.8] });
}

/* ------------------------------------------------------------------ base: pickup flap, power */
function base(P: Parts) {
  const gx = (X0 + XC) / 2, z = FZ;
  P.add('pane', box(XC - X0 - 40, 6, VEND.d - 60).translate(gx, 540, 0));
  // pickup flap: a dark pushed plate in a clear frame (01, 03: PUSH)
  P.add('acrylic', prism(560, 190, 16, 8, 2.4, [[[-262, -77], [262, -77], [262, 77], [-262, 77]]]).translate(gx, 410, z + 6));
  P.add('rubber', prism(520, 150, 8, 4, 1.4).translate(gx, 410, z - 2));
  P.add('alu', box(500, 6, 8).translate(gx, 485, z + 2));
  // power supply, transformer and capacitors behind the base panel (03, 04)
  perforated(P, v3(X0 + 180, 180, -60), 260, 140, 180, ['front', 'top'], { pitch: 9, hole: 2.6, margin: 12 });
  transformer(P, T(X0 + 420, 70, -40), 120, 120, 100);
  for (let i = 0; i < 2; i++) capacitor(P, T(X0 + 520 + i * 30, 70, 10), 10, 34);
  bundle(P, LOOM, [v3(X0 + 300, 200, -40), v3(X0 + 420, 260, 0), v3(XC - 20, 300, 40), v3(XC + 40, 320, 60)], { r: 1.4, ties: [0.3, 0.7] });
  P.add('pane', box(XC - X0 - 40, 360, 6).translate(gx, 300, z - 30));
}
