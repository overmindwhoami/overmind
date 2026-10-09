/**
 * The lineage tower: every sealed disk at its precomputed pose (scripts/build-layout.mjs), genesis at the bottom,
 * and the live disk hovering above the top with its shutter open while the Overmind writes to it. When a disk seals
 * it drops into its place and a fresh disk arrives above it. A disk can be lifted out (to be read in the machine).
 */
import * as THREE from 'three';
import spec from './tower-spec.json';
import layout from '../data/layout.json';
import { GLASS, LIGHTS } from '../../design-system/scene';
import { createKit, DiskSet, type FloppyKit, type FloppyRecord } from './floppy/kit';
import type { GlassUniforms } from './floppy/materials';
import type { Archive } from '../archive/sim';

export interface Slab {
  index: number; // disk number (0 = genesis)
  y: number;
  matrix: THREE.Matrix4;
  box: { center: THREE.Vector3; axes: THREE.Vector3[]; half: number[] };
}
export interface Instance { slab: Slab; offset: number } // offset kept for the tracker's API (always 0: the tower no longer loops)

export const HALF = layout.half;
export const STRAINS = spec.shells.map((s) => s.name);
export const fmtBlock = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');
export const shortHash = (h: string) => `0x${h.slice(0, 6)}…${h.slice(-4)}`;

const HOVER = 0.3; // the live disk floats this far above where it will land (world units)
const SETTLE = 1.4; // seconds for a sealed disk to drop into place
const ARRIVE = 1.1; // seconds for a fresh disk to descend into the hover pose
const WRITE = 0.8; // seconds of the small dip the live disk makes as each slot is written
const CORE_CLEAR = 0.5; // core lights keep at least this far (vertically) from the live disk
/** The live disk's resting pose above the stack (world space): forward offset, tilt toward the viewer, turn. */
export const LIVE_POSE = { z: 0.04, pitch: -0.45, yaw: 0, sheen: 0.4 };
const _ray = new THREE.Vector3();
type Entry = { rec: FloppyRecord; matrix: THREE.Matrix4; cell: number };

function slabFrom(index: number, d: number[]): Slab {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(d[0], d[1], d[2]), new THREE.Quaternion(d[3], d[4], d[5], d[6]), new THREE.Vector3(1, 1, 1));
  const axes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  m.extractBasis(axes[0], axes[1], axes[2]);
  return { index, y: d[1], matrix: m, box: { center: new THREE.Vector3(d[0], d[1], d[2]), axes, half: HALF } };
}
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const smooth = (t: number) => t * t * (3 - 2 * t);
function lerpMatrix(a: THREE.Matrix4, b: THREE.Matrix4, t: number, out = new THREE.Matrix4()) {
  const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
  a.decompose(pa, qa, sa); b.decompose(pb, qb, sb);
  return out.compose(pa.lerp(pb, t), qa.slerp(qb, t), new THREE.Vector3(1, 1, 1));
}

export class Tower {
  group = new THREE.Group();
  readonly slabs: Slab[];
  readonly kit: FloppyKit;
  coreLights: THREE.PointLight[] = [];
  instances: Instance[] = [];
  textures: THREE.Texture[] = [];
  glassUniforms: GlassUniforms = {
    uEdgeColor: { value: new THREE.Color('#ffffff') },
    uEdgeGlow: { value: GLASS.edgeGlow },
    uGlassOpacity: { value: GLASS.opacity },
  };
  glassMaterial: THREE.MeshStandardMaterial;
  /** The live disk; its slab's matrix and box follow the hover animation. */
  readonly live: Slab;
  /** Disk lifted out of the stack to be read (drawn by `update` from the pose it is given). */
  lifted?: number;
  private stack: DiskSet;
  private loose: DiskSet;
  private sealed: number;
  private settling?: { n: number; from: THREE.Matrix4; t: number };
  private arriveT = 1;
  private visibleKey = '';
  private turn = 0;
  private liveProgress = -1;
  private writeT = 1;
  private tmp = new THREE.Matrix4();

  constructor(private archive: Archive, renderer: THREE.WebGLRenderer, lite = false) {
    this.slabs = layout.disks.map((d, i) => slabFrom(i, d));
    this.kit = createKit(this.glassUniforms, { lite, renderer });
    this.textures.push(...this.kit.textureList);
    this.glassMaterial = this.kit.materials.glass;
    this.stack = new DiskSet(this.kit, 160, this.group);
    this.loose = new DiskSet(this.kit, 3, this.group);
    this.sealed = archive.sealedCount();
    this.live = slabFrom(this.sealed, layout.disks[Math.min(this.sealed, layout.disks.length - 1)]);
    for (let i = 0; i < LIGHTS.core.count; i++) {
      const l = new THREE.PointLight(LIGHTS.core.color, LIGHTS.core.intensity, LIGHTS.core.distance, LIGHTS.core.decay);
      const a = i * LIGHTS.core.angleStep;
      l.position.set(Math.cos(a) * LIGHTS.core.radius, 0, Math.sin(a) * LIGHTS.core.radius);
      this.coreLights.push(l);
      this.group.add(l);
    }
  }

  /** Re-reads the lineage from the archive without animating (after a remote archive has loaded, or resynced). */
  resync() {
    this.sealed = Math.min(this.archive.sealedCount(), this.slabs.length - 1);
    this.settling = undefined;
    this.arriveT = 1;
    this.liveProgress = -1;
    this.writeT = 1;
    this.visibleKey = '';
  }

  /** Lowest and highest camera heights worth visiting: genesis up to the live disk. */
  get range() { return { min: this.slabs[0].y, max: this.landing(this.sealed).y + HOVER + 0.08 }; }
  get count() { return this.sealed; }
  private landing(n: number) { return this.slabs[Math.min(n, this.slabs.length - 1)]; }

  /** What the tower draws for disk n. Sealed disks: shutter closed, write-protect open. The live disk: shutter open. */
  record(n: number, opts: { live?: boolean; open?: number } = {}): FloppyRecord {
    const d = this.archive.disk(n);
    const live = opts.live ?? !d.sealed;
    return {
      index: n, gen: n + 1, parent: n > 0 ? n : null, hash: d.fingerprint, block: d.written, born: new Date(d.sealedAt).toISOString().slice(0, 10),
      label: d.look.label, seed: d.seed, alive: live, progress: live ? d.written : undefined,
      shell: d.look.shell, tint: d.look.tint, open: opts.open ?? (live ? 1 : 0), protect: !live, hub: d.look.hub,
      // the live disk faces the viewer (and the key light): its metal is dimmed so it never flares over the label
      sheen: live ? LIVE_POSE.sheen : undefined,
    };
  }
  private cellFor(n: number, rec: FloppyRecord, repaint = false) { return this.kit.atlas.cell(n, rec, repaint); }

  /** Rewrite the stack's buffers for sealed disks whose height falls in [minY, maxY]. */
  cull(minY: number, maxY: number) {
    const key = `${minY.toFixed(1)}:${maxY.toFixed(1)}:${this.sealed}:${this.lifted ?? -1}:${this.settling?.n ?? -1}`;
    if (key === this.visibleKey) return;
    this.visibleKey = key;
    const entries: Entry[] = [];
    const list: Instance[] = [];
    const max = Math.min(this.kit.atlas.capacity - 4, Math.floor(this.stack.capacity / 1.25));
    // newest first, so the top of the band wins if the band ever holds more disks than the atlas
    for (let i = this.sealed - 1; i >= 0 && entries.length < max; i--) {
      const s = this.slabs[i];
      if (s.y < minY - 0.2) break;
      if (s.y > maxY || i === this.lifted || i === this.settling?.n) continue;
      const rec = this.record(i, { live: false });
      entries.push({ rec, matrix: s.matrix, cell: this.cellFor(i, rec) });
      list.push({ slab: s, offset: 0 });
    }
    this.stack.set(entries);
    this.instances = [...list, { slab: this.live, offset: 0 }];
  }

  /** Per frame: sealing and arrival, the live disk's slow turn and label progress, the lifted disk. */
  update(dt: number, height: number, settings: { roughness: number; edgeGlow: number; glassOpacity: number; coreIntensity: number }, lifted?: { matrix: THREE.Matrix4; open: number }) {
    this.glassMaterial.roughness = settings.roughness;
    this.glassUniforms.uEdgeGlow.value = settings.edgeGlow;
    this.glassUniforms.uGlassOpacity.value = settings.glassOpacity;
    // the core lights glow inside the stack; one passing through the hovering live disk would put a hot spot on its face
    const liveY = this.landing(this.sealed).y + HOVER;
    this.coreLights.forEach((l, i) => {
      const y = height + (i - 1) * LIGHTS.core.verticalSpacing;
      l.intensity = settings.coreIntensity;
      l.position.y = Math.abs(y - liveY) < CORE_CLEAR ? liveY - CORE_CLEAR : y;
    });

    const sealedNow = Math.min(this.archive.sealedCount(), this.slabs.length - 1);
    if (sealedNow > this.sealed) {
      // the live disk seals: it drops into its place, then the next blank disk arrives above it
      this.settling = { n: sealedNow - 1, from: this.live.matrix.clone(), t: 0 };
      this.sealed = sealedNow;
      this.arriveT = -0.6;
      this.liveProgress = -1;
      this.visibleKey = '';
    }
    this.arriveT = Math.min(1, this.arriveT + dt / ARRIVE);
    this.turn += dt;

    const entries: Entry[] = [];
    if (this.settling) {
      const st = this.settling;
      st.t = Math.min(1, st.t + dt / SETTLE);
      const e = smooth(st.t);
      const rec = this.record(st.n, { live: false, open: Math.max(0, 1 - st.t * 2.5) });
      entries.push({ rec, matrix: lerpMatrix(st.from, this.slabs[st.n].matrix, e), cell: this.cellFor(st.n, rec, st.t === dt / SETTLE) });
      if (st.t >= 1) { this.settling = undefined; this.visibleKey = ''; }
    }
    // the live disk: centred above the stack, tilted toward the viewer so its label and open shutter read, almost
    // still (a slow breath, and a small dip each time a slot is written). It is posed in world space (the stack below
    // keeps turning), then taken into the tower's frame.
    const written = this.archive.disk(this.sealed).written;
    const repaint = written !== this.liveProgress;
    if (repaint && this.liveProgress >= 0) this.writeT = 0;
    this.liveProgress = written;
    this.writeT = Math.min(1, this.writeT + dt / WRITE);
    const dip = Math.sin(Math.PI * this.writeT) * (1 - this.writeT) * 0.05;
    const land = this.landing(this.sealed);
    const a = Math.max(0, this.arriveT);
    const world = new THREE.Matrix4().compose(
      new THREE.Vector3(0, land.y + HOVER + (1 - easeOut(a)) * 1.4 + Math.sin(this.turn * 0.7) * 0.006 - dip, LIVE_POSE.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(LIVE_POSE.pitch + Math.sin(this.turn * 0.31) * 0.02, LIVE_POSE.yaw + Math.sin(this.turn * 0.17) * 0.1, 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1));
    this.live.matrix.copy(world).premultiply(this.tmp.copy(this.group.matrixWorld).invert());
    const pos = new THREE.Vector3().setFromMatrixPosition(this.live.matrix);
    this.live.index = this.sealed; this.live.y = land.y + HOVER; this.live.box.center.copy(pos);
    this.live.matrix.extractBasis(this.live.box.axes[0], this.live.box.axes[1], this.live.box.axes[2]);
    const liveRec = this.record(this.sealed, { live: true });
    if (this.arriveT > 0 && this.lifted !== this.sealed) entries.push({ rec: liveRec, matrix: this.live.matrix, cell: this.cellFor(this.sealed, liveRec, repaint) });
    // a disk lifted out to be read
    if (lifted && this.lifted !== undefined) {
      const rec = this.record(this.lifted, { open: lifted.open });
      entries.push({ rec, matrix: lifted.matrix, cell: this.cellFor(this.lifted, rec) });
    }
    this.loose.set(entries);
  }

  /** Nearest disk hit by a ray given in tower-local space. */
  pick(origin: THREE.Vector3, dir: THREE.Vector3): Instance | undefined {
    let best: Instance | undefined, bestT = Infinity;
    for (const inst of this.instances) {
      if (inst.slab.index === this.lifted) continue;
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
  /** Slab for disk n (the live disk's slab when n is the one being written). */
  slab(n: number) { return n === this.sealed ? this.live : this.slabs[n]; }
}
