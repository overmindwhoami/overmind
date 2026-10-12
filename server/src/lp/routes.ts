/**
 * The launchpad's API, under /api/lp/. Reads are open; launching only while LP_LIVE is on. A launcher is their
 * wallet: there are no accounts, and nothing is ever sent without that wallet's signature on it.
 *   GET  status                         open or not, the treasury, the split
 *   POST media                          raw image bytes (PNG/JPEG/WebP/GIF, 1 MB) → { id, url }
 *   GET  media/:id                      the image
 *   GET  meta/:mint.json                token metadata (pump.fun and wallets read it)
 *   GET  coins                          live coins in launch order (the explorer wall)
 *   GET  coins/:mint                    one coin, with its snapshots
 *   GET  coins/:mint/snapshots/:n/record   the exact text a snapshot's fingerprint is the SHA-256 of
 *   POST launch {wallet, name, ticker, description?, image?, links?: {website, twitter}}   → { mint, txs } to sign
 *   POST launch/submit {mint, signed[2]}   co-sign, send, confirm (or { pending, sig } to keep checking)
 *   POST launch/confirm {mint, sig}
 *   POST buy {wallet, mint, sol}  → { txs };  POST buy/submit {signed[1]}
 */
import type { IncomingMessage } from 'node:http';
import { VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { pool } from '../db.js';
import { tagOf, tell } from '../activity.js';
import { buildBuy, buildLaunch, checkFollowUp, confirmLaunch, countersign, LaunchError, runLaunch, submitBuy } from './launch.js';
import { coin, coinJson, image, launchNote, liveCoins, metadata, saveImage, setNote } from './coins.js';
import { snapshot, snapshotDue, snapshotRecord, snapshots } from './snapshots.js';
import { distributeFees } from './fees.js';
import { ensureLut, lutAddress } from './lut.js';
import { connection, LP_LAUNCHER_BPS, LP_LIVE, LP_TREASURY_BPS, treasury } from './solana.js';

export interface Reply { status: number; body: unknown; type?: string; cache?: string }
const json = (body: unknown, status = 200, cache?: string): Reply => ({ status, body, cache });
const bad = (status: number, error: string): Reply => ({ status, body: { error } });

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) throw new LaunchError('That’s too large.'); chunks.push(c as Buffer); }
  return Buffer.concat(chunks);
}
async function readJson<T>(req: IncomingMessage, max: number): Promise<Partial<T>> {
  try { const v = JSON.parse((await readBody(req, max)).toString('utf8')); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch (e) { if (e instanceof LaunchError) throw e; }
  throw new LaunchError('Malformed request.');
}
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const limits = new Map<string, number[]>();
const allow = (key: string, n: number, ms: number) => {
  const now = Date.now(), hits = (limits.get(key) ?? []).filter((t) => now - t < ms);
  if (hits.length >= n) return false;
  hits.push(now); limits.set(key, hits);
  if (limits.size > 20_000) for (const [k, v] of limits) if (!v.some((t) => now - t < 3_600_000)) limits.delete(k);
  return true;
};

/** What happens when a coin goes live: the Overmind's note, its first snapshot, and the room hears. */
async function onLive(mint: string): Promise<void> {
  const c = await coin(mint);
  if (!c) return;
  await setNote(mint, await launchNote(c)).catch(() => {});
  tell({ kind: 'launch', symbol: c.ticker, by: tagOf(`wallet:${c.launcher}`) }, 'server');
  void snapshot(mint).catch((e) => console.warn(`[lp] first snapshot ${mint.slice(0, 6)} failed: ${(e as Error).message}`));
}

const submitting = new Set<string>();
const jobs = new Map<string, Promise<{ ok: boolean; sig: string; pending?: boolean; error?: string }>>();

export async function lpRoute(req: IncomingMessage, path: string, ip: string): Promise<Reply> {
  let m: RegExpMatchArray | null;
  try {
    if (req.method === 'GET') {
      if (path === 'status') {
        const t = await treasury();
        return json({ open: LP_LIVE && !!(await lutAddress()), switchedOn: LP_LIVE, lookupTable: (await lutAddress()) || null, treasury: t.publicKey.toBase58(), split: { treasury: LP_TREASURY_BPS, launcher: LP_LAUNCHER_BPS }, snapshotHours: Number(process.env.LP_SNAPSHOT_HOURS ?? 4), costSol: 0.03 });
      }
      if ((m = path.match(/^media\/([a-f0-9]{64})$/))) {
        const img = await image(m[1]);
        return img ? { status: 200, body: img.bytes, type: img.mime, cache: 'public, max-age=31536000, immutable' } : bad(404, 'not found');
      }
      if ((m = path.match(/^meta\/([1-9A-HJ-NP-Za-km-z]{32,44})\.json$/))) {
        const meta = await metadata(m[1]);
        return meta ? json(meta, 200, 'public, max-age=300') : bad(404, 'not found');
      }
      if (path === 'coins') return json((await liveCoins()).map(coinJson), 200, 'no-store');
      if ((m = path.match(/^coins\/([1-9A-HJ-NP-Za-km-z]{32,44})$/))) {
        const c = await coin(m[1]);
        if (!c || c.status !== 'live') return bad(404, 'not found');
        return json({ ...coinJson(c), snapshotList: (await snapshots(c.mint)).map((s) => ({ n: s.n, at: +new Date(s.at), slot: Number(s.slot), holders: s.holders, held: s.held, fingerprint: s.fingerprint, tx: s.memo_tx })) });
      }
      if ((m = path.match(/^coins\/([1-9A-HJ-NP-Za-km-z]{32,44})\/snapshots\/(\d+)\/record$/))) {
        const r = await snapshotRecord(m[1], Number(m[2]));
        return r ? { status: 200, body: r.record, type: 'application/json; charset=utf-8', cache: 'public, max-age=86400' } : bad(404, 'not found');
      }
      return bad(404, 'not found');
    }
    if (req.method !== 'POST') return bad(405, 'method');

    if (path === 'media') {
      if (!allow('media:all', 300, 3_600_000)) return bad(429, 'Uploads are busy: try again in a little while.');
      const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim();
      const r = await saveImage(await readBody(req, 1_000_000), mime, ip);
      return 'error' in r ? bad(400, r.error) : json(r);
    }
    if (path === 'launch') {
      if (!LP_LIVE) return bad(403, 'The launchpad opens after $OMD launches.');
      const input = await readJson<{ wallet: string; name: string; ticker: string; description: string; image: string; links?: Record<string, string> }>(req, 8_000);
      if (!allow(`launch:${ip}`, 6, 10 * 60_000) || !allow(`launch:${input.wallet}`, 1, 15_000) || !allow('launch:all', 120, 3_600_000)) return bad(429, 'One launch at a time: try again in a few seconds.');
      return json(await buildLaunch(input));
    }
    if (path === 'launch/submit') {
      const { mint, signed } = await readJson<{ mint: string; signed: string[] }>(req, 20_000);
      if (typeof mint !== 'string' || !MINT.test(mint) || !Array.isArray(signed) || signed.length !== 2) return bad(400, 'bad transactions');
      const row = (await pool.query(`select status, launcher, create_sig from lp_coins where mint = $1`, [mint])).rows[0] as { status: string; launcher: string; create_sig: string | null } | undefined;
      if (!row) return bad(404, 'unknown launch');
      if (row.status === 'live') return json({ ok: true, sig: row.create_sig });
      const [first, follow] = signed.map((b) => Buffer.from(String(b), 'base64'));
      const create = await countersign(mint, first);
      if (!create || !(await checkFollowUp(follow, row.launcher))) return bad(400, 'bad transactions');
      const sig = bs58.encode(VersionedTransaction.deserialize(create).signatures[0]);
      if (submitting.has(mint)) return json({ ok: false, pending: true, sig });
      const bh = VersionedTransaction.deserialize(create).message.recentBlockhash;
      if (!(await connection.isBlockhashValid(bh, { commitment: 'processed' }).then((r) => r.value, () => true))) return json({ ok: false, expired: true, reason: 'The launch took too long to sign and expired. Nothing was sent.' });
      submitting.add(mint);
      try {
        let job = jobs.get(mint);
        if (!job) {
          job = runLaunch(mint, create, follow, onLive).then((r) => { if (r.error) jobs.delete(mint); else setTimeout(() => jobs.delete(mint), 10 * 60_000); return r; },
            (e) => { jobs.delete(mint); return { ok: false, sig, error: `The launch hit an error: ${(e as Error).message}` }; });
          jobs.set(mint, job);
        }
        const r = await Promise.race([job, new Promise<null>((res) => setTimeout(() => res(null), 40_000))]);
        if (!r) return json({ ok: false, pending: true, sig });
        return r.error ? bad(409, r.error) : json(r);
      } finally { submitting.delete(mint); }
    }
    if (path === 'launch/confirm') {
      const { mint, sig } = await readJson<{ mint: string; sig: string }>(req, 2_000);
      if (typeof mint !== 'string' || !MINT.test(mint) || typeof sig !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) return bad(400, 'bad signature');
      return json(await confirmLaunch(mint, sig, onLive));
    }
    if (path === 'buy') {
      const { wallet, mint, sol } = await readJson<{ wallet: string; mint: string; sol: number }>(req, 2_000);
      if (typeof mint !== 'string' || !MINT.test(mint)) return bad(400, 'unknown coin');
      const c = await coin(mint);
      if (!c || c.status !== 'live') return bad(404, 'unknown coin');
      if (!allow(`buy:${ip}`, 20, 60_000)) return bad(429, 'Slow down a little.');
      return json(await buildBuy(String(wallet), mint, Number(sol)));
    }
    if (path === 'buy/submit') {
      const { signed } = await readJson<{ signed: string[] }>(req, 4_000);
      if (!Array.isArray(signed) || signed.length !== 1) return bad(400, 'bad transaction');
      const r = await submitBuy(Buffer.from(String(signed[0]), 'base64'));
      return r.ok ? json(r) : bad(409, r.error ?? 'The buy didn’t go through.');
    }
    return bad(404, 'not found');
  } catch (e) {
    if (e instanceof LaunchError) return bad(400, e.message);
    console.warn('[lp] route failed', path, (e as Error).message);
    return bad(500, 'Something went wrong on our side. Try again in a moment.');
  }
}

let distributedAt = 0;
/** Launches that landed after their request gave up (slow networks) are finished here; snapshots are taken when due. */
export async function lpJobs(): Promise<void> {
  await ensureLut().catch((e) => console.warn('[lp] lookup table not made', (e as Error).message));
  const pending = (await pool.query(`select mint, launcher from lp_coins where status = 'pending' and created_at > now() - interval '1 day' and created_at < now() - interval '2 minutes'`)).rows as { mint: string; launcher: string }[];
  for (const p of pending) {
    const sigs = await connection.getSignaturesForAddress(new (await import('@solana/web3.js')).PublicKey(p.mint), { limit: 5 }).catch(() => []);
    const first = sigs[sigs.length - 1];
    if (first && !first.err) await confirmLaunch(p.mint, first.signature, onLive).catch(() => {});
  }
  await pool.query(`update lp_coins set status = 'abandoned', mint_secret = null where status = 'pending' and created_at < now() - interval '1 day'`);
  if (Date.now() - distributedAt > 60 * 60_000) { distributedAt = Date.now(); await distributeFees().catch((e) => console.warn('[lp] distribute failed', (e as Error).message)); }
  await snapshotDue();
}
