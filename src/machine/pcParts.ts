/**
 * Shared machinery for the Overmind PC: material keys, the per-material geometry collector, lofting, and a kit of
 * small electronic parts (chips, capacitors, wire bundles, ribbon cables, screws, acrylic frames). Millimetres.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { filletRing, type V2 } from '../engine/floppy/shapes';
import type { Corner } from '../engine/floppy/spec';
import { brushTangents, cyl, prism } from './geom';

export type Key = 'case' | 'accent' | 'trim' | 'door' | 'keyLight' | 'keyDark' | 'well' | 'seam' | 'rubber' | 'screen' | 'led' | 'ledDim'
  | 'steel' | 'metal' | 'dark' | 'chip' | 'matte' | 'cable' | 'board' | 'part'
  | 'acrylic' | 'pane' | 'tube' | 'neck' | 'copper' | 'brass' | 'tin' | 'alu' | 'wireA' | 'wireB' | 'wireC' | 'wireD' | 'sleeve' | 'sleeveBlack'
  | 'ribbon' | 'boardTan' | 'cream' | 'header' | 'gold' | 'ledGreen' | 'ledAmber' | 'coil' | 'tie' | 'orange' | 'blue' | 'label';
export const ABS_KEYS: Key[] = ['case', 'accent', 'trim', 'door', 'keyLight', 'keyDark', 'well'];

/* ------------------------------------------------------------------ collector */
export class Parts {
  map = new Map<Key, THREE.BufferGeometry[]>();
  add(k: Key, g: THREE.BufferGeometry) { const l = this.map.get(k) ?? []; l.push(g.index ? g.toNonIndexed() : g); this.map.set(k, l); return g; }
  /** Adds a geometry built around the origin, placed by `m`. */
  put(k: Key, g: THREE.BufferGeometry, m: THREE.Matrix4) { return this.add(k, g.applyMatrix4(m)); }
  build(m: Record<Key, THREE.Material>) {
    const group = new THREE.Group();
    for (const [k, list] of this.map) {
      const merged = mergeGeometries(list.map((g) => {
        for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
        if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
        return g;
      }));
      if (ABS_KEYS.includes(k)) boxUV(merged);
      if (k === 'steel') brushTangents(merged);
      const mesh = new THREE.Mesh(merged, m[k]);
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    return group;
  }
}

/* ------------------------------------------------------------------ geometry */
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Placement: translate, then rotate (radians, XYZ). */
export const T = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), v3(1, 1, 1));
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export const roundRect = (w: number, h: number, r: number, cx = 0, cy = 0): V2[] =>
  filletRing([[cx - w / 2, cy - h / 2, r], [cx + w / 2, cy - h / 2, r], [cx + w / 2, cy + h / 2, r], [cx - w / 2, cy + h / 2, r]] as Corner[]);

/** Surface through rings of equal point count (each ring at its own z), optional caps at either end. Axis = z. */
export function loftRings(rings: { pts: V2[]; z: number }[], capStart = false, capEnd = false, inward = false) {
  const pos: number[] = [], idx: number[] = [];
  const M = rings[0].pts.length;
  for (const r of rings) for (const [x, y] of r.pts) pos.push(x, y, r.z);
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < M; i++) {
    const a = j * M + i, b = j * M + ((i + 1) % M), c = (j + 1) * M + i, d = (j + 1) * M + ((i + 1) % M);
    idx.push(a, b, c, b, d, c);
  }
  const cap = (r: { pts: V2[]; z: number }, facing: 1 | -1) => {
    const base = pos.length / 3;
    for (const [x, y] of r.pts) pos.push(x, y, r.z);
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(r.pts.map(([x, y]) => new THREE.Vector2(x, y)), []))
      idx.push(...(facing > 0 ? [base + i, base + j, base + k] : [base + i, base + k, base + j]));
  };
  if (capStart) cap(rings[0], rings[0].z > rings[1].z ? 1 : -1);
  if (capEnd) cap(rings[rings.length - 1], rings[rings.length - 1].z > rings[rings.length - 2].z ? 1 : -1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // orient: the side surface's normal at the first point should point away from the ring centre
  const n = g.getAttribute('normal'), p0 = rings[0].pts[0], c0 = rings[0].pts.reduce((s, p) => [s[0] + p[0] / M, s[1] + p[1] / M], [0, 0]);
  if ((n.getX(0) * (p0[0] - c0[0]) + n.getY(0) * (p0[1] - c0[1]) < 0) !== inward) { for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]; g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

/** Per-triangle box projection in millimetres (for the stipple normal map). Geometry must be non-indexed. */
export function boxUV(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'), uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = [a, b, c][k];
      const [u, w] = ax >= ay && ax >= az ? [v.z, v.y] : ay >= az ? [v.x, v.z] : [v.x, v.y];
      uv.set([u, w], (i + k) * 2);
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** A rod of square section between two points (acrylic rails, steel bars). */
export function rail(P: Parts, k: Key, a: THREE.Vector3, b: THREE.Vector3, size: number, r = size * 0.3) {
  const len = a.distanceTo(b);
  const g = prism(size, size, len, r, Math.min(0.8, size * 0.12));
  const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 0, 1), b.clone().sub(a).normalize());
  return P.add(k, g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, v3(1, 1, 1))));
}

/* ------------------------------------------------------------------ fasteners and wiring */
const AXES = { x: v3(1, 0, 0), '-x': v3(-1, 0, 0), y: v3(0, 1, 0), '-y': v3(0, -1, 0), z: v3(0, 0, 1), '-z': v3(0, 0, -1) } as const;
export type Facing = keyof typeof AXES;
const facingQ = (f: Facing) => new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), AXES[f]);

/** Phillips pan-head screw with a washer, head facing `f`, seated at `p`. */
export function screw(P: Parts, p: THREE.Vector3, f: Facing, r = 2.6) {
  const m = new THREE.Matrix4().compose(p, facingQ(f), v3(1, 1, 1));
  P.put('tin', cyl(r * 1.35, 0.5, 18).translate(0, 0.25, 0), m.clone());
  P.put('tin', new THREE.SphereGeometry(r, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1).translate(0, 0.5, 0), m.clone());
  for (const a of [0, Math.PI / 2]) P.put('dark', box(r * 1.3, 0.5, 0.45).rotateY(a).translate(0, 0.5 + r * 0.45 - 0.1, 0), m.clone());
}

/** One wire through points. */
export const wire = (P: Parts, k: Key, pts: THREE.Vector3[], r = 1.1) => P.add(k, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(24, pts.length * 14), r, 8, false));

/**
 * A loom of wires following one path, packed two rows deep, with white cable ties at the given fractions.
 * The packing is in the plane across the path, using `up` as the reference.
 */
export function bundle(P: Parts, keys: Key[], pts: THREE.Vector3[], { r = 1.15, ties = [] as number[], up = v3(0, 1, 0) } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const N = Math.max(40, pts.length * 16), cols = Math.ceil(keys.length / 2), pitch = r * 2.15;
  const frames = Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const ref = Math.abs(tan.dot(up)) > 0.92 ? v3(1, 0, 0) : up;
    const side = new THREE.Vector3().crossVectors(tan, ref).normalize(), lift = new THREE.Vector3().crossVectors(side, tan).normalize();
    return { p, tan, side, lift };
  });
  keys.forEach((k, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const off = (f: (typeof frames)[number]) => f.p.clone().addScaledVector(f.side, (col - (cols - 1) / 2) * pitch).addScaledVector(f.lift, (row - 0.5) * pitch);
    P.add(k, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(frames.map(off)), N, r, 7, false));
  });
  for (const t of ties) {
    const f = frames[Math.round(t * N)];
    const g = new THREE.TorusGeometry(cols * pitch * 0.62 + 1, 0.8, 6, 20).scale(1, 0.75, 1);
    P.add('tie', g.applyMatrix4(new THREE.Matrix4().compose(f.p, new THREE.Quaternion().setFromUnitVectors(v3(0, 0, 1), f.tan), v3(1, 1, 1))));
    P.add('tie', box(2.2, 3, 2.4).applyMatrix4(new THREE.Matrix4().compose(f.p.clone().addScaledVector(f.lift, cols * pitch * 0.62 + 2), new THREE.Quaternion().setFromUnitVectors(v3(0, 0, 1), f.tan), v3(1, 1, 1))));
  }
}

/** Flat ribbon cable lying along a path: grey strip with a red pin-1 edge, face normal ≈ `up`. */
export function ribbon(P: Parts, pts: THREE.Vector3[], width: number, up = v3(0, 1, 0)) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
  const N = 80, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const stripePos: number[] = [], stripeIdx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const side = new THREE.Vector3().crossVectors(tan, up);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const n = new THREE.Vector3().crossVectors(side, tan).normalize();
    const a = p.clone().addScaledVector(side, -width / 2), b = p.clone().addScaledVector(side, width / 2);
    pos.push(...a.toArray(), ...b.toArray()); uv.push(0, t * 8, 1, t * 8);
    const s0 = p.clone().addScaledVector(side, width / 2 - 1.6).addScaledVector(n, 0.12), s1 = p.clone().addScaledVector(side, width / 2).addScaledVector(n, 0.12);
    stripePos.push(...s0.toArray(), ...s1.toArray());
    if (i > 0) { const q = (i - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); stripeIdx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const s = new THREE.BufferGeometry();
  s.setAttribute('position', new THREE.Float32BufferAttribute(stripePos, 3)); s.setIndex(stripeIdx); s.computeVertexNormals();
  P.add('ribbon', g); P.add('wireA', s);
}

/* ------------------------------------------------------------------ components (built at the origin, placed by a matrix) */
/** DIP chip: black body along x, tin legs down both long sides. Seated on y = 0. */
export function dip(P: Parts, m: THREE.Matrix4, len = 30, w = 8) {
  P.put('chip', box(len, 3.2, w).translate(0, 2.2, 0), m.clone());
  P.put('cream', box(1.6, 0.2, 1.6).translate(-len / 2 + 2.2, 3.85, -w / 2 + 2), m.clone()); // pin-1 dot
  const n = Math.floor(len / 2.54);
  for (let i = 0; i < n; i++) for (const s of [-1, 1]) {
    const x = -len / 2 + (len - (n - 1) * 2.54) / 2 + i * 2.54;
    P.put('tin', box(0.6, 0.5, 1.4).translate(x, 1.6, s * (w / 2 + 0.6)), m.clone());
    P.put('tin', box(0.6, 1.6, 0.4).translate(x, 0.8, s * (w / 2 + 1.2)), m.clone());
  }
}
/** QFP/PLCC chip: square body with gull-wing legs on all four sides. Seated on y = 0. */
export function qfp(P: Parts, m: THREE.Matrix4, size = 24, pitch = 0.8, h = 2.4) {
  P.put('chip', box(size, h, size).translate(0, h / 2 + 0.5, 0), m.clone());
  P.put('part', new THREE.CircleGeometry(1.1, 16).rotateX(-Math.PI / 2).translate(-size / 2 + 2.5, h + 0.52, -size / 2 + 2.5), m.clone());
  const n = Math.floor((size - 3) / pitch);
  for (let side = 0; side < 4; side++) for (let i = 0; i < n; i++) {
    const u = -((n - 1) * pitch) / 2 + i * pitch;
    P.put('tin', box(0.32, 0.25, 1.8).translate(u, 0.3, size / 2 + 0.9).rotateY((side * Math.PI) / 2), m.clone());
  }
}
let capCount = 0;
/** Electrolytic capacitor standing on y = 0: sleeve (blue or black), silver top with a cross vent, polarity stripe. */
export function capacitor(P: Parts, m: THREE.Matrix4, r: number, h: number) {
  P.put(capCount++ % 3 === 2 ? 'sleeveBlack' : 'sleeve', cyl(r, h, 22).translate(0, h / 2, 0), m.clone());
  P.put('tin', cyl(r * 0.9, 0.5, 22).translate(0, h + 0.2, 0), m.clone());
  for (const a of [0, Math.PI / 2]) P.put('dark', box(r * 1.5, 0.15, 0.35).rotateY(a).translate(0, h + 0.5, 0), m.clone());
  P.put('cream', box(r * 0.5, h * 0.92, 0.2).translate(0, h / 2, r * 0.995), m.clone());
}
/** Ceramic disc capacitor (orange), standing on two legs. */
export function ceramic(P: Parts, m: THREE.Matrix4, r = 2.6) {
  P.put('orange', cyl(r, 1.4, 16).rotateX(Math.PI / 2).translate(0, r + 2, 0), m.clone());
  for (const s of [-1, 1]) P.put('tin', box(0.4, 2.4, 0.4).translate(s * r * 0.45, 1.2, 0), m.clone());
}
/** Axial resistor lying on y = 0 (along x), with colour bands. */
export function resistor(P: Parts, m: THREE.Matrix4, seed: number) {
  const bands: Key[] = ['wireA', 'wireD', 'wireB', 'wireC', 'dark', 'gold'];
  P.put('cream', cyl(1.1, 6, 10).rotateZ(Math.PI / 2).translate(0, 1.6, 0), m.clone());
  for (let i = 0; i < 3; i++) P.put(bands[(seed + i * 2) % bands.length], cyl(1.15, 0.6, 10).rotateZ(Math.PI / 2).translate(-1.8 + i * 1.3, 1.6, 0), m.clone());
  for (const s of [-1, 1]) P.put('tin', box(2.6, 0.4, 0.4).translate(s * 4.2, 1.6, 0), m.clone());
}
/** Connector with pins: body (cream/black), gold pins standing up in one or two rows. */
export function header(P: Parts, m: THREE.Matrix4, pins: number, rows = 1, body: Key = 'cream', h = 7) {
  const len = pins * 2.54 + 2, d = rows * 2.54 + 2.6;
  P.put(body, box(len, h, d).translate(0, h / 2, 0), m.clone());
  P.put('dark', box(len - 2, 0.3, d - 1.6).translate(0, h + 0.02, 0), m.clone());
  for (let r = 0; r < rows; r++) for (let i = 0; i < pins; i++) P.put('gold', box(0.64, h * 0.8, 0.64).translate(-len / 2 + 2.27 + i * 2.54, h * 0.55, (r - (rows - 1) / 2) * 2.54), m.clone());
}
/** Mains/signal transformer: brass-wrapped coil between dark laminated core plates, on steel feet. Seated on y = 0. */
export function transformer(P: Parts, m: THREE.Matrix4, w: number, h: number, d: number) {
  P.put('brass', prism(w * 0.78, h * 0.8, d * 0.72, 2.5, 0.8).translate(0, h * 0.45, 0), m.clone());
  for (const s of [-1, 1]) {
    P.put('chip', box(w, h, 2.4).translate(0, h / 2, s * (d / 2 - 1.2)), m.clone());
    for (let k = 1; k < 6; k++) P.put('dark', box(w + 0.1, 0.25, 2.5).translate(0, (h * k) / 6, s * (d / 2 - 1.2)), m.clone());
    P.put('metal', box(w + 8, 1, 5).translate(0, 0.5, s * (d / 2 + 1)), m.clone());
  }
}

/* ------------------------------------------------------------------ steel boxes and acrylic frames */
export type Face = 'front' | 'back' | 'top' | 'left' | 'right';
/** Perforated steel box (centre p, size w × h × d) with round holes on the given faces and screws at their corners. */
export function perforated(P: Parts, p: THREE.Vector3, w: number, h: number, d: number, faces: Face[], { pitch = 6.5, hole = 1.7, margin = 9, gap = 0 } = {}) {
  P.add('metal', prism(w, h, d, 2.2, 0.7).translate(p.x, p.y, p.z));
  const grid = (lu: number, lv: number, place: (u: number, v: number) => void) => {
    const nu = Math.floor((lu - 2 * margin) / pitch) + 1, nv = Math.floor((lv - 2 * margin) / pitch) + 1;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u = (i - (nu - 1) / 2) * pitch, v = (j - (nv - 1) / 2) * pitch;
      if (gap && Math.abs(u) < gap / 2) continue;
      place(u, v);
    }
  };
  const disc = (f: Facing) => cyl(hole, 0.3, 10).applyQuaternion(facingQ(f));
  if (faces.includes('front')) grid(w, h, (u, v) => P.add('seam', disc('z').translate(p.x + u, p.y + v, p.z + d / 2 + 0.1)));
  if (faces.includes('back')) grid(w, h, (u, v) => P.add('seam', disc('-z').translate(p.x + u, p.y + v, p.z - d / 2 - 0.1)));
  if (faces.includes('top')) grid(d, w, (u, v) => P.add('seam', disc('y').translate(p.x + v, p.y + h / 2 + 0.1, p.z + u)));
  if (faces.includes('left')) grid(d, h, (u, v) => P.add('seam', disc('-x').translate(p.x - w / 2 - 0.1, p.y + v, p.z + u)));
  if (faces.includes('right')) grid(d, h, (u, v) => P.add('seam', disc('x').translate(p.x + w / 2 + 0.1, p.y + v, p.z + u)));
  for (const f of faces) {
    const [n, a, b] = f === 'front' ? [v3(0, 0, 1), v3(1, 0, 0), v3(0, 1, 0)] : f === 'back' ? [v3(0, 0, -1), v3(1, 0, 0), v3(0, 1, 0)] : f === 'top' ? [v3(0, 1, 0), v3(1, 0, 0), v3(0, 0, 1)] : f === 'left' ? [v3(-1, 0, 0), v3(0, 0, 1), v3(0, 1, 0)] : [v3(1, 0, 0), v3(0, 0, 1), v3(0, 1, 0)];
    const ext = (u: THREE.Vector3) => Math.abs(u.x) * w + Math.abs(u.y) * h + Math.abs(u.z) * d;
    const half = ext(n) / 2, ha = ext(a) / 2 - 4, hb = ext(b) / 2 - 4;
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) screw(P, p.clone().addScaledVector(n, half + 0.2).addScaledVector(a, sa * ha).addScaledVector(b, sb * hb), (f === 'front' ? 'z' : f === 'back' ? '-z' : f === 'top' ? 'y' : f === 'left' ? '-x' : 'x') as Facing, 1.6);
  }
}

/**
 * Acrylic construction frame round a box (centre c, size w × h × d): square rails on all 12 edges, clips along
 * the rails on each face, screws at every corner. `skip` leaves out faces whose clips would clutter (e.g. 'bottom').
 */
export function acrylicFrame(P: Parts, c: THREE.Vector3, w: number, h: number, d: number, { size = 9, every = 64, skip = [] as string[], screwR = 2.4 } = {}) {
  const hx = w / 2 - size / 2, hy = h / 2 - size / 2, hz = d / 2 - size / 2;
  const corner = (sx: number, sy: number, sz: number) => v3(c.x + sx * hx, c.y + sy * hy, c.z + sz * hz);
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) rail(P, 'acrylic', corner(-1, sy, sz).setX(c.x - w / 2), corner(1, sy, sz).setX(c.x + w / 2), size);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rail(P, 'acrylic', corner(sx, -1, sz).setY(c.y - hy + size / 2), corner(sx, 1, sz).setY(c.y + hy - size / 2), size);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) rail(P, 'acrylic', corner(sx, sy, -1).setZ(c.z - hz + size / 2), corner(sx, sy, 1).setZ(c.z + hz - size / 2), size);
  // clips: small blocks on the inside of each panel, next to its edge rails
  const clip = (p: THREE.Vector3, along: 'x' | 'y' | 'z', inward: THREE.Vector3) => {
    const g = box(along === 'x' ? 11 : 6.5, along === 'y' ? 11 : 6.5, along === 'z' ? 11 : 6.5);
    P.add('acrylic', g.translate(p.x + inward.x * 3, p.y + inward.y * 3, p.z + inward.z * 3));
  };
  const faces: [string, THREE.Vector3, 'x' | 'y' | 'z', 'x' | 'y' | 'z'][] = [
    ['front', v3(0, 0, 1), 'x', 'y'], ['back', v3(0, 0, -1), 'x', 'y'], ['top', v3(0, 1, 0), 'x', 'z'],
    ['bottom', v3(0, -1, 0), 'x', 'z'], ['left', v3(-1, 0, 0), 'z', 'y'], ['right', v3(1, 0, 0), 'z', 'y'],
  ];
  const ext = { x: w, y: h, z: d } as const;
  for (const [name, n, a, b] of faces) {
    if (skip.includes(name)) continue;
    const plane = c.clone().addScaledVector(n, (Math.abs(n.x) * w + Math.abs(n.y) * h + Math.abs(n.z) * d) / 2 - 3.5);
    const inward = n.clone().negate();
    for (const [dir, other] of [[a, b], [b, a]] as const) {
      const len = ext[dir] - 2 * size, count = Math.max(1, Math.round(len / every));
      for (let i = 0; i < count; i++) for (const s of [-1, 1]) {
        const p = plane.clone();
        p[dir] += -len / 2 + ((i + 0.5) * len) / count;
        p[other] += s * (ext[other] / 2 - size - 3.5);
        clip(p, dir, inward);
      }
    }
    // screws at the four corners of the face, on the rails
    const fa: Facing = (n.x > 0 ? 'x' : n.x < 0 ? '-x' : n.y > 0 ? 'y' : n.y < 0 ? '-y' : n.z > 0 ? 'z' : '-z');
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const p = c.clone().addScaledVector(n, (Math.abs(n.x) * w + Math.abs(n.y) * h + Math.abs(n.z) * d) / 2 + 0.1);
      p[a] += sa * (ext[a] / 2 - size / 2); p[b] += sb * (ext[b] / 2 - size / 2);
      screw(P, p, fa, screwR);
    }
  }
}
