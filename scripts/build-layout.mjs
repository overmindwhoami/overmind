// Precomputes the replica tower at build time (the reference simulates this at load, costing ~300 ms of main thread).
// Every replica is a 3.5" floppy disk. Output: src/data/layout.json with per-disk matrices, oriented boxes,
// the loop period and the sample replica records (including how each disk looks: shell, shutter, write-protect, label).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4, Quaternion, Vector3 } from 'three';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(resolve(root, 'src/engine/tower-spec.json'), 'utf8'));
const { mm: MM, disk: DISK, count: COUNT, hiddenBase: BASE } = spec;

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
const blocked = (box, placed) =>
  box.center.y - verticalHalf(box) < 0 || placed.some((p) => Math.abs(p.center.y - box.center.y) < 1.2 && overlaps(box, p));
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
const reach = Math.max(...visible.map((v) => verticalHalf(v.box)));
const ys = visible.map((v) => v.box.center.y);
let period = Math.max(...ys) - Math.min(...ys) + reach * 2;
const collides = (lift) => visible.some((a) => visible.some((b) => Math.abs(b.box.center.y + lift - a.box.center.y) < reach * 2 && overlaps(a.box, b.box, lift)));
while (!collides(period - 0.01)) period -= 0.01;
const shift = -(Math.min(...ys) + Math.max(...ys)) / 2;
visible.forEach((v) => { v.box.center.y += shift; v.matrix.elements[13] += shift; });

// ---- Sample replica records (placeholders until real chain data exists) ----
const dr = rng(spec.dataSeed);
const hex = (n) => Array.from({ length: n }, () => Math.floor(dr(0, 16)).toString(16)).join('');
const pickShell = () => {
  let u = dr(), i = 0;
  while (i < spec.shells.length - 1 && u >= spec.shells[i].share) u -= spec.shells[i++].share;
  return i;
};
let block = 18_430_212;
const born = Date.UTC(2025, 0, 6);
const replicas = visible.map((v, i) => {
  const strain = pickShell();
  const [t0, t1] = spec.shells[strain].tint;
  const inherited = dr(0.05, 0.95);
  const alive = i >= COUNT - 6 ? true : dr() < 0.28;
  block += Math.floor(dr(9000, 26000));
  return {
    index: i,
    gen: i + 1,
    parent: i === 0 ? null : Math.max(1, i - Math.floor(dr(0, Math.min(i, 4)))),
    hash: hex(64),
    block,
    born: new Date(born + i * 7 * 86400000).toISOString().slice(0, 10),
    strain,
    tint: +dr(t0, t1).toFixed(4),
    inherited: +inherited.toFixed(4),
    alive,
    // how the disk looks: running replicas have their shutter (part) open, archived ones are write-protected
    open: alive ? +dr(0.35, 1).toFixed(3) : dr() < 0.08 ? +dr(0.1, 0.4).toFixed(3) : 0,
    protect: !alive && dr() < 0.65,
    label: dr() < spec.labels.blank ? -1 : Math.floor(dr(0, spec.labels.templates)),
    hub: +dr(0, Math.PI * 2).toFixed(4),
    seed: Math.floor(dr(0, 2 ** 31)),
  };
});

const round = (n) => +n.toFixed(6);
const layout = {
  generated: 'scripts/build-layout.mjs',
  period: round(period),
  half: HALF.map(round),
  slabs: visible.map((v, i) => ({
    index: i,
    y: round(v.box.center.y),
    matrix: v.matrix.elements.map(round),
    axes: v.box.axes.map((a) => a.toArray().map(round)),
    center: v.box.center.toArray().map(round),
  })),
  replicas,
};
mkdirSync(resolve(root, 'src/data'), { recursive: true });
writeFileSync(resolve(root, 'src/data/layout.json'), JSON.stringify(layout));
console.log(`layout: ${visible.length} disks, period ${period.toFixed(4)} u, y ${Math.min(...layout.slabs.map((s) => s.y)).toFixed(3)}…${Math.max(...layout.slabs.map((s) => s.y)).toFixed(3)}`);
