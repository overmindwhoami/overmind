/**
 * The disk wall (explorer), modelled from docs/reference-room/wall (01-hero, 02-front, 03-side, 04-macro-cubby,
 * 05-macro-labels): a grid of clear acrylic cubbies, 13 across and 7 high, each holding one disk standing face out
 * and leaning back a little, joined at every corner by chrome cap bolts and held between two brushed steel posts on
 * wall brackets. Every launched token is one disk here; the disks themselves are the floppy kit's (placed by `slot`).
 * Millimetres; origin on the wall under the grid's centre line (x centred, y = 0 at the bottom, +z out of the wall).
 */
import * as THREE from 'three';
import type { FloppyTextures, GlassUniforms } from '../engine/floppy/materials';
import { cyl, prism } from './geom';
import { machineMaterials } from './pc';
import { Parts, box, rail, screw, v3 } from './pcParts';

export const WALL = { cols: 13, rows: 7, pitchX: 112, pitchY: 110, depth: 92, off: 46, post: 44, base: 24 } as const;
const W = WALL.cols * WALL.pitchX, H = WALL.rows * WALL.pitchY;
const Z0 = WALL.off, Z1 = WALL.off + WALL.depth; // cubby back and front
const LEAN = 0.13; // disks lean back in their cubbies (03)

/** Centre of cubby (col, row) on its floor, at the front, in wall millimetres (row 0 = top). */
export function cubby(col: number, row: number) {
  return v3(-W / 2 + (col + 0.5) * WALL.pitchX, WALL.base + H - (row + 1) * WALL.pitchY, Z1);
}

/** Pose for the disk in cubby i (row-major from the top left), in wall millimetres: standing face out, leaning back. */
export function slot(i: number) {
  const col = i % WALL.cols, row = Math.floor(i / WALL.cols), c = cubby(col, row);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-LEAN, 0, 0));
  // the disk's local frame (floppy kit): label on +z, shutter edge at +y, centred
  const centre = v3(c.x, c.y + 6 + 47 * Math.cos(LEAN), c.z - 34 - 47 * Math.sin(LEAN));
  return new THREE.Matrix4().compose(centre, q, v3(1, 1, 1));
}
export const SLOTS = WALL.cols * WALL.rows;

export function buildWall(t: FloppyTextures, gu: GlassUniforms) {
  const P = new Parts();
  const { cols, rows, pitchX, pitchY, base, post } = WALL;
  // back sheet, shelves and dividers (clear), each cubby's front edges as thick polished rails (01, 04)
  P.add('pane', box(W, H, 5).translate(0, base + H / 2, Z0 + 2.5));
  for (let r = 0; r <= rows; r++) {
    const y = base + r * pitchY;
    P.add('pane', box(W, 5, WALL.depth).translate(0, y, (Z0 + Z1) / 2));
    rail(P, 'acrylic', v3(-W / 2, y, Z1 - 4), v3(W / 2, y, Z1 - 4), 8, 2);
    rail(P, 'acrylic', v3(-W / 2, y, Z0 + 6), v3(W / 2, y, Z0 + 6), 6, 2);
  }
  for (let c = 0; c <= cols; c++) {
    const x = -W / 2 + c * pitchX;
    P.add('pane', box(5, H, WALL.depth).translate(x, base + H / 2, (Z0 + Z1) / 2));
    rail(P, 'acrylic', v3(x, base, Z1 - 4), v3(x, base + H, Z1 - 4), 8, 2);
  }
  // a front lip on each cubby floor with a finger notch (04)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const p = cubby(c, r);
    for (const s of [-1, 1]) P.add('acrylic', box(pitchX * 0.36, 10, 4).translate(p.x + s * pitchX * 0.31, p.y + 7, Z1 - 2));
  }
  // chrome cap bolts at every joint: four round heads round each crossing (01, 04, 05)
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const x = -W / 2 + c * pitchX, y = base + r * pitchY;
    for (const [dx, dy] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) {
      if ((c === 0 && dx < 0) || (c === cols && dx > 0) || (r === 0 && dy < 0) || (r === rows && dy > 0)) continue;
      P.add('tin', cyl(4.4, 3, 12).rotateX(Math.PI / 2).translate(x + dx, y + dy, Z1 + 1.5));
      P.add('tin', new THREE.SphereGeometry(4, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.55).translate(x + dx, y + dy, Z1 + 3));
      P.add('dark', cyl(1.6, 0.6, 6).rotateX(Math.PI / 2).translate(x + dx, y + dy, Z1 + 5.3));
    }
  }
  // brushed steel posts at both ends, screwed to the grid, on wall brackets (01, 03)
  for (const s of [-1, 1]) {
    const x = s * (W / 2 + post / 2);
    P.add('metal', prism(post, H + 50, WALL.depth + 20, 3, 1).translate(x, base + H / 2, (Z0 + Z1) / 2 - 6));
    for (let k = 0; k < 8; k++) screw(P, v3(x, base - 10 + (k * (H + 20)) / 7, Z1 + 4.2), 'z', 3.4);
    for (const y of [base + 60, base + H - 60]) {
      P.add('metal', box(70, 70, 5).translate(x, y, 2.5));
      P.add('metal', box(post - 10, 50, Z0 - 6).translate(x, y, 5 + (Z0 - 6) / 2));
      screw(P, v3(x - s * 20, y, 5.2), 'z', 5);
    }
  }
  return P.build(machineMaterials(t, gu, 'clear', new THREE.Texture()));
}
