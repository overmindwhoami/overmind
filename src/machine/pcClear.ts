/**
 * Inside the clear Overmind PC, modelled from docs/reference-machine/generated 08–17 (clear views and macros):
 * an acrylic construction frame, a full-depth power supply with brass transformers and wire looms, the logic board
 * (memory, slots, QFP and DIP chips, capacitors, connectors) behind a heatsink, a divider wall carrying the fan,
 * the floppy drive in a steel cage with its striped ribbon, and in the monitor the picture tube with its steel band,
 * anode cap, yoke and gun, boards and high-voltage cage. Millimetres, same frame as pc.ts.
 */
import * as THREE from 'three';
import { at, cyl, prism, rr, slab } from './geom';
import { BACK, BAY, FOOT, FRONT, HW, MONITOR, SLOT, TOP, UNIT, VENT, DISK_Z } from './pcSpec';
import {
  T, acrylicFrame, box, bundle, capacitor, ceramic, dip, header, loftRings, perforated, qfp, rail, resistor, ribbon, roundRect,
  screw, transformer, v3, wire, type Key, type Parts,
} from './pcParts';

const RED_BLACK: Key[] = ['wireA', 'dark'];
const LOOM: Key[] = ['wireA', 'dark', 'wireB', 'wireC', 'wireD', 'dark', 'wireA', 'wireB'];

/* ------------------------------------------------------------------ system unit */
export function clearUnit(P: Parts) {
  const floor = FOOT + 3.5, bY = 12.6; // inside floor, logic-board top
  // acrylic construction frame and the panel border on the front
  acrylicFrame(P, v3(0, FOOT + UNIT.h / 2, 0), UNIT.w, UNIT.h, UNIT.d, { size: 9, every: 62, skip: ['bottom'] });
  for (const x of [VENT.x0 - 6, VENT.x1 + 6]) rail(P, 'acrylic', v3(x, floor + 4, FRONT - 4), v3(x, TOP - 9, FRONT - 4), 5); // posts either side of the grille
  // divider wall between the board and the drive bay, with its edge rails
  const DX = BAY.x0 - 3;
  P.add('pane', box(3, TOP - floor - 9, UNIT.d - 22).translate(DX, (floor + TOP - 9) / 2, 0));
  for (const z of [BACK + 12, FRONT - 12]) rail(P, 'acrylic', v3(DX, floor, z), v3(DX, TOP - 9, z), 6);
  rail(P, 'acrylic', v3(DX, TOP - 12, BACK + 12), v3(DX, TOP - 12, FRONT - 12), 6);

  powerSupply(P, floor);
  logicBoard(P, bY);
  heatsink(P, bY);
  fan(P, DX);
  floppyDrive(P, floor);
  backBays(P, floor);
}

function powerSupply(P: Parts, floor: number) {
  // full-depth perforated box behind the power button (09 top, 17 macro), socket and grille on the back (10)
  const c = v3(-HW + 47, floor + 37, -6), w = 74, h = 72, d = UNIT.d - 26;
  perforated(P, c, w, h, d, ['top', 'front', 'right', 'back', 'left'], { pitch: 6.8, hole: 1.9, margin: 10, gap: 26 });
  P.add('chip', box(18, 8, 6).translate(c.x + 18, c.y + 22, c.z + d / 2 + 1)); // switch body behind the button
  // IEC inlet on the back face
  P.add('header', box(30, 24, 6).translate(c.x - 14, c.y - 18, c.z - d / 2 - 2));
  P.add('dark', box(22, 15, 1).translate(c.x - 14, c.y - 18, c.z - d / 2 - 5.1));
  for (const [x, y] of [[-6, 3], [6, 3], [0, -4]] as const) P.add('tin', box(2, 5, 1).translate(c.x - 14 + x, c.y - 18 + y, c.z - d / 2 - 5.4));
  // grommets where the looms leave the box
  for (const z of [118, -60, 54]) P.add('header', new THREE.TorusGeometry(5.2, 1.6, 8, 20).rotateY(Math.PI / 2).translate(c.x + w / 2 + 0.6, c.y + 18, z));
  // brass transformers beside it (09, 17)
  transformer(P, T(-HW + 99, floor, 112), 26, 30, 32);
  transformer(P, T(-HW + 99, floor, 30), 24, 26, 28);
  bundle(P, ['dark', 'wireB', 'wireA'], [v3(-HW + 99, floor + 28, 98), v3(-HW + 92, floor + 40, 84), v3(-HW + 86, floor + 30, 70)], { r: 0.9 });
  // looms: front one to the board's front connector, rear one to the main power connector, one over the divider to the drive
  const x0 = c.x + w / 2 + 1;
  bundle(P, LOOM.slice(0, 6), [v3(x0, c.y + 18, 118), v3(x0 + 14, c.y + 30, 112), v3(-118, c.y + 26, 100), v3(-104, floor + 30, 92), v3(-100, bY0() + 9, 88)], { ties: [0.28, 0.62] });
  bundle(P, LOOM, [v3(x0, c.y + 18, -60), v3(x0 + 16, c.y + 32, -70), v3(-112, c.y + 30, -98), v3(-96, floor + 34, -118), v3(-92, bY0() + 10, -126)], { ties: [0.25, 0.55, 0.8] });
  bundle(P, ['wireA', 'dark', 'dark', 'wireB'], [v3(x0, c.y + 18, 54), v3(-100, TOP - 18, 46), v3(-20, TOP - 15, 40), v3(BAY.x0 - 3, TOP - 13, 30), v3(SLOT.x + 34, TOP - 20, 20), v3(SLOT.x + 34, SLOT.y + 6, 13)], { ties: [0.2, 0.5, 0.8], r: 1 });
  header(P, T(SLOT.x + 34, SLOT.y + 2, 12, -Math.PI / 2), 4, 1, 'cream', 6); // drive power plug
}
const bY0 = () => 12.6;

/** Logic board laid out after 09-clear-unit-top and 16-macro-board (board spans x −110…48, z −152…150). */
function logicBoard(P: Parts, bY: number) {
  const X = (u: number) => -110 + u * 158, Z = (v: number) => -152 + v * 302;
  P.add('board', box(158, 1.6, 302).translate(-31, bY - 0.8, -1));
  for (const [x, z] of [[-104, -146], [42, -146], [-104, 144], [42, 144], [-31, 0]] as const) {
    P.add('tin', cyl(2.6, bY - FOOT - 3.5, 12).translate(x, (bY + FOOT + 3.5) / 2 - 0.8, z)); // standoffs
    screw(P, v3(x, bY, z), 'y', 1.8);
  }
  // copper traces: thin lines fanning out between parts
  for (let i = 0; i < 46; i++) {
    const x = -104 + ((i * 37) % 146), z = -140 + ((i * 53) % 280), len = 8 + ((i * 17) % 30);
    P.add('gold', box(i % 2 ? len : 0.45, 0.05, i % 2 ? 0.45 : len).translate(x, bY + 0.03, z));
  }
  // memory: four SIMMs standing in cream sockets, leaning back (09, 16)
  for (let k = 0; k < 4; k++) {
    const z = Z(0.03) + k * 11;
    P.add('cream', box(84, 6, 6).translate(X(0.73), bY + 3, z));
    for (const s of [-1, 1]) P.add('cream', box(3, 10, 6.5).translate(X(0.73) + s * 43, bY + 5, z));
    const stick = T(X(0.73), bY + 5, z, -0.36);
    P.put('board', box(78, 24, 1.2).translate(0, 12, 0), stick.clone());
    P.put('gold', box(72, 3, 1.3).translate(0, 1.6, 0), stick.clone());
    for (let i = 0; i < 8; i++) P.put('chip', box(7.2, 10, 1.4).translate(-31.5 + i * 9, 13, 1.2), stick.clone());
  }
  // expansion slots (cream) with two cards standing in the rear ones
  for (let k = 0; k < 4; k++) {
    const z = Z(0.25) + k * 12;
    P.add('cream', box(64, 7, 8).translate(X(0.62), bY + 3.5, z));
    P.add('dark', box(58, 0.4, 2.2).translate(X(0.62), bY + 7.1, z));
  }
  for (let k = 0; k < 2; k++) {
    const z = Z(0.25) + k * 12, card = T(X(0.62), bY + 6, z);
    P.put('board', box(70, 40, 1.6).translate(0, 20, 0), card.clone());
    P.put('gold', box(60, 4, 1.7).translate(0, 2.5, 0), card.clone());
    dip(P, card.clone().multiply(T(-14, 24, 0.8, Math.PI / 2)), 26, 7);
    dip(P, card.clone().multiply(T(18, 28, 0.8, Math.PI / 2)), 18, 7);
    qfp(P, card.clone().multiply(T(16, 13, 0.8, Math.PI / 2)), 12, 0.8, 1.8);
    for (let i = 0; i < 4; i++) resistor(P, card.clone().multiply(T(-30 + i * 6, 10, 0.8, Math.PI / 2, 0, Math.PI / 2)), i + k);
  }
  // processor and support chips
  qfp(P, T(X(0.7), bY, Z(0.6)), 28);
  qfp(P, T(X(0.77), bY, Z(0.43)), 20, 1.27, 3.2);
  qfp(P, T(X(0.9), bY, Z(0.64)), 14);
  P.add('tin', cyl(3, 2, 16).scale(1.6, 1, 0.8).translate(X(0.88), bY + 1, Z(0.5))); // crystal
  for (const [u, v, len, rot] of [
    [0.5, 0.62, 30, 0], [0.42, 0.5, 20, 0], [0.33, 0.73, 26, 0], [0.36, 0.82, 32, 0], [0.16, 0.93, 26, 0], [0.47, 0.92, 28, 0],
    [0.7, 0.74, 18, 0], [0.86, 0.73, 22, 0], [0.42, 0.36, 20, Math.PI / 2], [0.26, 0.42, 16, Math.PI / 2], [0.9, 0.86, 18, Math.PI / 2],
  ] as const) dip(P, T(X(u), bY, Z(v), 0, rot), len, len > 24 ? 13 : 8);
  // capacitors: electrolytic clusters and orange ceramics (16)
  for (const [u, v, r, h] of [[0.3, 0.33, 5, 13], [0.36, 0.35, 4, 11], [0.31, 0.41, 5, 13], [0.39, 0.43, 3.5, 9], [0.22, 0.6, 7, 18], [0.32, 0.61, 6, 16], [0.97, 0.3, 3, 8], [0.9, 0.12, 4, 10], [0.12, 0.7, 4, 10], [0.62, 0.86, 3.5, 9]] as const)
    capacitor(P, T(X(u), bY, Z(v)), r, h);
  for (const [u, v] of [[0.55, 0.48, 0], [0.62, 0.52, 0], [0.82, 0.55, 0], [0.45, 0.68, 0], [0.25, 0.86, 0], [0.58, 0.78, 0], [0.95, 0.58, 0], [0.4, 0.22, 0]]) ceramic(P, T(X(u), bY, Z(v), 0, u * 3));
  for (let i = 0; i < 14; i++) resistor(P, T(X(0.12 + ((i * 0.37) % 0.8)), bY, Z(0.18 + ((i * 0.23) % 0.62)), 0, i % 2 ? Math.PI / 2 : 0), i);
  // connectors: cream header with gold pins near the front (16, 17), main power, black pin header, trimmer, battery
  header(P, T(X(0.14), bY, Z(0.8)), 12, 1, 'cream', 8);
  header(P, T(X(0.12), bY, Z(0.09)), 10, 2, 'cream', 9);
  header(P, T(X(0.2), bY, Z(0.95)), 20, 1, 'header', 6);
  header(P, T(X(0.6), bY, Z(0.96)), 12, 2, 'header', 6);
  P.add('brass', box(5, 4, 5).translate(X(0.29), bY + 2, Z(0.52)));
  P.add('tin', cyl(10, 2.6, 24).translate(X(0.28), bY + 1.3, Z(0.2)));
  // I/O connectors at the back edge, through a steel plate (10)
  P.add('metal', box(118, 52, 1.2).translate(-44, bY + 26, BACK + 3));
  for (const [x, len] of [[-86, 53], [-44, 31], [-8, 39]] as const) {
    P.add('tin', prism(len, 12, 9, 2, 0.4).translate(x, bY + 14, BACK + 6));
    P.add('dark', box(len - 8, 7, 1).translate(x, bY + 14, BACK + 1.9));
    for (const s of [-1, 1]) screw(P, v3(x + s * (len / 2 + 5), bY + 14, BACK + 2.2), '-z', 1.6);
  }
}

/** Aluminium heatsink behind the front grille, fins running front to back (09). */
function heatsink(P: Parts, bY: number) {
  const pitch = (VENT.x1 - VENT.x0) / VENT.slots, z0 = FRONT - 62, z1 = FRONT - 6;
  P.add('alu', box(VENT.x1 - VENT.x0 + 4, 5, z1 - z0).translate((VENT.x0 + VENT.x1) / 2, bY + 6, (z0 + z1) / 2));
  for (let k = 0; k <= VENT.slots; k++) P.add('alu', box(1.6, 62, z1 - z0).translate(VENT.x0 + k * pitch, bY + 39, (z0 + z1) / 2));
  P.add('chip', box(40, 4, 40).translate((VENT.x0 + VENT.x1) / 2, bY + 2, (z0 + z1) / 2)); // the chip it cools
}

/** Fan mounted on the divider, blowing across the board (09, 10). */
function fan(P: Parts, dx: number) {
  const s = 76, c = v3(dx + 12, 52, -40), turn = T(c.x, c.y, c.z, 0, Math.PI / 2);
  P.put('header', prism(s, s, 18, 6, 1, [rr(-34, -34, 34, 34, 34).reverse()]), turn.clone());
  P.put('header', cyl(15, 16, 28).rotateX(Math.PI / 2), turn.clone());
  P.put('label', cyl(11, 0.3, 28).rotateX(Math.PI / 2).translate(0, 0, 8.2), turn.clone());
  for (let k = 0; k < 7; k++) P.put('header', box(18, 10, 1).translate(25, 0, 0).rotateX(0.5).rotateZ((k / 7) * Math.PI * 2), turn.clone());
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) screw(P, v3(c.x - 9.4, c.y + a * 31, c.z + b * 31), '-x', 1.6);
  bundle(P, RED_BLACK, [v3(c.x - 8, c.y - 30, c.z + 30), v3(c.x - 14, 22, -12), v3(30, 16, -4)], { r: 0.8 });
}

/** The floppy drive in its steel cage: chassis, top plate with cut-outs, spindle, brass head carriage, board, ribbon (09, 15). */
function floppyDrive(P: Parts, floor: number) {
  const x = SLOT.x, z0 = 14, z1 = FRONT - 2, zc = (z0 + z1) / 2, len = z1 - z0, yb = SLOT.y - 11, yt = SLOT.y + 12.5;
  const hubZ = DISK_Z + 1.5, headZ = DISK_Z - 29.9;
  P.add('alu', box(102, 1, len).translate(x, yb, zc));
  for (const s of [-1, 1]) {
    P.add('alu', box(1, yt - yb, len).translate(x + s * 51, (yb + yt) / 2, zc));
    for (const z of [40, 90, 140]) P.add('seam', cyl(2.2, 0.4, 12).rotateZ(Math.PI / 2).translate(x + s * 51.6, SLOT.y - 3, z));
  }
  // top plate with a round cut-out over the hub and a window over the head
  const holes = [rr(-16, -(hubZ - zc) - 16, 16, -(hubZ - zc) + 16, 16).reverse(), rr(4, -(headZ - zc) - 16, 24, -(headZ - zc) + 16, 1.5).reverse()];
  P.add('alu', slab(102, len, 0.8, 1, 0.2, holes).translate(x, yt, zc));
  // spindle and disk clamp seen through the cut-out
  P.add('header', cyl(14, 3, 32).translate(x, yt - 4, hubZ));
  P.add('tin', cyl(4, 4, 16).translate(x, yt - 3, hubZ));
  // head carriage: brass arm on steel rods, stepper at the back (15)
  for (const s of [8, 28]) P.add('tin', cyl(1.2, 74, 12).rotateX(Math.PI / 2).translate(x + s, yt - 4, headZ - 10));
  P.add('brass', box(16, 3, 30).translate(x + 14, yt - 3.2, headZ + 2));
  P.add('brass', box(4, 5, 6).translate(x + 14, yt - 5, headZ + 16));
  P.add('tin', cyl(8, 12, 24).rotateX(Math.PI / 2).translate(x + 18, yt - 7, z0 + 9));
  // levers and gears at the front right of the mechanism
  for (const [dx, dz, r] of [[40, -8, 4], [44, 6, 3], [34, 10, 2.5]] as const) {
    P.add('brass', cyl(r, 3, 16).translate(x + dx, yt - 2, z1 - 24 + dz));
    P.add('tin', cyl(1, 6, 8).translate(x + dx, yt - 2, z1 - 24 + dz));
  }
  P.add('alu', box(22, 1, 10).translate(x + 38, yt + 0.6, z1 - 20));
  // drive board on top, to the right of the ribbon
  const bx = x + 38, bz = 62;
  P.add('board', box(24, 1.4, 74).translate(bx, yt + 1.4, bz));
  qfp(P, T(bx, yt + 2.1, bz - 6), 12, 0.65, 1.6);
  P.add('label', box(10, 0.4, 7).translate(bx, yt + 2.3, bz + 22));
  P.add('gold', box(14, 0.3, 10).translate(bx - 4, yt + 2.2, bz - 30));
  for (let i = 0; i < 6; i++) resistor(P, T(bx - 8 + (i % 3) * 7, yt + 2.1, bz + 10 + Math.floor(i / 3) * 6), i);
  // 34-way header near the front, the ribbon running back over the top and down to the adapter board at the rear
  header(P, T(x - 12, yt + 1, z1 - 14), 17, 2, 'header', 7);
  ribbon(P, [v3(x - 12, yt + 8.5, z1 - 12), v3(x - 12, yt + 9.5, z1 - 22), v3(x - 12, yt + 2.6, z1 - 40), v3(x - 12, yt + 2.6, z0), v3(x - 12, yt + 4, -60), v3(x - 12, yt + 8, -84), v3(x - 12, yt - 2, -92)], 43);
  // steel cage round the drive, standing on the floor
  for (const s of [-1, 1]) {
    P.add('alu', box(1.2, yt - floor + 4, len - 8).translate(x + s * 55, (floor + yt + 4) / 2, zc));
    for (const z of [30, 85, 140]) for (const y of [SLOT.y - 3, floor + 12]) screw(P, v3(x + s * 55.7, y, z), s > 0 ? 'x' : '-x', 2);
    P.add('alu', box(8, 1.2, len - 8).translate(x + s * 51, floor + 0.6, zc));
  }
  // second bay underneath: a hard disk in a tray
  P.add('alu', prism(100, yb - floor - 6, 120, 2.5, 0.8).translate(x, (floor + yb) / 2 - 1, zc + 6));
  P.add('board', box(96, 1.2, 100).translate(x, floor + 1.6, zc));
  P.add('tin', cyl(40, 0.6, 48).translate(x - 4, yb - 3.6, zc + 4));
}

/** Rear of the drive bay: the ribbon's adapter board, stacked bay trays, back-panel connectors (09, 10). */
function backBays(P: Parts, floor: number) {
  const x = SLOT.x, zb = BACK + 8;
  // adapter board standing at the rear with the blue ribbon socket
  P.add('board', box(62, 40, 1.6).translate(x, SLOT.y + 18, -96));
  P.add('blue', box(46, 8, 7).translate(x - 12, SLOT.y + 6, -96));
  for (let i = 0; i < 5; i++) dip(P, T(x + 10 + (i % 2) * 14, SLOT.y + 10 + Math.floor(i / 2) * 9, -95, -Math.PI / 2), 12, 6);
  // two empty trays stacked behind it, screwed to rails
  for (const y of [floor + 12, floor + 40]) {
    P.add('alu', box(122, 1, 66).translate(x + 14, y, zb + 34));
    for (const s of [-1, 1]) { P.add('alu', box(1, 22, 66).translate(x + 14 + s * 61, y + 11, zb + 34)); screw(P, v3(x + 14 + s * 61.7, y + 11, zb + 14), s > 0 ? 'x' : '-x', 1.8); }
  }
  // back panel: steel plate with D-sub connectors
  P.add('alu', box(130, 36, 1.2).translate(x + 14, TOP - 30, BACK + 3));
  for (const [dx, len] of [[-26, 53], [36, 31]] as const) {
    P.add('tin', prism(len, 12, 9, 2, 0.4).translate(x + dx, TOP - 30, BACK + 6));
    P.add('dark', box(len - 8, 7, 1).translate(x + dx, TOP - 30, BACK + 1.9));
  }
  for (const [y, z] of [[TOP - 14, BACK + 14], [floor + 16, BACK + 14]]) screw(P, v3(HW - 1, y, z), 'x', 2.2);
}

/* ------------------------------------------------------------------ monitor */
export interface MonitorFrame { front: number; y0: number; sy: number; halfW: (z: number) => number; topAt: (z: number) => number }

export function clearMonitor(P: Parts, f: MonitorFrame) {
  const { front, y0, sy } = f;
  const Z = (d: number) => front - d; // depth behind the bezel front → world z
  monitorFrame(P, f);
  // picture tube: grey glass funnel from the face to the neck (12, 13)
  const fr = (d: number, w: number, h: number, r: number) => ({ pts: roundRect(w, h, Math.min(r, w / 2 - 0.02, h / 2 - 0.02), 0, sy), z: Z(d) });
  P.add('tube', loftRings([fr(14, 266, 194, 22), fr(40, 252, 184, 40), fr(80, 206, 152, 60), fr(125, 122, 102, 46), fr(158, 52, 52, 26), fr(166, 31, 31, 15.5)]));
  // steel implosion band round the face, with mounting ears screwed to the frame posts
  P.add('tin', loftRings([fr(15, 271, 199, 23), fr(30, 266, 195, 26)]));
  for (const sx of [-1, 1]) for (const syy of [-1, 1]) {
    const p = v3(sx * 140, sy + syy * 104, Z(22));
    P.add('tin', box(20, 20, 1.6).rotateZ(Math.PI / 4).translate(p.x, p.y, p.z));
    screw(P, v3(p.x + sx * 4, p.y + syy * 4, p.z + 1), 'z', 2.2);
  }
  // degaussing coil, taped, just behind the band
  P.add('coil', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(roundRect(278, 204, 30, 0, sy).map(([x, yy]) => v3(x, yy, Z(36))), true), 160, 3.2, 8, true));
  for (const [x, yy] of [[0, sy + 102], [-139, sy], [139, sy - 40]] as const) P.add('header', box(x === 0 ? 12 : 9, x === 0 ? 9 : 12, 9).translate(x, yy, Z(36)));
  // anode cap: black rubber dome on the upper funnel, red lead to the high-voltage cage
  const cap = v3(-28, sy + 66, Z(98));
  P.add('header', new THREE.SphereGeometry(14, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.42, 1).applyMatrix4(T(cap.x, cap.y, cap.z, 0.5)));
  wire(P, 'wireA', [cap.clone().add(v3(0, 6, -2)), v3(-40, y0 + 216, Z(130)), v3(-62, y0 + 196, Z(190)), v3(-78, y0 + 120, Z(232)), v3(-74, y0 + 72, Z(246))], 2);
  // deflection yoke: copper windings in a cream holder, clips, steel clamp (14)
  P.add('copper', at(new THREE.CylinderGeometry(44, 30, 44, 48, 1, true).rotateX(Math.PI / 2), 0, sy, Z(180)));
  for (let k = 0; k < 7; k++) P.add('copper', at(new THREE.TorusGeometry(30.5 + k * 2.2, 1.3, 8, 48), 0, sy, Z(199 - k * 6.4)));
  for (const d of [156, 203]) P.add('cream', at(new THREE.TorusGeometry(d === 156 ? 46 : 31, 3.6, 10, 48), 0, sy, Z(d)));
  for (let k = 0; k < 4; k++) P.add('cream', box(8, 9, 16).translate(0, 38, 0).rotateZ((k * Math.PI) / 2 + Math.PI / 4).translate(0, sy, Z(176)));
  for (const x of [-16, 0, 16]) { P.add('cream', box(10, 7, 10).translate(x, sy + 42, Z(196))); P.add('tin', cyl(1.4, 2, 10).translate(x, sy + 46, Z(196))); }
  P.add('tin', at(new THREE.TorusGeometry(17, 2.2, 8, 32), 0, sy, Z(206)));
  P.add('tin', cyl(1, 70, 10).rotateX(Math.PI / 2).translate(22, sy - 24, Z(214))); // the thin rod in 14
  // neck: clear glass, electron gun, black ring, socket with pins, socket board
  P.add('neck', at(cyl(15, 92, 32).rotateX(Math.PI / 2), 0, sy, Z(212)));
  for (const d of [182, 194, 206, 218, 230]) P.add('tin', at(cyl(d === 230 ? 9 : 7.5, d === 194 ? 9 : 6, 20).rotateX(Math.PI / 2), 0, sy, Z(d)));
  P.add('header', at(new THREE.TorusGeometry(15.5, 2.6, 8, 32), 0, sy, Z(240)));
  P.add('header', at(cyl(13, 10, 28).rotateX(Math.PI / 2), 0, sy, Z(257)));
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; P.add('tin', cyl(0.5, 8, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * 9, sy + Math.sin(a) * 9, Z(250))); }
  const sb = T(0, sy, Z(264));
  P.put('board', box(56, 52, 1.6), sb.clone());
  for (let i = 0; i < 6; i++) resistor(P, sb.clone().multiply(T(-18 + (i % 3) * 18, -16 + Math.floor(i / 3) * 30, -0.8, -Math.PI / 2)), i);
  capacitor(P, sb.clone().multiply(T(20, 14, -0.8, -Math.PI / 2)), 3, 8);
  bundle(P, ['wireA', 'wireB', 'dark'], [v3(20, sy + 18, Z(262)), v3(40, sy + 40, Z(256)), v3(70, y0 + 182, Z(250)), v3(70, y0 + 170, Z(282))], { r: 0.9, ties: [0.5] });
  // rear main board, standing parallel to the back wall, parts facing the tube (12, 13)
  rearBoard(P, f);
  sideBoard(P, f);
  // bottom board: flyback, heatsink, capacitors
  P.add('board', box(236, 1.6, 200).translate(0, y0 + 9, Z(176)));
  P.add('chip', cyl(17, 34, 28).translate(-56, y0 + 27, Z(214))); // flyback
  P.add('tin', cyl(12, 3, 20).translate(-56, y0 + 45.5, Z(214)));
  for (let k = 0; k < 7; k++) P.add('alu', box(1.2, 22, 34).translate(30 + k * 4, y0 + 21, Z(110)));
  for (const [x, d, r, h] of [[-90, 120, 9, 26], [-40, 110, 6, 18], [70, 150, 7, 20], [-20, 250, 5, 14], [90, 230, 8, 22]] as const) capacitor(P, T(x, y0 + 9.8, Z(d)), r, h);
  for (const [x, d] of [[-10, 140], [20, 170], [-50, 180]] as const) dip(P, T(x, y0 + 9.8, Z(d)), 24, 7);
  for (let i = 0; i < 10; i++) resistor(P, T(-80 + i * 16, y0 + 9.8, Z(i % 2 ? 128 : 236)), i);
  // high-voltage cage at the lower back left (12, 13)
  perforated(P, v3(-58, y0 + 40, Z(246)), 58, 50, 54, ['front', 'top', 'left'], { pitch: 6, hole: 1.6, margin: 8 });
  // steel brackets and cream terminal blocks along the top behind the bezel
  for (const sx of [-1, 1]) {
    P.add('metal', box(14, 22, 26).translate(sx * 118, y0 + 222, Z(62)));
    screw(P, v3(sx * 118, y0 + 233.2, Z(62)), 'y', 2);
    P.add('cream', box(12, 10, 14).translate(sx * 96, y0 + 206, Z(84)));
  }
  // yoke and board looms
  bundle(P, ['wireA', 'wireB', 'dark', 'wireC'], [v3(30, sy + 30, Z(190)), v3(62, sy + 34, Z(214)), v3(-30, y0 + 186, Z(272)), v3(-52, y0 + 150, Z(286))], { ties: [0.35, 0.7] });
  bundle(P, ['wireB', 'wireA', 'wireD'], [v3(-30, sy - 30, Z(192)), v3(-66, sy - 54, Z(220)), v3(-70, y0 + 40, Z(270))], { ties: [0.5] });
}

/** Acrylic frame for the monitor: rails round the bezel, the rear box and along the tapering edges. */
function monitorFrame(P: Parts, f: MonitorFrame) {
  const { front, y0 } = f, M = MONITOR, Z = (d: number) => front - d, s = 8;
  acrylicFrame(P, v3(0, y0 + M.h / 2, Z(M.bezel / 2)), M.w, M.h, M.bezel, { size: s, every: 58, skip: ['back'] });
  acrylicFrame(P, v3(0, y0 + 105, Z((265.5 + M.depth) / 2)), 165, 162, M.depth - 265.5, { size: s, every: 52, skip: ['front'] });
  for (const sx of [-1, 1]) {
    rail(P, 'acrylic', v3(sx * (158 - s / 2), y0 + 247 - s / 2, Z(M.bezel)), v3(sx * (100 - s / 2), y0 + 186 - s / 2, Z(265)), s);
    rail(P, 'acrylic', v3(sx * (158 - s / 2), y0 + 3 + s / 2, Z(M.bezel)), v3(sx * (100 - s / 2), y0 + 9 + s / 2, Z(265)), s);
  }
  // posts inside the bezel corners carrying the band's ears
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) rail(P, 'acrylic', v3(sx * 140, f.sy + sy * 104, Z(10)), v3(sx * 140, f.sy + sy * 104, Z(36)), 10);
}

function rearBoard(P: Parts, f: MonitorFrame) {
  const { front, y0 } = f, z = front - 292, m = T(0, y0 + 104, z);
  P.put('board', box(150, 144, 1.6), m.clone());
  for (const [x, y] of [[-68, -64], [68, -64], [-68, 64], [68, 64]] as const) {
    P.add('tin', cyl(2.4, 12, 10).rotateX(Math.PI / 2).translate(x, y0 + 104 + y, z - 7));
    screw(P, v3(x, y0 + 104 + y, z + 0.9), 'z', 1.8);
  }
  const on = (x: number, y: number) => m.clone().multiply(T(x, y, 0.8, Math.PI / 2)); // seat on the front face
  P.put('chip', prism(26, 26, 22, 2, 0.6).translate(0, 0, 11), T(-34, y0 + 140, z + 0.8)); // transformer
  P.put('coil', box(18, 20, 18).translate(0, 0, 13), T(-34, y0 + 140, z + 0.8));
  for (const [x, y] of [[20, 50], [44, 50], [20, 30]] as const) P.put('tin', box(12, 10, 14).translate(0, 0, 7), T(x, y0 + 104 + y, z + 0.8)); // relays
  for (const [x, y, len] of [[-30, -30, 26], [10, -10, 20], [40, -40, 18], [-50, 10, 16], [30, 10, 22]] as const) dip(P, on(x, y), len, 7);
  for (const [x, y, r, h] of [[54, -10, 5, 14], [-8, 34, 6, 16], [-56, -40, 4, 10], [8, -48, 5, 12], [60, 26, 4, 11]] as const) capacitor(P, on(x, y), r, h);
  for (let i = 0; i < 16; i++) resistor(P, on(-60 + (i % 8) * 16, -58 + Math.floor(i / 8) * 76, ), i);
  for (const [x, y] of [[-12, -60], [24, 60], [-60, 50]] as const) P.put('cream', box(6, 10, 12).translate(0, 0, 6), T(x, y0 + 104 + y, z + 0.8)); // film capacitors
  for (const [x, y] of [[0, -62], [-40, 62], [50, -60]] as const) ceramic(P, on(x, y));
}

function sideBoard(P: Parts, f: MonitorFrame) {
  // tan board standing along the right wall behind the yoke, parts facing out toward the case wall (seen through it)
  const { front, y0 } = f, x = f.halfW(236) - 16, m = T(x, y0 + 92, front - 236, 0, 0, -Math.PI / 2);
  P.put('boardTan', box(92, 1.6, 64), m.clone()); // lies in the yz plane after the turn; its +y face points to +x
  const on = (dy: number, dz: number) => m.clone().multiply(T(dy, 0.8, dz)); // local x = up the board, local z = along it
  for (const [dy, dz, len] of [[-24, -14, 20], [12, 14, 16], [30, -18, 14]] as const) dip(P, on(dy, dz).multiply(T(0, 0, 0, 0, Math.PI / 2)), len, 7);
  for (const [dy, dz, r, h] of [[-36, 18, 5, 13], [0, -22, 6, 15], [34, 16, 4, 10]] as const) capacitor(P, on(dy, dz), r, h);
  for (let i = 0; i < 8; i++) resistor(P, on(-36 + (i % 4) * 22, i < 4 ? -28 : 2), i);
  P.put('tin', box(12, 14, 10).translate(0, 7, 0), on(36, -26)); // relay
  P.put('cream', box(10, 12, 6).translate(0, 6, 0), on(-40, 0));
}
