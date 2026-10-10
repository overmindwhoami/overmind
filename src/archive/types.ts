/** Archive model: one real item saved per slot, 90 slots per disk, sealed disks form the lineage. */

/** Where a saved item came from, and how the site names it. */
export type ItemSource = 'archive' | 'wayback' | 'arxiv' | 'eprint' | 'news' | 'bitcoin' | 'solana' | 'noaa' | 'wikipedia' | 'loc' | 'gutenberg' | 'github' | 'web';
export const SOURCE_NAMES: Record<ItemSource, string> = {
  archive: 'Internet Archive', wayback: 'Wayback Machine', arxiv: 'arXiv', eprint: 'IACR ePrint', news: 'Hacker News',
  bitcoin: 'mempool.space', solana: 'Solana Explorer', noaa: 'NOAA Space Weather', wikipedia: 'Wikipedia', loc: 'Library of Congress', gutenberg: 'Project Gutenberg',
  github: 'GitHub', web: 'the web',
};
/** How the site names where an item lives (a page on the open web is named by its site). */
export const sourceName = (item: { source: string; url?: string }) => {
  if (item.source === 'web' && item.url) try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch { /* fall through */ }
  return SOURCE_NAMES[item.source as ItemSource] ?? item.source;
};

/** The live Overmind's Q-Day watch (absent in the simulator). */
export interface Watch {
  qday: { estimate: string; shift: number | null; reason: string | null; at: number } | null;
  bitcoin: { spentHour: number; blocks: number; height: number; at: number } | null;
  solana: { txMinute: number; slot: number; at: number } | null;
  space: { kp: number; storm: string | null; forecast: string | null; at: number } | null;
}
export interface Item {
  id: string;
  source: ItemSource;
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
  chain?: { url?: string; pending?: boolean; tx?: string; cluster?: string };
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
  /** The Q-Day watch, when the archive keeps one (the live service does). */
  watch?(): Watch | undefined;
  /** Re-checks a sealed disk from the outside (the live service only): re-hash its record, compare with the seal. */
  verify?(n: number): Promise<Verification>;
  /** The sealing wallet (the live service only). */
  wallet?(): Promise<{ address: string; balance: number | null } | undefined>;
}

/** What CHECK found: the record re-hashed here, against the fingerprint it was sealed with and the memo on Solana. */
export interface Verification {
  bytes: number;
  records: number;
  hash: string;
  sealed: string;
  match: boolean;
  chain: { state: 'match' | 'mismatch' | 'pending' | 'none' | 'unreachable'; tx?: string; url?: string };
}
