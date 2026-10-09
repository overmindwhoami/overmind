/** Archive model: one real item saved per slot, 90 slots per disk, sealed disks form the lineage. */
export interface Item {
  id: string;
  source: 'archive' | 'arxiv' | 'wayback';
  kind: string;
  title: string;
  year: number | null;
  creator: string | null;
  excerpt: string;
  url: string;
  /** Cached 16:9 still for the instrument (served from our origin; scripts/fetch-media.py). */
  media?: string;
  /** Cached muted loop (films, software captures), played while its target is locked. */
  clip?: string;
  /** Small Archive tile, used when there is no still. */
  thumb?: string;
}

export interface Slot {
  disk: number;
  index: number; // 0…89
  time: number; // ms since epoch (simulated clock)
  item?: Item; // undefined: nothing came through (an honest gap)
  note: string;
  file: string; // DOS-style name for the directory listing
}

export interface Disk {
  n: number; // 0 = genesis
  startedAt: number;
  sealedAt: number;
  sealed: boolean;
  written: number; // slots written so far (90 when sealed)
  seed: number;
  fingerprint: string; // 64 hex characters (simulated SHA-256 in phase 1)
  fascination: string;
  /** Live archive only: the seal's on-chain record (a transaction link), or pending until it confirms. */
  chain?: { url?: string; pending?: boolean };
  /** How this disk looks on the tower (shell, label template, hub angle). */
  look: { shell: number; tint: number; label: number; hub: number };
}

export const SLOTS = 90;
export const SLOT_BYTES = 16_384;

/**
 * Where the site reads the lineage from: the phase 1 simulator (sim.ts) or the live Overmind service (remote.ts).
 * Everything is synchronous for the frame loop; a remote archive answers from its cache and fills in as data arrives.
 */
export interface Archive {
  /** Wall clock in ms (the simulator's clock, or the server's). */
  now(): number;
  /** The disk being written, its written slots, and ms until the next save. */
  current(): { disk: number; written: number; msToNext: number };
  sealedCount(): number;
  disk(n: number): Disk;
  slot(n: number, k: number): Slot;
  written(n: number): Slot[];
  /** Resolves when the archive can answer for the top of the lineage. */
  load(): Promise<void>;
}
