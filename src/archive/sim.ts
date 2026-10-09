/**
 * The simulated Overmind (phase 1). A deterministic clock writes one real item per minute onto the current disk and
 * seals it every 90 minutes, so every visitor sees the same disk and the same slot at the same moment.
 * Items come from a pool of real Internet Archive and arXiv records (scripts/fetch-archive.mjs). Phase 2 replaces
 * this with the live service; the interface (Archive) stays.
 *
 * ?speed=N runs the clock N× faster from page load (for reviews); ?epoch=ISO moves the start of the lineage.
 */
import spec from '../engine/tower-spec.json';
import { fascinationOf, noteFor } from './voice';
import { SLOTS, type Disk, type Item, type Slot } from './types';

const MINUTE = 60_000;
const params = new URLSearchParams(window.location.search);
export const SIM = {
  epoch: Date.parse(params.get('epoch') ?? '2026-10-07T06:00:00Z'),
  speed: Math.max(1, Number(params.get('speed') ?? 1)),
  maxDisks: 1440, // the precomputed layout holds 90 days at 16 disks a day
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash32 = (n: number) => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };

let ITEMS: Item[] = [];
/** Loads the phase 1 item pool (a separate chunk, so the page script stays small). */
export async function loadPool() {
  if (ITEMS.length) return;
  const pool = (await import('../data/archive-pool.json')).default as Item[];
  ITEMS = pool.filter((p) => p.title);
}
const fileName = (item: Item | undefined, k: number) => {
  if (!item) return '-- nothing came through --';
  const base = item.title.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 22) || `ITEM_${k}`;
  return `${base}${item.year ? '_' + item.year : ''}.TXT`.slice(0, 30);
};

export class Archive {
  private loadReal = Date.now();
  private loadSim = Date.now();
  private disks = new Map<number, Disk>();
  private slots = new Map<number, Slot>();
  private perms = new Map<number, number[]>();

  /** Simulated wall clock (ms). */
  now() { return this.loadSim + (Date.now() - this.loadReal) * SIM.speed; }
  private minute() { return Math.max(0, Math.floor((this.now() - SIM.epoch) / MINUTE)); }

  /** The disk being written and how many of its slots are done. */
  current() {
    const m = Math.min(this.minute(), SIM.maxDisks * SLOTS - 1);
    const disk = Math.floor(m / SLOTS), written = m % SLOTS;
    const next = SIM.epoch + (m + 1) * MINUTE;
    return { disk, written, msToNext: Math.max(0, (next - this.now()) / SIM.speed) };
  }
  sealedCount() { return this.current().disk; }

  disk(n: number): Disk {
    const cur = this.current();
    const cached = this.disks.get(n);
    if (cached && (cached.sealed || n !== cur.disk)) return cached;
    const r = rng(hash32(n * 7919 + 17));
    const seed = Math.floor(r() * 2 ** 31);
    let u = r(), shell = 0;
    while (shell < spec.shells.length - 1 && u >= spec.shells[shell].share) u -= spec.shells[shell++].share;
    const [t0, t1] = spec.shells[shell].tint;
    // drift: label templates move slowly down the lineage, with the odd outlier
    const label = r() < spec.labels.blank ? -1 : (Math.floor(n / 9) + (r() < 0.25 ? Math.floor(r() * 5) : 0)) % spec.labels.templates;
    const sealed = n < cur.disk;
    const fp = Array.from({ length: 8 }, (_, i) => hash32(seed + i * 101 + n).toString(16).padStart(8, '0')).join('');
    const d: Disk = {
      n, seed, startedAt: SIM.epoch + n * SLOTS * MINUTE, sealedAt: SIM.epoch + (n + 1) * SLOTS * MINUTE,
      sealed, written: sealed ? SLOTS : n === cur.disk ? cur.written : 0, fingerprint: fp, fascination: fascinationOf(seed),
      look: { shell, tint: t0 + (t1 - t0) * r(), label, hub: r() * Math.PI * 2 },
    };
    this.disks.set(n, d);
    return d;
  }

  private itemAt(g: number) {
    const L = ITEMS.length, cycle = Math.floor(g / L);
    let perm = this.perms.get(cycle);
    if (!perm) {
      const r = rng(hash32(cycle + 4242));
      perm = ITEMS.map((_, i) => i);
      for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      this.perms.set(cycle, perm);
    }
    return ITEMS[perm[g % L]];
  }

  /** Slot k of disk n (only meaningful once written). */
  slot(n: number, k: number): Slot {
    const g = n * SLOTS + k;
    const hit = this.slots.get(g);
    if (hit) return hit;
    const d = this.disk(n);
    const r = rng(hash32(g * 31 + 7));
    const failed = hash32(g + 99) % 37 === 0;
    const item = failed ? undefined : this.itemAt(g);
    const s: Slot = {
      disk: n, index: k, time: SIM.epoch + (g + 1) * MINUTE, item,
      note: noteFor(item, r, { minute: k + 1, fascination: d.fascination, nextFascination: fascinationOf(d.seed + 1) }),
      file: fileName(item, k),
    };
    this.slots.set(g, s);
    return s;
  }

  /** All written slots of disk n, oldest first. */
  written(n: number) { const d = this.disk(n); return Array.from({ length: d.written }, (_, k) => this.slot(n, k)); }
}

export const fmtDisk = (n: number) => `DISK ${String(n + 1).padStart(4, '0')}`;
export const fmtTime = (ms: number) => new Date(ms).toISOString().slice(11, 16);
export const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
