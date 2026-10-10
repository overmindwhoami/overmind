/**
 * The desk the computer and the manual stand on, modelled from docs/reference-room/desk (01-hero, 02-clear): a thick
 * clear acrylic top on a champagne steel frame, a T-leg at the left end, a modesty panel at the back with a wire cable
 * basket under the top, and a clear drawer pedestal on the right (steel corner posts, two drawers on ball-bearing
 * slides, bar handles). Millimetres; origin on the floor under the top's centre, +z toward the sitter.
 */
import * as THREE from 'three';
import type { FloppyTextures, GlassUniforms } from '../engine/floppy/materials';
import { cyl, prism } from './geom';
import { machineMaterials } from './pc';
import { Parts, box, rail, screw, v3, wire } from './pcParts';

export const DESK = { w: 1600, d: 800, h: 740, top: 30 } as const;
const PED = { x0: 340, x1: 760, z0: -360, z1: 360 }; // drawer pedestal footprint

export function buildDesk(t: FloppyTextures, gu: GlassUniforms) {
  const P = new Parts();
  const { w, d, h, top } = DESK, y0 = h - top; // underside of the top
  // the top: one thick clear slab with polished edges, a grommet at the back right (02)
  P.add('acrylic', prism(w, d, top, 6, 3).rotateX(-Math.PI / 2).translate(0, h - top / 2, 0));
  P.add('dark', new THREE.TorusGeometry(26, 6, 10, 32).rotateX(Math.PI / 2).translate(w / 2 - 320, h + 0.5, -d / 2 + 90));
  P.add('dark', cyl(22, 2, 28).translate(w / 2 - 320, h - 1, -d / 2 + 90));
  // sub-frame under the top: rails along the back and front, cross rails at the leg and the pedestal, top clips
  for (const z of [-d / 2 + 60, d / 2 - 60]) rail(P, 'alu', v3(-w / 2 + 50, y0 - 15, z), v3(PED.x0, y0 - 15, z), 30, 4);
  for (const x of [-w / 2 + 70, PED.x0 + 10]) rail(P, 'alu', v3(x, y0 - 15, -d / 2 + 40), v3(x, y0 - 15, d / 2 - 40), 30, 4);
  for (const x of [-w / 2 + 70, -200, PED.x0 + 10]) for (const z of [-d / 2 + 60, d / 2 - 60]) {
    P.add('alu', box(60, 6, 60).translate(x, y0 - 3, z));
    for (const s of [-1, 1]) screw(P, v3(x + s * 20, h + 0.2, z), 'y', 4);
  }
  // T-leg at the left: column, foot bar with levellers, a plate under the top (02)
  const lx = -w / 2 + 70;
  P.add('alu', prism(60, 90, y0 - 60, 4, 1.5).rotateX(-Math.PI / 2).translate(lx, 30 + (y0 - 60) / 2, 0));
  P.add('alu', box(70, 50, d - 60).translate(lx, 30, 0));
  for (const z of [-d / 2 + 50, d / 2 - 50]) leveller(P, lx, z);
  P.add('alu', box(80, 8, d - 100).translate(lx, y0 - 34, 0));
  // modesty panel at the back between the leg and the pedestal, and the wire basket with cables (02)
  const pz = -d / 2 + 70;
  P.add('alu', box(PED.x0 - lx - 40, 340, 3).translate((lx + PED.x0) / 2, y0 - 230, pz));
  for (const x of [lx + 60, PED.x0 - 30]) for (const y of [y0 - 90, y0 - 380]) screw(P, v3(x, y, pz + 1.7), 'z', 3);
  basket(P, lx + 70, PED.x0 - 60, y0 - 60, pz + 70);
  // drawer pedestal on the right
  pedestal(P, y0);
  return P.build(machineMaterials(t, gu, 'clear', new THREE.Texture()));
}

function leveller(P: Parts, x: number, z: number, y = 0) {
  P.add('rubber', cyl(18, 9, 24).translate(x, y + 4.5, z));
  P.add('steel', cyl(5, 14, 10).translate(x, y + 14, z));
}

/** Wire-mesh cable basket hanging under the top, with a few grey and blue cables tied in it. */
function basket(P: Parts, x0: number, x1: number, yTop: number, z: number) {
  const dz = 90, dy = 60, y = yTop - dy;
  for (let i = 0; i <= 5; i++) { // longitudinal wires: floor and sides
    const u = i / 5;
    rail(P, 'tin', v3(x0, y, z - dz / 2 + u * dz), v3(x1, y, z - dz / 2 + u * dz), 2.4, 1);
  }
  for (const s of [-1, 1]) for (const k of [0.5, 1]) rail(P, 'tin', v3(x0, y + dy * k, z + (s * dz) / 2), v3(x1, y + dy * k, z + (s * dz) / 2), 2.4, 1);
  for (let x = x0; x <= x1; x += 50) { // cross loops
    rail(P, 'tin', v3(x, y, z - dz / 2), v3(x, y, z + dz / 2), 2.4, 1);
    for (const s of [-1, 1]) rail(P, 'tin', v3(x, y, z + (s * dz) / 2), v3(x, y + dy, z + (s * dz) / 2), 2.4, 1);
  }
  for (const x of [x0 + 20, x1 - 20]) P.add('alu', box(20, dy + 6, 4).translate(x, y + dy / 2, z - dz / 2 - 3));
  // cables: grey and blue, clipped every so often
  for (let k = 0; k < 5; k++) {
    const zz = z - 26 + k * 13, yy = y + 8 + (k % 2) * 7;
    wire(P, k % 2 ? 'blue' : 'part', [v3(x0 - 40, yy + 10, zz), v3(x0 + 40, yy, zz), v3((x0 + x1) / 2, yy + 2, zz + 3), v3(x1 - 30, yy, zz), v3(x1 + 30, yy + 20, zz - 10)], 4);
  }
  for (let x = x0 + 120; x < x1 - 60; x += 180) P.add('dark', box(14, 30, 80).translate(x, y + 18, z));
}

/** Clear drawer pedestal: steel corner posts and base frame, clear side and back panels, two drawers on slides. */
function pedestal(P: Parts, y0: number) {
  const { x0, x1, z0, z1 } = PED, yb = 50, w = x1 - x0, cx = (x0 + x1) / 2;
  for (const x of [x0 + 12, x1 - 12]) for (const z of [z0 + 12, z1 - 12]) {
    rail(P, 'alu', v3(x, yb, z), v3(x, y0, z), 24, 3);
    leveller(P, x, z, yb - 26);
  }
  for (const y of [yb, y0 - 12]) {
    for (const z of [z0 + 12, z1 - 12]) rail(P, 'alu', v3(x0, y, z), v3(x1, y, z), 24, 3);
    for (const x of [x0 + 12, x1 - 12]) rail(P, 'alu', v3(x, y, z0), v3(x, y, z1), 24, 3);
  }
  for (const s of [-1, 1]) P.add('pane', box(8, y0 - yb - 30, z1 - z0 - 40).translate(s < 0 ? x0 + 4 : x1 - 4, (y0 + yb) / 2, 0));
  P.add('pane', box(w - 40, y0 - yb - 30, 8).translate(cx, (y0 + yb) / 2, z0 + 4));
  // drawers: a shallow one on top, a deep one below (02); clear boxes with thick fronts and bar handles
  const drawers = [{ y: y0 - 150, hh: 130 }, { y: yb + 30, hh: y0 - 190 - yb - 30 }];
  for (const dr of drawers) {
    const front = z1 - 4, dd = z1 - z0 - 40;
    P.add('acrylic', prism(w - 30, dr.hh, 16, 4, 2).translate(cx, dr.y + dr.hh / 2, front));
    P.add('pane', box(w - 60, 6, dd).translate(cx, dr.y + 8, front - dd / 2));
    for (const s of [-1, 1]) {
      P.add('pane', box(6, dr.hh * 0.7, dd).translate(cx + s * (w / 2 - 34), dr.y + dr.hh * 0.38, front - dd / 2));
      // ball-bearing slide: outer channel on the pedestal, inner on the drawer
      P.add('steel', box(4, 34, dd - 40).translate(cx + s * (w / 2 - 24), dr.y + dr.hh * 0.5, front - dd / 2));
      P.add('dark', box(2, 18, dd - 60).translate(cx + s * (w / 2 - 27), dr.y + dr.hh * 0.5, front - dd / 2));
    }
    P.add('pane', box(w - 60, dr.hh * 0.7, 6).translate(cx, dr.y + dr.hh * 0.38, front - dd));
    // bar handle on two posts
    rail(P, 'alu', v3(cx - w * 0.38, dr.y + dr.hh - 28, front + 30), v3(cx + w * 0.38, dr.y + dr.hh - 28, front + 30), 14, 3);
    for (const s of [-1, 1]) P.add('alu', box(14, 14, 24).translate(cx + s * w * 0.36, dr.y + dr.hh - 28, front + 18));
  }
}
