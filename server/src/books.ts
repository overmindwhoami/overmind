/**
 * The books: every wallet the Overmind uses, what came in and what went out, read from the chain itself (each
 * transaction's balance change for that wallet). "If money is shown, it adds up": each wallet's movements are summed
 * from its first transaction, and the page says whether that sum equals the balance the chain reports now.
 *   the sealing wallet       pays for the disks' seals
 *   the launchpad treasury   creator of launched coins; its share of their fees pays for their holder snapshots
 *   OMD_CREATOR              the wallet that launched $OMD (its creator fees), once set
 *   BOOKS_EXTRA              more, as "name:address,name:address"
 * Movements are kept in the database and read incrementally (only new signatures), so the page is cheap.
 */
import { Connection, PublicKey, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { pool } from './db.js';
import { signer } from './chain.js';
import { treasury } from './lp/solana.js';
import { MAINNET_RPC } from './rpc.js';

export const BOOKS_RPC = process.env.BOOKS_RPC_URL ?? process.env.LP_RPC_URL ?? process.env.SOLANA_RPC_URL ?? MAINNET_RPC;
const rpc = new Connection(BOOKS_RPC, 'confirmed');
const PROGRAMS: Record<string, string> = {
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'seal (memo)', pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ: 'creator fees',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'pump.fun', AddressLookupTab1e1111111111111111111111111: 'lookup table',
};

export async function migrateBooks() {
  await pool.query(`create table if not exists book_moves (address text not null, sig text not null, at timestamptz, delta bigint not null, fee bigint not null default 0,
    what text not null, primary key (address, sig))`);
}

async function wallets(): Promise<{ name: string; role: string; address: string }[]> {
  const list = [
    { name: 'the sealing wallet', role: 'pays for each sealed disk’s fingerprint on Solana', address: (await signer()).publicKey.toBase58() },
    { name: 'the launchpad treasury', role: 'creator of every coin launched here; its share of their creator fees pays for their holder snapshots', address: (await treasury()).publicKey.toBase58() },
  ];
  if (process.env.OMD_CREATOR) list.push({ name: '$OMD creator', role: 'launched $OMD; receives its creator fees', address: process.env.OMD_CREATOR });
  for (const pair of (process.env.BOOKS_EXTRA ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [name, address] = pair.split(':');
    if (name && address) list.push({ name, role: '', address });
  }
  return list;
}

/** Reads new transactions for one wallet (newest first, until one it already has) and stores each balance change. */
async function sync(address: string): Promise<void> {
  const key = new PublicKey(address);
  const have = new Set((await pool.query(`select sig from book_moves where address = $1`, [address])).rows.map((r) => r.sig as string));
  let before: string | undefined;
  for (let page = 0; page < 20; page++) {
    const sigs = await rpc.getSignaturesForAddress(key, { before, limit: 100 });
    const fresh = sigs.filter((s) => !have.has(s.signature));
    for (let i = 0; i < fresh.length; i += 10) {
      const txs = await rpc.getParsedTransactions(fresh.slice(i, i + 10).map((s) => s.signature), { maxSupportedTransactionVersion: 0 });
      for (const [j, tx] of txs.entries()) if (tx) await store(address, fresh[i + j].signature, tx);
    }
    if (sigs.length < 100 || fresh.length < sigs.length) break; // reached what's already in the books
    before = sigs[sigs.length - 1].signature;
  }
}
async function store(address: string, sig: string, tx: ParsedTransactionWithMeta) {
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const i = keys.indexOf(address);
  if (i < 0 || !tx.meta) return;
  const delta = tx.meta.postBalances[i] - tx.meta.preBalances[i];
  const payer = i === 0, programs = tx.transaction.message.instructions.map((ix) => ix.programId.toBase58());
  const what = programs.map((p) => PROGRAMS[p]).find(Boolean) ?? (delta > 0 ? 'received' : 'sent');
  await pool.query(`insert into book_moves (address, sig, at, delta, fee, what) values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
    [address, sig, tx.blockTime ? new Date(tx.blockTime * 1000) : null, delta, payer ? tx.meta.fee : 0, tx.meta.err ? `${what} (failed)` : what]);
}

let cache: { at: number; body: unknown } | undefined;
/** The books, refreshed at most every two minutes. */
export async function books() {
  if (cache && Date.now() - cache.at < 120_000) return cache.body;
  const list = await wallets();
  const out = [];
  for (const w of list) {
    await sync(w.address).catch((e) => console.warn('books: sync failed', w.address.slice(0, 6), (e as Error).message.slice(0, 100)));
    const balance = await rpc.getBalance(new PublicKey(w.address)).catch(() => null);
    const t = (await pool.query(`select coalesce(sum(delta) filter (where delta > 0), 0)::bigint as came, coalesce(-sum(delta) filter (where delta < 0), 0)::bigint as went,
      coalesce(sum(delta), 0)::bigint as net, count(*)::int as moves from book_moves where address = $1`, [w.address])).rows[0];
    const recent = (await pool.query(`select sig, at, delta, what from book_moves where address = $1 order by at desc nulls last limit 8`, [w.address])).rows;
    out.push({ ...w, balance: balance === null ? null : balance / 1e9, in: Number(t.came) / 1e9, out: Number(t.went) / 1e9, moves: t.moves,
      addsUp: balance === null ? null : Number(t.net) === balance,
      recent: recent.map((r) => ({ sig: r.sig, at: r.at ? +new Date(r.at) : null, sol: Number(r.delta) / 1e9, what: r.what })) });
  }
  const body = { wallets: out, at: Date.now() };
  cache = { at: Date.now(), body };
  return body;
}
