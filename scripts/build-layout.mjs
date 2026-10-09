// Precomputes the lineage tower at build time (the reference simulates its stack at load, costing ~300 ms).
// Disk 0 (genesis) is dropped first; every later disk lands on top, so the archive can grow without the stack ever
// moving. Output: src/data/layout.json with one pose (position + quaternion) per disk, up to MAX disks.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4, Quaternion, Vector3 } from 'three';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(resolve(root, 'src/engine/tower-spec.json'), 'utf8'));
const { mm: MM, disk: DISK, hiddenBase: BASE } = spec;
const COUNT = spec.maxDisks;

function rng(seed) {
  let s = seed >>> 0;
  return (a = 0, b = 1) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return a + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (b - a);
  };
}

// ---- Oriented boxes and separating-axis tests ----
// Square in plan (the larger side) so a disk can lie at any quarter turn inside its box.
const SIDE = Math.max(DISK.w, DISK.h) / 2;
const HALF = [SIDE * MM + 4e-4, SIDE * MM + 4e-4, (DISK.t / 2) * MM + 4e-4]; // picking box
// Collision uses a thicker envelope than the 3.3 mm disk, so the stack keeps the reference's open rhythm
// (cassettes are 8.8 mm thick; thin disks would otherwise pack into a solid wall).
const COLLIDE = [HALF[0], HALF[1], (spec.stackSpacing / 2) * MM + 4e-4];
const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const makeBox = (m) => {
  const axes = [new Vector3(), new Vector3(), new Vector3()];
  m.extractBasis(axes[0], axes[1], axes[2]);
  axes.forEach((a) => a.normalize());
  return { axes, center: new Vector3().setFromMatrixPosition(m), half: COLLIDE };
};
const verticalHalf = (b) => b.axes.reduce((s, a, i) => s + Math.abs(a.y) * b.half[i], 0);
const extent = (b, axis) => b.axes.reduce((s, a, i) => s + Math.abs(a.dot(axis)) * b.half[i], 0);
const delta = new Vector3(), unit = new Vector3();
function overlaps(a, b, lift = 0) {
  delta.copy(b.center).sub(a.center);
  delta.y += lift;
  const axes = [...a.axes, ...b.axes];
  for (const p of a.axes) for (const q of b.axes) axes.push(new Vector3().crossVectors(p, q));
  for (const ax of axes) {
    if (ax.lengthSq() < 1e-8) continue;
    unit.copy(ax).normalize();
    if (Math.abs(delta.dot(unit)) > extent(a, unit) + extent(b, unit)) return false;
  }
  return true;
}
// only the top of the stack can be touched by a falling disk
const blocked = (box, placed) =>
  box.center.y - verticalHalf(box) < 0 || placed.slice(-48).some((p) => Math.abs(p.center.y - box.center.y) < 1.2 && overlaps(box, p));
function drop(box, placed, fromY) {
  let y = fromY;
  for (;;) {
    box.center.y = y - 0.01;
    if (blocked(box, placed)) break;
    y -= 0.01;
  }
  let lo = y - 0.01, hi = y;
  for (let i = 0; i < 8; i++) {
    box.center.y = (lo + hi) / 2;
    if (blocked(box, placed)) lo = box.center.y; else hi = box.center.y;
  }
  box.center.y = hi;
  return box;
}

// ---- Stack: golden-angle spiral, four candidate poses, keep the lowest resting one ----
const r = rng(spec.layoutSeed);
const placed = [], visible = [];
const q = new Quaternion(), qa = new Quaternion(), basis = new Matrix4();
let azimuth = r(0, Math.PI * 2), top = 0;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
for (let d = 0; d < BASE + COUNT; d++) {
  azimuth += GOLDEN + r(-0.35, 0.35);
  const radius = r(0.42, 0.62);
  const out = new Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
  const side = new Vector3().crossVectors(UP, out);
  const flip = r() < 0.5;
  const turn = Math.floor(r(0, 4)); // which edge faces out: shutter, chamfer side, label edge or write-protect side
  let best;
  for (let k = 0; k < 4; k++) {
    basis.makeBasis(out, side, UP);
    q.setFromRotationMatrix(basis);
    q.multiply(qa.setFromAxisAngle(X, r(-0.45, 0.45)));
    q.multiply(qa.setFromAxisAngle(Y, r(-0.3, 0.3)));
    q.multiply(qa.setFromAxisAngle(Z, r(-0.3, 0.3)));
    if (flip) q.multiply(qa.setFromAxisAngle(X, Math.PI));
    q.multiply(qa.setFromAxisAngle(Z, turn * (Math.PI / 2)));
    const m = new Matrix4().compose(out.clone().multiplyScalar(radius), q, new Vector3(1, 1, 1));
    const box = drop(makeBox(m), placed, top + 0.3);
    if (!best || box.center.y < best.box.center.y) best = { box, matrix: m };
  }
  best.matrix.setPosition(best.box.center);
  placed.push(best.box);
  top = Math.max(top, best.box.center.y + verticalHalf(best.box));
  if (d >= BASE) visible.push(best);
}
const round = (n) => +n.toFixed(5);
const disks = visible.map((v) => {
  const p = new Vector3(), qq = new Quaternion(), sc = new Vector3();
  v.matrix.decompose(p, qq, sc);
  return [...p.toArray(), ...qq.toArray()].map(round);
});
const ys = disks.map((d) => d[1]);
const layout = { generated: 'scripts/build-layout.mjs', half: HALF.map(round), disks };
mkdirSync(resolve(root, 'src/data'), { recursive: true });
writeFileSync(resolve(root, 'src/data/layout.json'), JSON.stringify(layout));
console.log(`layout: ${disks.length} disk poses, y ${Math.min(...ys).toFixed(3)}…${Math.max(...ys).toFixed(3)}, ${(JSON.stringify(layout).length / 1024).toFixed(0)} KB`);
