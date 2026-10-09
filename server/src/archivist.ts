/**
 * One round of the Overmind, once a minute: roll the dice, look through the lens they pick, let the mind choose and
 * write, save the slot. The 90th slot seals the disk (fingerprint over its slots) and a fresh disk starts, with a new
 * fascination. Media for the saved item is made afterwards, in the background.
 */
import { EventEmitter } from 'node:events';
import { createDisk, currentDisk, pendingSeals, recentNotes, sealDisk, setSealTx, slots, updateSlotMedia, writeSlot, type DiskRow, type SlotRow } from './db.js';
import { CLUSTER, explorer, forgetBalance, record, walletInfo } from './chain.js';
import { roll, stream } from './dice.js';
import { candidates } from './sources.js';
import { write } from './mind.js';
import { enqueue } from './media.js';
import { fingerprint } from './seal.js';
import { fascinationOf, fileName } from './voice.js';

export const SLOTS = 90;
export const events = new EventEmitter();
events.setMaxListeners(0);

async function startDisk(n: number): Promise<DiskRow> {
  const dice = await roll();
  const seed = parseInt(dice.value.slice(8, 16), 16) >>> 0;
  await createDisk(n, seed, fascinationOf(seed), dice);
  const d = (await currentDisk())!;
  events.emit('disk', d);
  return d;
}

async function seal(d: DiskRow) {
  const fp = fingerprint(await slots(d.n));
  await sealDisk(d.n, fp);
  events.emit('seal', { n: d.n, fingerprint: fp });
  console.log(`disk ${d.n} sealed ${fp.slice(0, 12)}`);
  void anchorPending().catch((e) => console.warn('anchor failed', e)); // on chain in the background: the next disk starts on time either way
}

const anchoring = new Set<number>();
/** Puts a sealed disk's fingerprint on chain; on failure it stays pending for the next retry. */
async function anchor(n: number, fp: string) {
  if (anchoring.has(n)) return;
  anchoring.add(n);
  try {
    const tx = await record(n, fp);
    await setSealTx(n, tx, CLUSTER);
    events.emit('chain', { n, tx, cluster: CLUSTER, url: explorer(tx) });
    console.log(`disk ${n} on chain (${CLUSTER}) ${tx}`);
  } catch (e) {
    console.warn(`disk ${n} not on chain yet:`, String(e).slice(0, 200));
  } finally {
    anchoring.delete(n);
  }
}
/** Retries every sealed disk that isn't on chain yet (run every few minutes). */
export async function anchorPending() {
  const pending = await pendingSeals();
  if (!pending.length) return;
  forgetBalance();
  if ((await walletInfo()).balance === 0) return; // nothing to pay fees with yet: they wait, quietly, until it's funded
  for (const d of pending) if (d.fingerprint) await anchor(d.n, d.fingerprint);
}

let running = false;
/** Writes the next slot (and seals and starts disks as needed). Returns the slot written, or undefined if a round is already running. */
export async function round(now = new Date()): Promise<SlotRow | undefined> {
  if (running) return undefined;
  running = true;
  try {
    let d = (await currentDisk()) ?? (await startDisk(0));
    if (d.sealed_at) d = await startDisk(d.n + 1);
    if (d.written >= SLOTS) { await seal(d); d = await startDisk(d.n + 1); }
    const k = d.written;
    const dice = await roll();
    const rand = stream(dice.value, k);
    const { lens, items } = await candidates(rand, now);
    const w = await write(items, { disk: d.n, minute: k + 1, fascination: d.fascination, recent: await recentNotes(6), rand });
    const slot = await writeSlot({ disk: d.n, k, item: w.item, note: w.note, file: fileName(w.item, k), dice, model: w.model });
    events.emit('slot', slot);
    console.log(`${d.n}:${k} [${lens}/${dice.source}/${w.model}] ${w.item?.title ?? '(gap)'} — ${w.note}`);
    if (w.item) {
      const item = w.item;
      enqueue(item, async (m) => {
        if (!m.media && !m.clip) return;
        await updateSlotMedia(d.n, k, m);
        events.emit('media', { disk: d.n, k, ...m });
      });
    }
    if (k + 1 >= SLOTS) { await seal({ ...d, written: SLOTS }); await startDisk(d.n + 1); }
    return slot;
  } finally {
    running = false;
  }
}
