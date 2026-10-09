/**
 * Geometry and material helpers shared by the Overmind PC and the lookdev concepts (millimetres).
 */
import * as THREE from 'three';
import { filletRing, type V2 } from '../engine/floppy/shapes';
import { lightScale } from '../engine/floppy/materials';

export const rr = (x0: number, y0: number, x1: number, y1: number, r: number) => filletRing([[x0, y0, r], [x1, y0, r], [x1, y1, r], [x0, y1, r]]);
export const shapeOf = (outer: V2[], holes: V2[][] = []) => {
  const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
};
/** Rounded prism, profile w × h in the xy plane (corner r), depth d along z, bevelled edges, centred. */
export function prism(w: number, h: number, d: number, r: number, bevel = 0.8, holes: V2[][] = []) {
  const b = Math.max(0, Math.min(bevel, w / 4, h / 4, d / 2 - 0.05));
  const g = new THREE.ExtrudeGeometry(shapeOf(rr(-w / 2 + b, -h / 2 + b, w / 2 - b, h / 2 - b, Math.max(r - b, 0.05)), holes), {
    depth: Math.max(d - 2 * b, 0.05), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 8,
  });
  g.translate(0, 0, -(d - 2 * b) / 2);
  return g;
}
/** Same, lying flat: w along x, depth along z, height along y. */
export const slab = (w: number, depth: number, h: number, r: number, bevel = 0.8, holes: V2[][] = []) => prism(w, depth, h, r, bevel, holes).rotateX(-Math.PI / 2);
export const cyl = (r: number, h: number, seg = 40) => new THREE.CylinderGeometry(r, r, h, seg);
export const at = <T extends THREE.BufferGeometry>(g: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));

/** Brushing direction for anisotropic steel (a uv-derived frame collapses on curved and end faces). */
export function brushTangents(g: THREE.BufferGeometry, dir = new THREE.Vector3(1, 0, 0)) {
  const n = g.getAttribute('normal'), t = new Float32Array(n.count * 4), v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    nn.fromBufferAttribute(n, i);
    v.copy(dir).addScaledVector(nn, -nn.dot(dir));
    if (v.lengthSq() < 1e-3) v.set(0, 1, 0).addScaledVector(nn, -nn.y);
    if (v.lengthSq() < 1e-3) v.set(0, 0, 1);
    v.normalize();
    t.set([v.x, v.y, v.z, 1], i * 4);
  }
  g.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
  return g;
}

/** Big flat plastic panels catch the key light as one broad white sheet; damp the direct highlight (env reflections stay). */
export const dampDirect = <T extends THREE.MeshStandardMaterial>(m: T, k: number) => lightScale(m, { direct: k });

/** Disk pose inside a horizontal slot: label up, shutter edge leading into the machine (−z). */
export const flatDisk = (x: number, y: number, z: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1));

export interface Machine { group: THREE.Group; disk: (insert: number) => THREE.Matrix4; height: number; screen: THREE.Texture; screenMesh?: THREE.Mesh }

export function badgeTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 112;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, 512, 112);
  g.fillStyle = '#161616'; g.font = '600 52px Inter, "Helvetica Neue", Arial, sans-serif'; g.letterSpacing = '14px'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('OVERMIND', 263, 58);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
