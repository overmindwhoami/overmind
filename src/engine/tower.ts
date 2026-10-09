import * as THREE from 'three';
import spec from './tower-spec.json';
import layout from '../data/layout.json';
import { GLASS, LIGHTS } from '../../design-system/scene';
import { createKit, type FloppyRecord } from './floppy/kit';
import type { GlassUniforms } from './floppy/materials';

export type Replica = (typeof layout.replicas)[number];
export interface Slab {
  index: number;
  y: number;
  matrix: THREE.Matrix4;
  box: { center: THREE.Vector3; axes: THREE.Vector3[]; half: number[] };
  replica: Replica;
}
export interface Instance { slab: Slab; offset: number }

/** Shell kinds, in replica `strain` order. */
export const STRAINS = spec.shells.map((s) => s.name);
export const replicas = layout.replicas;
export const period = layout.period;
export const HALF = layout.half;
export const fmtBlock = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');
export const shortHash = (h: string) => `0x${h.slice(0, 6)}…${h.slice(-4)}`;
export const genLabel = (g: number) => `G·${String(g).padStart(3, '0')}`;
const record = (r: Replica): FloppyRecord => ({ ...r, shell: r.strain });

/* ---------------------------------------------------------------- tower */
interface Part { mesh: THREE.InstancedMesh; matrices: Float32Array; colors?: Float32Array; cells?: Float32Array; offsets: number[] }
const _ray = new THREE.Vector3();

export class Tower {
  group = new THREE.Group();
  slabs: Slab[];
  height = period;
  parts: Part[] = [];
  coreLights: THREE.PointLight[] = [];
  instances: Instance[] = [];
  textures: THREE.Texture[] = [];
  glassUniforms: GlassUniforms = {
    uEdgeColor: { value: new THREE.Color('#ffffff') },
    uEdgeGlow: { value: GLASS.edgeGlow },
    uGlassOpacity: { value: GLASS.opacity },
  };
  glassMaterial: THREE.MeshStandardMaterial;
  /** Paints the label atlas; call after the label fonts have loaded. */
  paintLabels: () => void;
  private visibleKey = '';

  constructor(lite = false) {
    this.slabs = layout.slabs.map((s) => ({
      index: s.index,
      y: s.y,
      matrix: new THREE.Matrix4().fromArray(s.matrix),
      box: { center: new THREE.Vector3().fromArray(s.center), axes: s.axes.map((a) => new THREE.Vector3().fromArray(a)), half: HALF },
      replica: replicas[s.index],
    }));
    this.slabs.sort((a, b) => a.y - b.y);
    const kit = createKit(replicas.map(record), this.glassUniforms, { lite });
    this.textures.push(...kit.textureList);
    this.glassMaterial = kit.materials.glass;
    this.paintLabels = kit.atlas.paint;
    for (const p of kit.parts) this.part(p.geometry, p.material, (rep, add) => p.place(record(rep), add), p.cells);
    for (let i = 0; i < LIGHTS.core.count; i++) {
      const l = new THREE.PointLight(LIGHTS.core.color, LIGHTS.core.intensity, LIGHTS.core.distance, LIGHTS.core.decay);
      const a = i * LIGHTS.core.angleStep;
      l.position.set(Math.cos(a) * LIGHTS.core.radius, 0, Math.sin(a) * LIGHTS.core.radius);
      this.coreLights.push(l);
      this.group.add(l);
    }
  }

  private part(geo: THREE.BufferGeometry, mat: THREE.Material, place: (rep: Replica, add: (m: THREE.Matrix4, c?: THREE.Color) => void) => void, cells = false) {
    const matrices: number[] = [], colors: number[] = [], cellList: number[] = [], offsets: number[] = [];
    let hasColor = true;
    for (const slab of this.slabs) {
      offsets.push(matrices.length / 16);
      place(slab.replica, (m, c) => {
        const w = slab.matrix.clone().multiply(m);
        matrices.push(...w.elements);
        if (c) colors.push(c.r, c.g, c.b); else hasColor = false;
        cellList.push(slab.replica.index);
      });
    }
    offsets.push(matrices.length / 16);
    const count = offsets[offsets.length - 1];
    const g = geo.clone();
    const maxInstances = count * 3; // up to three loop copies visible at once
    const cellAttr = cells ? new THREE.InstancedBufferAttribute(new Float32Array(maxInstances), 1) : undefined;
    if (cellAttr) { cellAttr.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aCell', cellAttr); }
    const mesh = new THREE.InstancedMesh(g, mat, maxInstances);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (hasColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.parts.push({ mesh, matrices: new Float32Array(matrices), colors: hasColor ? new Float32Array(colors) : undefined, cells: cells ? new Float32Array(cellList) : undefined, offsets });
  }

  /** Rewrite instance buffers for the loop copies that intersect [minY, maxY]. */
  cull(minY: number, maxY: number) {
    const ranges: { first: number; last: number; offset: number }[] = [];
    const H = this.height;
    const from = Math.floor((minY + H / 2) / H) - 1, to = Math.floor((maxY + H / 2) / H) + 1;
    for (let k = from; k <= to; k++) {
      const offset = k * H;
      const first = this.slabs.filter((s) => s.y < minY - offset).length;
      const last = this.slabs.filter((s) => s.y <= maxY - offset).length;
      if (last > first) ranges.push({ first, last, offset });
    }
    const key = ranges.map((r) => `${r.first}:${r.last}:${r.offset}`).join(' ');
    if (key === this.visibleKey) return;
    this.visibleKey = key;
    this.instances = ranges.flatMap((r) => this.slabs.slice(r.first, r.last).map((slab) => ({ slab, offset: r.offset })));
    for (const p of this.parts) {
      const dst = p.mesh.instanceMatrix.array as Float32Array;
      const cellAttr = p.mesh.geometry.getAttribute('aCell') as THREE.InstancedBufferAttribute | undefined;
      let n = 0;
      for (const r of ranges) {
        const a = p.offsets[r.first], b = p.offsets[r.last], len = b - a;
        dst.set(p.matrices.subarray(a * 16, b * 16), n * 16);
        for (let i = n; i < n + len; i++) dst[i * 16 + 13] += r.offset;
        if (p.colors && p.mesh.instanceColor) (p.mesh.instanceColor.array as Float32Array).set(p.colors.subarray(a * 3, b * 3), n * 3);
        if (p.cells && cellAttr) (cellAttr.array as Float32Array).set(p.cells.subarray(a, b), n);
        n += len;
      }
      p.mesh.count = n;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      if (cellAttr) cellAttr.needsUpdate = true;
    }
  }

  /** Nearest slab hit by a ray given in tower-local space. */
  pick(origin: THREE.Vector3, dir: THREE.Vector3): Instance | undefined {
    let best: Instance | undefined, bestT = Infinity;
    for (const inst of this.instances) {
      const { center, axes, half } = inst.slab.box;
      _ray.copy(center); _ray.y += inst.offset; _ray.sub(origin);
      let tMin = 0, tMax = Infinity, hit = true;
      for (let i = 0; i < 3; i++) {
        const e = axes[i].dot(_ray), f = axes[i].dot(dir), h = half[i];
        if (Math.abs(f) < 1e-8) { if (Math.abs(e) > h) { hit = false; break; } continue; }
        let t1 = (e - h) / f, t2 = (e + h) / f;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1); tMax = Math.min(tMax, t2);
        if (tMin > tMax) { hit = false; break; }
      }
      if (hit && tMin < bestT) { bestT = tMin; best = inst; }
    }
    return best;
  }

  worldMatrix(inst: Instance, out: THREE.Matrix4) {
    return out.makeTranslation(0, inst.offset, 0).premultiply(this.group.matrixWorld).multiply(inst.slab.matrix);
  }

  update(height: number, settings: { roughness: number; edgeGlow: number; glassOpacity: number; coreIntensity: number }) {
    this.glassMaterial.roughness = settings.roughness;
    this.glassUniforms.uEdgeGlow.value = settings.edgeGlow;
    this.glassUniforms.uGlassOpacity.value = settings.glassOpacity;
    this.coreLights.forEach((l, i) => { l.intensity = settings.coreIntensity; l.position.y = height + (i - 1) * LIGHTS.core.verticalSpacing; });
  }
}
