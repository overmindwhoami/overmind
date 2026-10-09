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
  /** Path of the cached preview image (served from our origin), when there is one. */
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
  /** How this disk looks on the tower (shell, label template, hub angle). */
  look: { shell: number; tint: number; label: number; hub: number };
}

export const SLOTS = 90;
export const SLOT_BYTES = 16_384;
