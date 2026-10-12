/**
 * Holder snapshots: every few hours, who holds each coin launched here, written down and sealed. A snapshot's record is
 * canonical text (holders sorted by wallet, raw amounts), its SHA-256 is the fingerprint, and the fingerprint goes on
 * Solana in a memo from the launchpad treasury, so after Q-Day anyone can still prove who held what before the break.
 * A seal waits (pending) while the treasury can't pay the fee; its half of the creator fees refills it.
 *   LP_SNAPSHOT_HOURS   how often (default 4); the first is taken at launch.
 */
import { PublicKey } from '@solana/web3.js';
import { pool } from '../db.js';
import { connection, DAS_URL, memoIx, sendIxs, sha256, TOKEN_2022, treasury } from './solana.js';

const EVERY_MS = Number(process.env.LP_SNAPSHOT_HOURS ?? 4) * 3_600_000;

/** Every balance of a mint, by owner: DAS getTokenAccounts (paginated) when the RPC has it, else a scan of token accounts. */
async function balances(mint: string): Promise<Map<string, bigint>> {
  const byOwner = new Map<string, bigint>();
  try {
    let cursor: string | undefined;
    for (let page = 0; page < 200; page++) {
      const res = await fetch(DAS_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 'overmind', method: 'getTokenAccounts', params: { mint, limit: 1000, cursor } }) });
      const body = (await res.json()) as { result?: { token_accounts: { owner: string; amount: number | string }[]; cursor?: string }; error?: unknown };
      if (!body.result) throw new Error(JSON.stringify(body.error).slice(0, 120));
      for (const a of body.result.token_accounts) { const v = BigInt(a.amount); if (v > 0n) byOwner.set(a.owner, (byOwner.get(a.owner) ?? 0n) + v); }
      cursor = body.result.cursor;
      if (!cursor || !body.result.token_accounts.length) break;
    }
    return byOwner;
  } catch (e) {
    console.warn(`[lp] DAS unavailable for ${mint.slice(0, 6)} (${(e as Error).message.slice(0, 80)}): scanning token accounts`);
  }
  // pump coins are Token-2022; mint at offset 0, owner at 32, amount at 64
  const accs = await connection.getProgramAccounts(TOKEN_2022, { commitment: 'confirmed', dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: mint } }] });
  for (const a of accs) {
    const owner = new PublicKey(a.account.data.subarray(0, 32)).toBase58(), v = a.account.data.readBigUInt64LE(32);
    if (v > 0n) byOwner.set(owner, (byOwner.get(owner) ?? 0n) + v);
  }
  return byOwner;
}

/** The text that is fingerprinted: anyone can rebuild it from the record served at /api/lp/coins/:mint/snapshots/:n/record. */
export const recordOf = (mint: string, n: number, at: string, slot: number, holders: [string, string][]) =>
  JSON.stringify({ coin: mint, snapshot: n, at, slot, holders });
export const memoOf = (mint: string, n: number, fp: string) => `overmind coin ${mint} holders ${n} sha256:${fp}`;

/** Takes one coin's next snapshot (wallets only: the curve, pools and other program accounts aren't holders). */
export async function snapshot(mint: string): Promise<{ n: number; holders: number; fingerprint: string }> {
  const slot = await connection.getSlot('confirmed');
  const all = await balances(mint);
  const holders = [...all].filter(([w]) => PublicKey.isOnCurve(new PublicKey(w).toBytes())).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([w, v]) => [w, v.toString()] as [string, string]);
  const held = holders.reduce((s, [, v]) => s + BigInt(v), 0n);
  const n = (await pool.query(`select coalesce(max(n) + 1, 0)::int as n from lp_snapshots where mint = $1`, [mint])).rows[0].n as number;
  const at = new Date().toISOString();
  const record = recordOf(mint, n, at, slot, holders);
  const fingerprint = sha256(record);
  await pool.query(`insert into lp_snapshots (mint, n, at, slot, holders, held, fingerprint, record) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [mint, n, at, slot, holders.length, held.toString(), fingerprint, record]);
  return { n, holders: holders.length, fingerprint };
}

/** Seals what's waiting, oldest first, while the treasury can pay (about 0.00001 SOL a seal). */
export async function sealPending(limit = 10): Promise<number> {
  const t = await treasury();
  if ((await connection.getBalance(t.publicKey).catch(() => 0)) < 200_000) return 0;
  const rows = (await pool.query(`select mint, n, fingerprint from lp_snapshots where memo_tx is null order by at limit $1`, [limit])).rows as { mint: string; n: number; fingerprint: string }[];
  let done = 0;
  for (const r of rows) {
    try {
      const sig = await sendIxs([memoIx(memoOf(r.mint, r.n, r.fingerprint))], t, { cuLimit: 80_000 }); // a 140-byte memo costs about 51k units
      await pool.query(`update lp_snapshots set memo_tx = $3 where mint = $1 and n = $2`, [r.mint, r.n, sig]);
      done++;
    } catch (e) { console.warn(`[lp] seal ${r.mint.slice(0, 6)}#${r.n} failed: ${(e as Error).message.slice(0, 120)}`); break; }
  }
  return done;
}

/** The job: snapshot every live coin that's due, then seal what's waiting. */
export async function snapshotDue(): Promise<void> {
  const due = (await pool.query(`select c.mint from lp_coins c where c.status = 'live'
    and coalesce((select max(at) from lp_snapshots s where s.mint = c.mint), 'epoch') < now() - make_interval(secs => $1::double precision / 1000)`, [EVERY_MS])).rows as { mint: string }[];
  for (const { mint } of due) {
    try { const s = await snapshot(mint); console.log(`[lp] ${mint.slice(0, 6)} snapshot ${s.n}: ${s.holders} holders sha256:${s.fingerprint.slice(0, 12)}`); }
    catch (e) { console.warn(`[lp] snapshot ${mint.slice(0, 6)} failed: ${(e as Error).message.slice(0, 120)}`); }
  }
  await sealPending().catch((e) => console.warn('[lp] sealing failed', (e as Error).message));
}

export async function snapshots(mint: string) {
  return (await pool.query(`select n, at, slot, holders, held, fingerprint, memo_tx from lp_snapshots where mint = $1 order by n desc limit 90`, [mint])).rows as
    { n: number; at: string; slot: string; holders: number; held: string; fingerprint: string; memo_tx: string | null }[];
}
export async function snapshotRecord(mint: string, n: number): Promise<{ record: string; fingerprint: string } | undefined> {
  return (await pool.query(`select record, fingerprint from lp_snapshots where mint = $1 and n = $2`, [mint, n])).rows[0];
}
