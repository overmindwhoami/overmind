/**
 * The launchpad's line to Solana: its own connection (LP_RPC_URL: a paid RPC with DAS for holder snapshots in
 * production, the local fork in rehearsal), its treasury (the creator and fee-sharing admin of every coin launched
 * here: LP_TREASURY_SECRET, else generated once and kept in the database, apart from the sealing wallet so the two
 * sets of books never mix), and sending with an honest outcome.
 */
import { createRequire } from 'node:module';
import { createHash, createPublicKey, verify } from 'node:crypto';
import bs58 from 'bs58';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount } from '@solana/web3.js';
import type * as PumpSdkModule from '@pump-fun/pump-sdk';
import { pool } from '../db.js';

export const RPC_URL = process.env.LP_RPC_URL ?? process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
export const DAS_URL = process.env.LP_DAS_URL ?? RPC_URL;
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** Launching is open (otherwise the launchpad shows, but nothing can be launched). */
export const LP_LIVE = process.env.LP_LIVE === 'true';
/** The creator fee's split: the Overmind's treasury (snapshots, seals, the archive) and the launcher. */
export const LP_TREASURY_BPS = Number(process.env.LP_TREASURY_BPS ?? 5000);
export const LP_LAUNCHER_BPS = 10_000 - LP_TREASURY_BPS;
/** Where this server is reached (token metadata and images are served from here). */
export const PUBLIC_API = process.env.PUBLIC_API_URL ?? 'https://archivist-production-ef62.up.railway.app';
export const SITE = process.env.PUBLIC_SITE_URL ?? 'https://overmind.im';

const READ_TIMEOUT = 30_000;
const rpcFetch = (url: string | URL | Request, init?: RequestInit) => {
  const body = typeof init?.body === 'string' ? init.body : '';
  if (/"method":"sendTransaction"/.test(body) || init?.signal) return fetch(url, init);
  return fetch(url, { ...init, signal: AbortSignal.timeout(READ_TIMEOUT) });
};
export const connection = new Connection(RPC_URL, { commitment: 'confirmed', fetch: rpcFetch as typeof fetch });

// pump's ESM build imports BN from @coral-xyz/anchor, which Node can't resolve; its CommonJS build loads fine (lazily).
let mod: typeof PumpSdkModule | null = null;
export function pump(): typeof PumpSdkModule {
  mod ??= createRequire(import.meta.url)('@pump-fun/pump-sdk') as typeof PumpSdkModule;
  return mod;
}

let treasuryKey: Keypair | undefined;
/** The launchpad's treasury: creator of every coin launched here and admin of its fee split. */
export async function treasury(): Promise<Keypair> {
  if (treasuryKey) return treasuryKey;
  const env = process.env.LP_TREASURY_SECRET?.trim();
  if (env) return (treasuryKey = Keypair.fromSecretKey(env.startsWith('[') ? Uint8Array.from(JSON.parse(env) as number[]) : bs58.decode(env)));
  await pool.query(`create table if not exists lp_treasury (id integer primary key default 1, secret text not null, created_at timestamptz not null default now(), check (id = 1))`);
  const r = await pool.query(`select secret from lp_treasury where id = 1`);
  if (!r.rows[0]) await pool.query(`insert into lp_treasury (id, secret) values (1, $1) on conflict (id) do nothing`, [Buffer.from(Keypair.generate().secretKey).toString('base64')]);
  const s = (await pool.query(`select secret from lp_treasury where id = 1`)).rows[0].secret as string;
  return (treasuryKey = Keypair.fromSecretKey(Buffer.from(s, 'base64')));
}

export const memoIx = (text: string) => new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(text, 'utf8') });
export const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

/** True when `sig` is a valid ed25519 signature of `message` by `signer` (the launcher's wallet, checked before we co-sign). */
export function signedBy(message: Uint8Array, sig: Uint8Array, signer: PublicKey): boolean {
  try {
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), signer.toBuffer()]);
    return verify(null, message, createPublicKey({ key: der, format: 'der', type: 'spki' }), sig);
  } catch { return false; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Status = 'landed' | 'failed' | 'pending' | 'absent' | 'error';
async function statusOf(sig: string): Promise<Status> {
  const r = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true }).catch(() => null);
  if (!r) return 'error';
  const st = r.value[0];
  if (!st) return 'absent';
  if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') return st.err ? 'failed' : 'landed';
  return 'pending';
}

/** Sends signed bytes and re-broadcasts every 2 s until it lands, fails or its blockhash expires. */
export async function broadcast(raw: Buffer, maxWaitMs = 75_000): Promise<{ outcome: 'landed' | 'failed' | 'expired' | 'unknown' | 'refused'; error?: string }> {
  const tx = VersionedTransaction.deserialize(raw);
  const sig = bs58.encode(tx.signatures[0]);
  const bh = tx.message.recentBlockhash;
  try { await connection.sendRawTransaction(raw, { maxRetries: 0 }); } catch (e) {
    const m = (e as Error).message;
    if (!/already been processed|AlreadyProcessed/i.test(m)) return { outcome: 'refused', error: m };
  }
  const until = Date.now() + maxWaitMs;
  for (let n = 0; ; n++) {
    void sendTxJito(raw);
    await sleep(2000);
    const st = await statusOf(sig);
    if (st === 'landed' || st === 'failed') return { outcome: st };
    if (Date.now() > until) return { outcome: 'unknown' };
    if (n % 5 === 4 && st === 'absent' && !(await connection.isBlockhashValid(bh, { commitment: 'processed' }).then((r) => r.value, () => true))) {
      const last = await statusOf(sig);
      return last === 'landed' || last === 'failed' ? { outcome: last } : { outcome: 'expired' };
    }
    await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
  }
}

/** Waits for a signature's outcome (no sending). */
export async function txOutcome(sig: string, maxWaitMs = 60_000): Promise<'landed' | 'failed' | 'unknown'> {
  const until = Date.now() + maxWaitMs;
  for (;;) {
    const st = await statusOf(sig);
    if (st === 'landed' || st === 'failed') return st;
    if (Date.now() > until) return 'unknown';
    await sleep(2000);
  }
}

/** Builds, signs (the payer) and sends instructions; resolves with the signature once it has landed. */
export async function sendIxs(ixs: TransactionInstruction[], payer: Keypair, opts: { cuLimit?: number; luts?: AddressLookupTableAccount[] } = {}): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: opts.cuLimit ?? 200_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }), ...ixs,
  ] }).compileToV0Message(opts.luts ?? []);
  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);
  const sig = bs58.encode(tx.signatures[0]);
  const r = await broadcast(Buffer.from(tx.serialize()), 75_000);
  if (r.outcome !== 'landed') throw new Error(`tx ${sig} ${r.outcome}${r.error ? `: ${r.error.split('\n')[0]}` : ''}`);
  return sig;
}

// ——— Jito: the create and its follow-up land together, in one block, so nothing trades in between (off on a fork) ———
export const JITO = process.env.LP_JITO !== 'false';
const ENGINES = (process.env.JITO_BLOCK_ENGINE ? [process.env.JITO_BLOCK_ENGINE] : ['mainnet', 'ny.mainnet', 'amsterdam.mainnet', 'frankfurt.mainnet', 'tokyo.mainnet']
  .map((r) => `https://${r}.block-engine.jito.wtf`));
export const JITO_TIP_LAMPORTS = Math.round(Number(process.env.LP_JITO_TIP_SOL ?? '0.0005') * 1e9);
const TIP_ACCOUNTS = ['96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5', 'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe', 'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49', 'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh', 'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL', '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'];
export const isJitoTip = (to: PublicKey) => TIP_ACCOUNTS.includes(to.toBase58());
export async function jitoTipIx(payer: PublicKey) {
  const { SystemProgram } = await import('@solana/web3.js');
  return SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)]), lamports: JITO_TIP_LAMPORTS });
}
export async function sendBundle(raws: Buffer[]): Promise<string | null> {
  if (!JITO || raws.length > 5) return null;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [raws.map((b) => b.toString('base64')), { encoding: 'base64' }] });
  const answers = await Promise.all(ENGINES.map(async (url) => {
    try {
      const r = await fetch(`${url}/api/v1/bundles`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(6_000), body });
      return ((await r.json().catch(() => null)) as { result?: string } | null)?.result ?? null;
    } catch { return null; }
  }));
  return answers.find((a) => a) ?? null;
}
async function sendTxJito(raw: Buffer) {
  if (!JITO) return;
  await fetch(`${ENGINES[0]}/api/v1/transactions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [raw.toString('base64'), { encoding: 'base64' }] }),
  }).catch(() => undefined);
}
