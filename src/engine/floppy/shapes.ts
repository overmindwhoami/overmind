/** 2D polygon helpers for the procedural floppy (millimetres, CCW rings, no closing duplicate). */
import type { Corner } from './spec';

export type V2 = [number, number];
export interface Sample { p: V2; n: V2 } // n: outward unit normal

const ARC_STEP = Math.PI / 14;

/** Rounds every corner by its radius (0 keeps it sharp). Returns points with outward normals for a CCW ring. */
export function filletSamples(corners: readonly Corner[], arcStep = ARC_STEP): Sample[] {
  const out: Sample[] = [];
  const N = corners.length;
  for (let i = 0; i < N; i++) {
    const [px, py] = corners[(i + N - 1) % N], [x, y, r] = corners[i], [qx, qy] = corners[(i + 1) % N];
    let ax = x - px, ay = y - py; const la = Math.hypot(ax, ay); ax /= la; ay /= la;
    let bx = qx - x, by = qy - y; const lb = Math.hypot(bx, by); bx /= lb; by /= lb;
    const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by); // + = left turn = convex on a CCW ring
    if (r <= 0 || Math.abs(turn) < 1e-6) {
      out.push({ p: [x, y], n: [ay, -ax] }, { p: [x, y], n: [by, -bx] });
      continue;
    }
    const t = r * Math.tan(Math.abs(turn) / 2);
    const sx = x - ax * t, sy = y - ay * t, side = Math.sign(turn);
    const cx = sx - ay * r * side, cy = sy + ax * r * side;
    const a0 = Math.atan2(sy - cy, sx - cx);
    const segs = Math.max(2, Math.ceil(Math.abs(turn) / arcStep));
    for (let k = 0; k <= segs; k++) {
      const a = a0 + turn * (k / segs), c = Math.cos(a), s = Math.sin(a);
      out.push({ p: [cx + c * r, cy + s * r], n: side > 0 ? [c, s] : [-c, -s] });
    }
  }
  // drop zero-length steps between consecutive samples that share position and normal
  return out.filter((s, i) => {
    const o = out[(i + out.length - 1) % out.length];
    return Math.hypot(s.p[0] - o.p[0], s.p[1] - o.p[1]) > 1e-9 || s.n[0] !== o.n[0] || s.n[1] !== o.n[1];
  });
}

export const filletRing = (corners: readonly Corner[]): V2[] => dedupe(filletSamples(corners).map((s) => s.p));

export function circleRing(cx: number, cy: number, r: number, segments = 64): V2[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as V2;
  });
}

export function dedupe(ring: V2[], eps = 1e-9): V2[] {
  const out: V2[] = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
  return out;
}

export function signedArea(ring: V2[]) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}
export const ccw = (ring: V2[]) => (signedArea(ring) < 0 ? [...ring].reverse() : ring);
export const cw = (ring: V2[]) => (signedArea(ring) > 0 ? [...ring].reverse() : ring);

export function inside(p: V2, ring: V2[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Distance from p to the segment ab, and the parameter of the closest point. */
export function segmentDistance(p: V2, a: V2, b: V2) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return { d: Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t), t };
}

export function ringDistance(p: V2, ring: V2[]) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) best = Math.min(best, segmentDistance(p, ring[i], ring[(i + 1) % ring.length]).d);
  return best;
}

/** polygon-clipping returns closed rings; strip the duplicate and drop slivers. */
export function openRing(ring: V2[]): V2[] {
  return dedupe(ring.map((p) => [p[0], p[1]] as V2));
}
