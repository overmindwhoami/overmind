/**
 * Procedural case mesher. The plan outline is swept with a rounded edge profile (R0.35, weld seam), each face is
 * cut into terraces (recesses and pockets at their depths) with 2D booleans, and through-holes get walls.
 * Every vertex carries `aSurf` = (ambient occlusion, roughness scale, stipple strength) and a face-decal uv.
 */
import * as THREE from 'three';
import pc from 'polygon-clipping';
import type { MultiPolygon } from 'polygon-clipping';
import { ccw, cw, inside, openRing, ringDistance, segmentDistance, type Sample, type V2 } from './shapes';

export type Surf = readonly [ao: number, rough: number, stipple: number];
export interface Terrace { ring: V2[]; depth: number; floor: Surf; wall: Surf }
export interface ShellInput {
  outline: Sample[];
  edge: number;
  z: number;
  seam: number;
  side1: Terrace[];
  side0: Terrace[];
  holes: V2[][];
  surf: { face: Surf; edge: Surf; seam: Surf; hole: Surf };
  /** Face-decal mapping: plan extents of one face. */
  decal: { w: number; h: number };
  /** Segments per quarter-round of the edge profile. */
  edgeSegments?: number;
}

type V3 = [number, number, number];
interface Vtx { p: V3; n: V3; side: 1 | -1; s: Surf }
interface Clipped extends Terrace { polys: MultiPolygon }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

class Mesher {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; surf: number[] = [];
  constructor(private decal: { w: number; h: number }) {}
  tri(a: Vtx, b: Vtx, c: Vtx, want?: V3) {
    const fn = cross(sub(b.p, a.p), sub(c.p, a.p));
    if (Math.hypot(fn[0], fn[1], fn[2]) < 1e-12) return;
    const w = want ?? [a.n[0] + b.n[0] + c.n[0], a.n[1] + b.n[1] + c.n[1], a.n[2] + b.n[2] + c.n[2]];
    const order = dot(fn, w) < 0 ? [a, c, b] : [a, b, c];
    for (const v of order) {
      this.pos.push(...v.p); this.nor.push(...v.n); this.surf.push(...v.s);
      const u = (v.side > 0 ? v.p[0] : -v.p[0]) / this.decal.w + 0.5;
      this.uv.push((v.side > 0 ? 0 : 0.5) + u * 0.5, v.p[1] / this.decal.h + 0.5);
    }
  }
  quad(a: Vtx, b: Vtx, c: Vtx, d: Vtx, want?: V3) { this.tri(a, b, c, want); this.tri(a, c, d, want); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.surf, 3));
    return g;
  }
}

/** Triangulates a MultiPolygon at height z, facing `side`. */
function cap(m: Mesher, polys: MultiPolygon, z: number, side: 1 | -1, s: Surf) {
  const n: V3 = [0, 0, side];
  for (const poly of polys) {
    const rings = poly.map((r) => openRing(r as V2[]));
    if (rings[0].length < 3) continue;
    const contour = rings[0].map(([x, y]) => new THREE.Vector2(x, y));
    const holes = rings.slice(1).filter((h) => h.length >= 3).map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
    const all = [contour, ...holes].flat();
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      const v = (q: THREE.Vector2): Vtx => ({ p: [q.x, q.y, z], n, side, s });
      m.tri(v(all[i]), v(all[j]), v(all[k]), n);
    }
  }
}

/** Per-vertex wall normals for a ring whose interior lies on the left (CCW outer / CW hole). Hard corners above 50°. */
function wallNormals(ring: V2[]) {
  const segN = ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l] as V2; // left normal = into the interior
  });
  return ring.map((_, i) => {
    const a = segN[(i + ring.length - 1) % ring.length], b = segN[i];
    const smooth = a[0] * b[0] + a[1] * b[1] > Math.cos((50 * Math.PI) / 180);
    const avg = norm([a[0] + b[0], a[1] + b[1], 0]);
    return { start: smooth ? avg : ([b[0], b[1], 0] as V3), end: smooth ? avg : ([a[0], a[1], 0] as V3) };
  });
}

/** A wall around `ring` from zTop down to zBot, normals into the interior, with bevelled-looking lips. */
function wall(m: Mesher, ring: V2[], zTop: number, zBot: number, side: 1 | -1, s: Surf, opts: { lipTop?: number; lipBot?: number; skip?: (a: V2, b: V2) => boolean }) {
  const N = wallNormals(ring);
  const lip = Math.min(0.12, Math.abs(zTop - zBot) / 3);
  const rowsZ = [zTop, zTop - lip, zBot + (opts.lipBot ? lip : 0), zBot];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (opts.skip?.(a, b)) continue;
    const na = N[i].start, nb = N[(i + 1) % ring.length].end;
    const rowN = (n: V3, r: number): V3 => {
      if (r === 0 && opts.lipTop) return norm([n[0], n[1], opts.lipTop]);
      if (r === 3 && opts.lipBot) return norm([n[0], n[1], -opts.lipBot]);
      return n;
    };
    for (let r = 0; r < 3; r++) {
      const v = (p: V2, n: V3, row: number): Vtx => ({ p: [p[0], p[1], rowsZ[row]], n: rowN(n, row), side, s });
      m.quad(v(a, na, r), v(b, nb, r), v(b, nb, r + 1), v(a, na, r + 1));
    }
  }
}

export function buildShell(input: ShellInput) {
  const m = new Mesher(input.decal);
  const { edge: E, z: Z, seam } = input;
  const rim: Sample[] = input.outline.map((s) => ({ p: [s.p[0] - s.n[0] * E, s.p[1] - s.n[1] * E], n: s.n }));
  const rimRing = rim.map((s) => s.p);
  const holes = input.holes.map((h) => ccw(h));
  const clip = (ts: Terrace[]): Clipped[] => ts.map((t) => ({ ...t, polys: pc.intersection([t.ring], [rimRing]) }));
  const faces = { 1: clip(input.side1), [-1]: clip(input.side0) } as Record<1 | -1, Clipped[]>;

  // ---- insert the points where terraces meet the rim, so the edge profile can step there
  const insertions = new Map<number, { t: number; p: V2 }[]>();
  for (const side of [1, -1] as const) for (const t of faces[side]) for (const poly of t.polys) for (const ring of poly) for (const v of ring) {
    const p: V2 = [v[0], v[1]];
    for (let i = 0; i < rim.length; i++) {
      const hit = segmentDistance(p, rim[i].p, rim[(i + 1) % rim.length].p);
      if (hit.d < 1e-7 && hit.t > 1e-9 && hit.t < 1 - 1e-9) {
        const list = insertions.get(i) ?? [];
        if (!list.some((q) => Math.abs(q.t - hit.t) < 1e-9)) list.push({ t: hit.t, p });
        insertions.set(i, list);
        break;
      }
    }
  }
  const rimX: Sample[] = [];
  rim.forEach((s, i) => {
    rimX.push(s);
    const next = rim[(i + 1) % rim.length];
    for (const { t, p } of (insertions.get(i) ?? []).sort((a, b) => a.t - b.t)) {
      const n = norm([s.n[0] * (1 - t) + next.n[0] * t, s.n[1] * (1 - t) + next.n[1] * t, 0]);
      rimX.push({ p, n: [n[0], n[1]] });
    }
  });

  const terraceAt = (side: 1 | -1, p: V2) =>
    faces[side].find((t) => t.polys.some((poly) => inside(p, poly[0] as V2[]) && !poly.slice(1).some((h) => inside(p, h as V2[]))));
  const depthAt = (side: 1 | -1, p: V2) => terraceAt(side, p)?.depth ?? 0;

  // ---- edge sweep
  type Row = { s: number; z: number; nn: number; nz: number; seam?: boolean };
  const profile = (dTop: number, dBot: number): Row[] => {
    const zt = Z - dTop, zb = -Z + dBot, rows: Row[] = [], K = input.edgeSegments ?? 5;
    for (let k = 0; k <= K; k++) { const a = (Math.PI / 2) * (1 - k / K); rows.push({ s: E * Math.cos(a), z: zt - E + E * Math.sin(a), nn: Math.cos(a), nz: Math.sin(a) }); }
    if (seam > zb + E + 0.15 && seam < zt - E - 0.15) {
      const g = 0.06, d = 0.05, tilt = 0.6, c = 0.8;
      rows.push({ s: E, z: seam + g, nn: 1, nz: 0 });
      rows.push({ s: E, z: seam + g, nn: c, nz: -tilt, seam: true }, { s: E - d, z: seam, nn: c, nz: -tilt, seam: true });
      rows.push({ s: E - d, z: seam, nn: c, nz: tilt, seam: true }, { s: E, z: seam - g, nn: c, nz: tilt, seam: true });
      rows.push({ s: E, z: seam - g, nn: 1, nz: 0 });
    }
    for (let k = 0; k <= K; k++) { const a = (-Math.PI / 2) * (k / K); rows.push({ s: E * Math.cos(a), z: zb + E + E * Math.sin(a), nn: Math.cos(a), nz: Math.sin(a) }); }
    return rows;
  };
  const vtx = (q: Sample, r: Row): Vtx => ({
    p: [q.p[0] + q.n[0] * r.s, q.p[1] + q.n[1] * r.s, r.z],
    n: norm([q.n[0] * r.nn, q.n[1] * r.nn, r.nz]),
    side: r.z >= 0 ? 1 : -1,
    s: r.seam ? input.surf.seam : input.surf.edge,
  });
  const segDepth = rimX.map((a, i) => {
    const b = rimX[(i + 1) % rimX.length];
    const nx = (a.n[0] + b.n[0]) / 2, ny = (a.n[1] + b.n[1]) / 2;
    const mid: V2 = [(a.p[0] + b.p[0]) / 2 - nx * 0.01, (a.p[1] + b.p[1]) / 2 - ny * 0.01];
    return [depthAt(1, mid), depthAt(-1, mid)] as const;
  });
  rimX.forEach((a, i) => {
    const b = rimX[(i + 1) % rimX.length];
    const [dT, dB] = segDepth[i];
    const rows = profile(dT, dB);
    for (let k = 0; k < rows.length - 1; k++) m.quad(vtx(a, rows[k]), vtx(b, rows[k]), vtx(b, rows[k + 1]), vtx(a, rows[k + 1]));
    // step where the terrace changes: fill the end face between the two profiles
    const [nT, nB] = segDepth[(i + 1) % rimX.length];
    if (nT !== dT || nB !== dB) endCap(b, profile(dT, dB), profile(nT, nB));
  });
  function endCap(q: Sample, before: Row[], after: Row[]) {
    const section = (rows: Row[]): [number, number][] => [[-0.02, rows[0].z], ...rows.map((r) => [r.s, r.z] as [number, number]), [-0.02, rows[rows.length - 1].z]];
    const A = section(before), B = section(after);
    const band: [number, number][] = [[0, -10], [E + 1, -10], [E + 1, 10], [0, 10]];
    const tangent: V3 = [-q.n[1], q.n[0], 0]; // direction of travel along the CCW rim
    for (const poly of pc.intersection(pc.xor([A], [B]), [band])) {
      const rings = poly.map((r) => openRing(r as V2[]));
      if (rings[0].length < 3) continue;
      const c = rings[0].reduce((s, p) => [s[0] + p[0] / rings[0].length, s[1] + p[1] / rings[0].length], [0, 0]) as V2;
      // material present before the step and missing after → the face looks forward along the rim
      const want: V3 = inside(c, A as V2[]) ? tangent : [-tangent[0], -tangent[1], 0];
      const contour = rings[0].map(([s, z]) => new THREE.Vector2(s, z));
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
        const v = (w: THREE.Vector2): Vtx => ({ p: [q.p[0] + q.n[0] * w.x, q.p[1] + q.n[1] * w.x, w.y], n: want, side: w.y >= 0 ? 1 : -1, s: input.surf.edge });
        m.tri(v(contour[i]), v(contour[j]), v(contour[k]), want);
      }
    }
  }

  // ---- faces: base level, terrace floors, terrace walls
  const holeGeom = holes.map((h) => [h]);
  for (const side of [1, -1] as const) {
    const zf = side * Z;
    const terraces = faces[side];
    cap(m, pc.difference([rimRing], ...terraces.map((t) => t.polys), ...holeGeom), zf, side, input.surf.face);
    for (const t of terraces) {
      const zFloor = zf - side * t.depth;
      cap(m, holeGeom.length ? pc.difference(t.polys, ...holeGeom) : t.polys, zFloor, side, t.floor);
      for (const poly of t.polys) poly.forEach((r, ri) => {
        const ring = ri === 0 ? ccw(openRing(r as V2[])) : cw(openRing(r as V2[]));
        // walls only where the terrace boundary is inside the case (the rim sweep handles the outer edge)
        const onRim = (a: V2, b: V2) => ringDistance([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], rimRing) < 1e-6;
        const [top, bot] = side > 0 ? [zf, zFloor] : [zFloor, zf];
        wall(m, ring, top, bot, side, t.wall, { lipTop: side > 0 ? 0.9 : 0, lipBot: side < 0 ? 0.9 : 0, skip: onRim });
      });
    }
  }

  // ---- through-holes
  for (const h of holes) {
    const c = h.reduce((s, p) => [s[0] + p[0] / h.length, s[1] + p[1] / h.length], [0, 0]) as V2;
    const zTop = Z - depthAt(1, c), zBot = -Z + depthAt(-1, c);
    wall(m, h, zTop, zBot, 1, input.surf.hole, { lipTop: 0.9, lipBot: 0.9 });
  }

  return m.geometry();
}
