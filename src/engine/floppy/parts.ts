/** Geometry for every floppy part, in millimetres (the kit scales to world units). */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import pc from 'polygon-clipping';
import { CASE, FEATURES, HUB, LABEL, LINER, MEDIA, SHUTTER, SLIDER, Z1, type Corner } from './spec';
import { circleRing, filletRing, filletSamples, openRing, type V2 } from './shapes';
import { buildShell, type Surf, type Terrace } from './shell';

const shapeOf = (outer: V2[], holes: V2[][] = []) => {
  const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
};
const rect = (x0: number, y0: number, x1: number, y1: number, r: number | [number, number, number, number]): Corner[] => {
  const q = typeof r === 'number' ? [r, r, r, r] : r;
  return [[x0, y0, q[0]], [x1, y0, q[1]], [x1, y1, q[2]], [x0, y1, q[3]]];
};

/* ------------------------------------------------------------------ shell */
const SURF = {
  face: [1, 1, 1] as Surf,
  edge: [1, 0.85, 0.35] as Surf,
  seam: [0.45, 1, 0] as Surf,
  hole: [0.55, 1, 0] as Surf,
  shallowFloor: [0.97, 0.78, 0.55] as Surf, // recesses are moulded smoother than the stippled faces
  shallowWall: [0.9, 0.8, 0] as Surf,
  pocketFloor: [0.28, 1.1, 0.2] as Surf,
  pocketWall: [0.42, 1, 0] as Surf,
};

export function shellGeometry(lite = false) {
  const S1 = FEATURES.side1, S0 = FEATURES.side0;
  const shallow = (ring: readonly Corner[], depth: number): Terrace => ({ ring: filletRing(ring), depth, floor: SURF.shallowFloor, wall: SURF.shallowWall });
  const pocket = (ring: V2[], depth: number): Terrace => ({ ring, depth, floor: SURF.pocketFloor, wall: SURF.pocketWall });
  return buildShell({
    outline: filletSamples(CASE.outline, lite ? Math.PI / 9 : undefined),
    edge: CASE.edge,
    z: Z1,
    seam: CASE.seam,
    side1: [shallow(S1.shutterRecess.ring, S1.shutterRecess.depth), shallow(S1.labelRecess.ring, S1.labelRecess.depth)],
    side0: [
      shallow(S0.shutterRecess.ring, S0.shutterRecess.depth),
      shallow(S0.labelStrip.ring, S0.labelStrip.depth),
      pocket(circleRing(...S0.hubAccess.center, S0.hubAccess.r, 96), S0.hubAccess.depth),
      pocket(circleRing(...S0.locateRound.center, S0.locateRound.r, 28), S0.locateRound.depth),
      pocket(filletRing(S0.locateSlot.ring), S0.locateSlot.depth),
      pocket(filletRing(S0.notchLeft.ring), S0.notchLeft.depth),
      pocket(filletRing(S0.notchRight.ring), S0.notchRight.depth),
      pocket(filletRing(S0.protectSlot.ring), S0.protectSlot.depth),
    ],
    holes: Object.values(FEATURES.holes).map((h) => filletRing(h)),
    surf: { face: SURF.face, edge: SURF.edge, seam: SURF.seam, hole: SURF.hole },
    decal: { w: CASE.w, h: CASE.h },
    edgeSegments: lite ? 3 : 5,
  });
}

/* ------------------------------------------------------------------ shutter */
/** Both face plates plus the spine that wraps the top edge, closed position. UVs run along the sliding axis (x). */
export function shutterGeometry() {
  const S = SHUTTER, W = S.window;
  const plateTop = S.top - S.bend;
  const zIn = Z1 - FEATURES.side1.shutterRecess.depth + S.gap; // inner face of the Side 1 plate
  const zOut = zIn + S.sheet;
  const bevel = 0; // a 0.2 mm sheet edge is under a pixel: a bevel only adds specular sparkle
  const plateShape = shapeOf(
    filletRing(rect(S.x0, S.y0, S.x1, plateTop, [S.corner, S.corner, 0, 0])),
    [filletRing(rect(W.cx - W.w / 2, W.y0, W.cx + W.w / 2, W.y1, W.r)).reverse()],
  );
  const plate = (z0: number) => {
    const g = new THREE.ExtrudeGeometry(plateShape, { depth: S.sheet - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
    g.translate(0, 0, z0 + bevel);
    return g;
  };
  // spine: U-section in (y, z), extruded along x
  const outer: V2[] = [], inner: V2[] = [];
  const zc = zOut - S.bend, yc = S.top - S.bend, ri = S.bend - S.sheet;
  for (let k = 0; k <= 8; k++) { const a = (Math.PI / 2) * (1 - k / 8); outer.push([yc + Math.cos(a) * S.bend, zc + Math.sin(a) * S.bend]); inner.push([yc + Math.cos(a) * ri, zc + Math.sin(a) * ri]); }
  for (let k = 0; k <= 8; k++) { const a = (-Math.PI / 2) * (k / 8); outer.push([yc + Math.cos(a) * S.bend, -zc + Math.sin(a) * S.bend]); inner.push([yc + Math.cos(a) * ri, -zc + Math.sin(a) * ri]); }
  // shape coordinates (u, v) = (−z, y) so that rotateY(π/2) maps extrusion depth onto +x
  const section = [...outer, ...inner.reverse()].map(([y, z]) => [-z, y] as V2);
  const spine = new THREE.ExtrudeGeometry(shapeOf(section), { depth: S.x1 - S.x0, bevelEnabled: false, curveSegments: 1 });
  spine.rotateY(Math.PI / 2);
  spine.translate(S.x0, 0, 0);
  const merged = mergeGeometries([plate(zIn), plate(-zOut), spine].map((g) => (g.index ? g.toNonIndexed() : g)));
  // brushing direction = +x for every surface: u = x, v = y + z
  const p = merged.getAttribute('position'), uv = merged.getAttribute('uv'), n = merged.getAttribute('normal');
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getY(i) + p.getZ(i));
  // Explicit tangents along the brushing direction. A uv-derived frame collapses on the bend and the sheet ends,
  // where the anisotropic highlight then spikes into bloom.
  const tangent = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const endFace = Math.abs(n.getX(i)) > 0.7;
    tangent.set(endFace ? [0, 1, 0, 1] : [1, 0, 0, 1], i * 4);
  }
  merged.setAttribute('tangent', new THREE.BufferAttribute(tangent, 4));
  return merged;
}

/* ------------------------------------------------------------------ hub */
export function hubGeometry() {
  const H = HUB, P = H.drivePin, b = 0.2;
  const sq = H.spindle.size / 2;
  const spindle = filletRing(rect(-sq, -sq, sq, sq, H.spindle.r));
  const rot = (p: V2): V2 => [p[0] * Math.cos(P.angle) - p[1] * Math.sin(P.angle), p[0] * Math.sin(P.angle) + p[1] * Math.cos(P.angle)];
  // drive-pin hole: radial extent inner→outer along +y, tangential `along`, one large corner
  const pin = filletRing(rect(P.along[0], P.inner, P.along[1], P.outer, [P.r, P.r, P.rBig, P.r])).map(rot);
  const g = new THREE.ExtrudeGeometry(shapeOf(circleRing(0, 0, H.r - b, 80), [spindle.reverse(), pin.reverse()]), {
    depth: H.thickness - b * 2, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 4,
  });
  g.translate(0, 0, H.face + b);
  return g;
}

/* ------------------------------------------------------------------ media, liners, slider */
export function mediaGeometry() {
  const g = new THREE.RingGeometry(MEDIA.rIn, MEDIA.rOut, 160, 1);
  g.translate(HUB.center[0], HUB.center[1], MEDIA.z);
  // uv in millimetres around the hub centre (for the circular anisotropy map)
  const p = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) - HUB.center[0], p.getY(i) - HUB.center[1]);
  return g;
}

export function linerGeometry() {
  const [cx, cy] = HUB.center;
  const ring = [circleRing(cx, cy, LINER.rOut, 128), circleRing(cx, cy, LINER.rIn, 64).reverse()];
  const cut = filletRing(rect(-LINER.cut.w / 2, LINER.cut.y0, LINER.cut.w / 2, 60, [2, 2, 0, 0]));
  const layers: THREE.BufferGeometry[] = [];
  for (const poly of pc.difference(ring, [cut])) {
    const rings = poly.map((r) => openRing(r as V2[]));
    const shape = shapeOf(rings[0], rings.slice(1));
    for (const side of [1, -1]) layers.push(new THREE.ShapeGeometry(shape, 1).translate(0, 0, side * LINER.z).toNonIndexed()); // drawn double-sided
  }
  const g = mergeGeometries(layers);
  const p = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 32, p.getY(i) / 32); // one felt tile per 32 mm
  return g;
}

export function sliderGeometry() {
  const b = 0.06, depth = SLIDER.z1 - SLIDER.z0;
  const g = new THREE.ExtrudeGeometry(shapeOf(filletRing(rect(-SLIDER.w / 2, -SLIDER.h / 2, SLIDER.w / 2, SLIDER.h / 2, 0.4))), {
    depth: depth - b * 2, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 4,
  });
  g.translate(0, 0, SLIDER.z0 + b);
  return g;
}

/* ------------------------------------------------------------------ label */
/**
 * A strip that runs down the Side 1 recess, bends round the bottom edge and up the Side 0 strip.
 * uv.y = 1 at the top of the front panel, 0 at the top of the back flap (atlas cells are drawn in that order).
 */
export function labelGeometry() {
  const L = LABEL;
  const zf = Z1 - FEATURES.side1.labelRecess.depth + L.paper;
  const yb = L.edge + L.bend, zb = zf - L.bend;
  const path: { y: number; z: number; ny: number; nz: number }[] = [];
  path.push({ y: L.front, z: zf, ny: 0, nz: 1 });
  for (let k = 0; k <= 6; k++) { const a = Math.PI / 2 + (Math.PI / 2) * (k / 6); path.push({ y: yb + Math.cos(a) * L.bend, z: zb + Math.sin(a) * L.bend, ny: Math.cos(a), nz: Math.sin(a) }); }
  for (let k = 0; k <= 6; k++) { const a = Math.PI + (Math.PI / 2) * (k / 6); path.push({ y: yb + Math.cos(a) * L.bend, z: -zb + Math.sin(a) * L.bend, ny: Math.cos(a), nz: Math.sin(a) }); }
  path.push({ y: L.back, z: -zf, ny: 0, nz: -1 });
  const s = [0];
  for (let i = 1; i < path.length; i++) s.push(s[i - 1] + Math.hypot(path[i].y - path[i - 1].y, path[i].z - path[i - 1].z));
  const total = s[s.length - 1];
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  path.forEach((q, i) => {
    for (const x of [-L.w / 2, L.w / 2]) {
      pos.push(x, q.y, q.z); nor.push(0, q.ny, q.nz); uv.push(x / L.w + 0.5, 1 - s[i] / total);
    }
    if (i > 0) { const a = (i - 1) * 2, b = i * 2; idx.push(a, b + 1, a + 1, a, b, b + 1); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return { geometry: g, length: total };
}

/* ------------------------------------------------------------------ translucent shell */
/**
 * Moulded features inside the case that only show through translucent shells: weld bosses, the centre rib on
 * Side 1 and the arcuate ribs that hold the liners. Merged into the glass variant of the shell.
 */
export function glassShellGeometry(shell: THREE.BufferGeometry) {
  const [cx, cy] = HUB.center;
  const solids: THREE.BufferGeometry[] = [];
  const solid = (shape: THREE.Shape, z0: number, z1: number) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: 24 });
    g.translate(0, 0, z0);
    solids.push(g.index ? g.toNonIndexed() : g);
  };
  for (const [x, y] of [[-40.6, 32], [40.6, 32], [-40.6, -30], [40.6, -30], [-25, -43.4], [25, -43.4]]) {
    solid(shapeOf(circleRing(x, y, 2.1, 28), [circleRing(x, y, 0.8, 16).reverse()]), -1.15, 1.15);
  }
  solid(shapeOf(circleRing(cx, cy, 11.3, 96), [circleRing(cx, cy, 10.85, 96).reverse()]), 0.42, 0.95);
  const arc = (r0: number, r1: number, a0: number, a1: number) => {
    const n = 48, outer: V2[] = [], inner: V2[] = [];
    for (let k = 0; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; outer.push([cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]); inner.push([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0]); }
    return shapeOf([...outer, ...inner.reverse()]);
  };
  for (const [a0, a1] of [[1.95, 4.3], [-1.16, 1.2], [4.5, 4.92]]) for (const side of [1, -1]) {
    const z = side > 0 ? [0.38, 1.0] : [-1.0, -0.38];
    solid(arc(42.2, 42.8, a0, a1), z[0], z[1]);
  }
  const internals = mergeGeometries(solids);
  const p = internals.getAttribute('position');
  const uv = new Float32Array(p.count * 2), surf = new Float32Array(p.count * 3).fill(1);
  for (let i = 0; i < p.count; i++) uv.set([(p.getX(i) / CASE.w + 0.5) * 0.5, p.getY(i) / CASE.h + 0.5], i * 2);
  internals.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  internals.setAttribute('aSurf', new THREE.BufferAttribute(surf, 3));
  return mergeGeometries([shell, internals]);
}
