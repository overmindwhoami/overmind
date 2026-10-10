/**
 * Sealing on chain: each sealed disk's fingerprint goes into a Solana memo transaction, so anyone can look it up and
 * check it against the disk's canonical record (GET /api/disks/:n/record, then SHA-256 it).
 *   SOLANA_CLUSTER     devnet (default) | mainnet-beta | testnet
 *   SOLANA_RPC_URL     optional RPC endpoint (defaults to the cluster's public one)
 * The service signs with its own wallet: generated on first start and kept in the database (it only ever holds the
 * little SOL needed for fees, about 0.000005 SOL a seal). Its address is on /health so it can be funded.
 * A seal that can't be recorded (no funds, RPC down) stays pending and is retried; the site shows it as pending.
 */
import { clusterApiUrl, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction, TransactionInstruction, type Cluster } from '@solana/web3.js';
import { pool } from './db.js';

export const CLUSTER = (process.env.SOLANA_CLUSTER ?? 'devnet') as Cluster;
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const connection = new Connection(process.env.SOLANA_RPC_URL ?? clusterApiUrl(CLUSTER), 'confirmed');

let wallet: Keypair | undefined;
/** The service's signing wallet (created once, then loaded). */
export async function signer(): Promise<Keypair> {
  if (wallet) return wallet;
  await pool.query(`create table if not exists wallet (id integer primary key default 1, secret text not null, created_at timestamptz not null default now(), check (id = 1))`);
  const r = await pool.query(`select secret from wallet where id = 1`);
  if (r.rows[0]) wallet = Keypair.fromSecretKey(Buffer.from(r.rows[0].secret, 'base64'));
  else {
    const k = Keypair.generate();
    await pool.query(`insert into wallet (id, secret) values (1, $1) on conflict (id) do nothing`, [Buffer.from(k.secretKey).toString('base64')]);
    wallet = Keypair.fromSecretKey(Buffer.from((await pool.query(`select secret from wallet where id = 1`)).rows[0].secret, 'base64'));
  }
  return wallet;
}

export const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}${CLUSTER === 'mainnet-beta' ? '' : `?cluster=${CLUSTER}`}`;
/** What goes on chain for a sealed disk. */
export const memoFor = (n: number, fingerprint: string) => `overmind disk ${String(n + 1).padStart(4, '0')} sealed sha256:${fingerprint}`;

type WalletInfo = { cluster: Cluster; address: string; balance: number | null };
let cached: { at: number; info: WalletInfo } | undefined;
/** Address and balance (SOL; null if the RPC didn't answer). Cached for a minute, so /health never waits on the chain. */
export async function walletInfo(): Promise<WalletInfo> {
  if (cached && Date.now() - cached.at < 60_000) return cached.info;
  const k = await signer();
  const lamports = await Promise.race([
    connection.getBalance(k.publicKey),
    new Promise<undefined>((r) => setTimeout(() => r(undefined), 4000)),
  ]).catch(() => undefined);
  const info = { cluster: CLUSTER, address: k.publicKey.toBase58(), balance: lamports === undefined ? null : lamports / LAMPORTS_PER_SOL };
  cached = { at: Date.now(), info };
  return info;
}
export const forgetBalance = () => { cached = undefined; };

/** Any wallet's SOL balance (the terminal's EXPOSED command; browsers can't call the public RPC themselves). */
export async function balanceOf(address: string): Promise<number | undefined> {
  let key: PublicKey;
  try { key = new PublicKey(address); } catch { return undefined; }
  const lamports = await Promise.race([connection.getBalance(key), new Promise<undefined>((r) => setTimeout(() => r(undefined), 5000))]).catch(() => undefined);
  return lamports === undefined ? undefined : lamports / LAMPORTS_PER_SOL;
}

/** Writes a memo signed by the service wallet and waits for confirmation; returns the transaction signature. */
export async function memo(text: string): Promise<string> {
  const k = await signer();
  const tx = new Transaction().add(new TransactionInstruction({
    programId: MEMO, keys: [{ pubkey: k.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(text, 'utf8'),
  }));
  return sendAndConfirmTransaction(connection, tx, [k], { commitment: 'confirmed', maxRetries: 3 });
}
export const record = (n: number, fingerprint: string) => memo(memoFor(n, fingerprint));

/** Devnet and testnet only: asks the public faucet for test SOL (worthless; rate-limited). */
export async function airdrop(sol = 1) {
  if (CLUSTER === 'mainnet-beta') throw new Error('no faucet on mainnet');
  const k = await signer();
  const sig = await connection.requestAirdrop(k.publicKey, sol * LAMPORTS_PER_SOL);
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
  return sig;
}
