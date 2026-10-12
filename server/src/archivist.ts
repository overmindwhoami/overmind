/**
 * One round of the Overmind, once a minute: roll the dice, look through the lens they pick, let the mind choose and
 * write, save the slot. The 90th slot seals the disk (fingerprint over its slots) and a fresh disk starts, with a new
 * fascination. Media for the saved item is made afterwards, in the background.
 */
import { EventEmitter } from 'node:events';
import { createDisk, currentDisk, pendingSeals, recentNotes, sealDisk, setSealTx, slots, updateSlotMedia, writeSlot, type DiskRow, type Item, type SlotRow } from './db.js';
import { CLUSTER, explorer, forgetBalance, record, walletInfo } from './chain.js';
import { roll, stream } from './dice.js';
import { candidates, QDAY_LENSES } from './sources.js';
import { context, moveQday } from './watch.js';
import { write } from './mind.js';
import { enqueue } from './media.js';
import { fingerprint } from './seal.js';
import { fascinationOf, fileName } from './voice.js';
import { GENESIS } from './genesis.js';
import { decide, nextNomination } from './nominate.js';
import { tagOf, tell } from './activity.js';
import { templateNote } from './voice.js';

/** A visitor's nomination is weighed at most this often (so the Overmind's own reading stays most of what it keeps). */
const NOMINATION_EVERY = Number(process.env.NOMINATION_EVERY_MS ?? 12 * 60_000);
let nominationAt = 0;

/** The first saves of disk 0001 are the genesis hour (src/genesis.ts); GENESIS=off skips it. */
const GENESIS_ON = process.env.GENESIS !== 'off';
/** The first few disks lean into the lore (sources.ts weights them; the mind is told). */
export const EARLY_DISKS = 4;

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
  // one at a time, a little apart: a backlog sealed in a burst trips the public RPC's rate limit
  for (const d of pending) if (d.fingerprint) { await anchor(d.n, d.fingerprint); await new Promise((r) => setTimeout(r, 1200)); }
}

/** At launch (an empty lineage), disk 0001 exists from the first second: blank, waiting for the first save. */
export async function ensureDisk() {
  if (!(await currentDisk())) await startDisk(0);
}

let running = false;
/** Writes the next slot (and seals and starts disks as needed). Returns the slot written, or undefined if a round is already running. */
export async function round(now = new Date(), at?: number): Promise<SlotRow | undefined> {
  if (running) return undefined;
  running = true;
  try {
    let d = (await currentDisk()) ?? (await startDisk(0));
    if (d.sealed_at) d = await startDisk(d.n + 1);
    if (d.written >= SLOTS) { await seal(d); d = await startDisk(d.n + 1); }
    const k = d.written;
    const dice = await roll();
    const rand = stream(dice.value, k);
    const g = GENESIS_ON && d.n === 0 ? GENESIS[k] : undefined;
    let lens: string, qdayLens: boolean, w: Awaited<ReturnType<typeof write>>;
    let nom: Awaited<ReturnType<typeof nextNomination>>;
    if (g) {
      // the genesis hour: written before launch, saved on the minute like everything else
      lens = 'genesis'; qdayLens = !!g.qday;
      w = { item: g.item, note: g.note, model: 'genesis', qday: g.qday };
    } else if ((nom = Date.now() - nominationAt > NOMINATION_EVERY ? await nextNomination().catch(() => undefined) : undefined)) {
      // a visitor's nomination: with Claude it's weighed against what the Overmind found itself; without, it passed the
      // curated-source rules when it was taken, so it goes on the disk with a note that says who brought it
      nominationAt = Date.now();
      lens = 'visitor'; qdayLens = false;
      if (process.env.ANTHROPIC_API_KEY) {
        const found = await candidates(rand, now, 6, process.env.ONLY_LENS, false).catch(() => ({ lens: 'visitor', items: [] as Item[] }));
        w = await write([nom.item, ...found.items], { disk: d.n, minute: k + 1, fascination: d.fascination, recent: await recentNotes(6), rand, world: context(), qday: false, nominated: 0 });
      } else {
        w = { item: nom.item, note: `a visitor asked me to keep this. ${templateNote(nom.item, rand, k + 1, d.fascination)}`.slice(0, 260), model: 'template' };
      }
    } else {
      const found = await candidates(rand, now, 7, process.env.ONLY_LENS, d.n < EARLY_DISKS);
      lens = found.lens; qdayLens = QDAY_LENSES.has(lens);
      w = await write(found.items, { disk: d.n, minute: k + 1, fascination: d.fascination, recent: await recentNotes(6), rand, world: context(), qday: qdayLens, early: d.n < EARLY_DISKS });
    }
    // the clock only moves on q-day evidence, and only by what the mind decided
    if (at && at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now())); // write on the minute
    const moved = w.qday && qdayLens ? await moveQday(w.qday.days, w.qday.reason) : 0;
    const slot = await writeSlot({ disk: d.n, k, item: w.item, note: w.note, file: fileName(w.item, k), dice, model: w.model, qday_shift: moved || null });
    events.emit('slot', slot);
    if (nom) { // the visitor who asked hears how it went (the room hears when it made it through)
      const kept = w.item?.id === nom.item.id;
      await decide(nom.id, kept ? 'saved' : 'passed', d.n, k);
      tell({ kind: kept ? 'picked' : 'passed', disk: d.n, by: tagOf(nom.visitor) }, 'server');
    }
    console.log(`${d.n}:${k} [${lens}/${dice.source}/${w.model}] ${w.item?.title ?? '(gap)'} — ${w.note}${moved ? ` (q-day ${moved > 0 ? '+' : ''}${moved}d)` : ''}`);
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
