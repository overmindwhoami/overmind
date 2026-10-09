/** A sealed disk's fingerprint: SHA-256 over the canonical JSON of its 90 slots (what anyone can recompute from the API). */
import { createHash } from 'node:crypto';
import type { SlotRow } from './db.js';

const canonical = (v: unknown): string =>
  v === null || typeof v !== 'object' ? JSON.stringify(v ?? null)
    : Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
      : `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;

/** The fields that make up a slot's record (media copies are excluded: they are a cache, not the record). */
export const slotRecord = (s: SlotRow) => ({
  k: s.k, time: new Date(s.time).toISOString(), note: s.note, file: s.file, model: s.model,
  dice: { source: s.dice.source, round: s.dice.round, value: s.dice.value },
  item: s.item && { id: s.item.id, source: s.item.source, kind: s.item.kind, title: s.item.title, year: s.item.year, creator: s.item.creator, url: s.item.url },
  qday: s.qday_shift ?? undefined, // only on saves that moved the clock (older records hash exactly as before)
});

/** The exact text that is hashed: anyone can fetch it (GET /api/disks/:n/record), SHA-256 it and compare with the chain. */
export const recordText = (slots: SlotRow[]) => canonical(slots.map(slotRecord));
export const fingerprint = (slots: SlotRow[]) => createHash('sha256').update(recordText(slots)).digest('hex');
