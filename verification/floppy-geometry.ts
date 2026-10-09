import * as THREE from 'three';
import { shellGeometry, shutterGeometry, hubGeometry, mediaGeometry, linerGeometry, sliderGeometry, labelGeometry } from '../src/engine/floppy/parts';
const t0 = performance.now();
const shell = shellGeometry();
const t1 = performance.now();
const parts = { shell, shutter: shutterGeometry(), hub: hubGeometry(), media: mediaGeometry(), liner: linerGeometry(), slider: sliderGeometry(), label: labelGeometry().geometry };
for (const [k, g] of Object.entries(parts)) {
  g.computeBoundingBox();
  const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  const b = g.boundingBox!;
  console.log(k.padEnd(8), String(tris).padStart(6), 'tris', b.min.toArray().map(v=>v.toFixed(2)).join(','), '→', b.max.toArray().map(v=>v.toFixed(2)).join(','));
}
console.log('shell build ms', (t1 - t0).toFixed(1));
// normal consistency: geometric face normal vs stored vertex normals
const p = shell.getAttribute('position'), n = shell.getAttribute('normal');
let bad = 0, nan = 0;
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3();
for (let i = 0; i < p.count; i += 3) {
  a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
  fn.subVectors(b, a).cross(c.clone().sub(a)).normalize();
  vn.set(0, 0, 0); for (let k = 0; k < 3; k++) vn.add(new THREE.Vector3().fromBufferAttribute(n, i + k));
  if (!Number.isFinite(vn.x + fn.x)) nan++;
  else if (fn.dot(vn.normalize()) < 0.0) bad++;
}
console.log('triangles facing against their normals:', bad, 'nan:', nan);
// watertightness: count boundary edges (edges used once)
const key = (v: THREE.Vector3) => v.toArray().map((x) => x.toFixed(4)).join(',');
const edges = new Map<string, number>();
for (let i = 0; i < p.count; i += 3) {
  const vs = [0, 1, 2].map((k) => key(new THREE.Vector3().fromBufferAttribute(p, i + k)));
  for (let k = 0; k < 3; k++) { const e = [vs[k], vs[(k + 1) % 3]].sort().join('|'); edges.set(e, (edges.get(e) ?? 0) + 1); }
}
const open = [...edges.entries()].filter(([, c]) => c === 1);
console.log('edges', edges.size, 'open (used once):', open.length);
const sample = open.slice(0, 12).map(([e]) => e);
console.log(sample.join('\n'));
