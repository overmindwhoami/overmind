/**
 * Launching a coin through the Overmind, in one wallet prompt (ported from early.exchange's SOL-pair path).
 *
 * The server builds two transactions; the launcher's wallet signs both, then the server co-signs the first as the
 * coin's mint and as the launchpad treasury, only if it is byte-for-byte what was built:
 *   1. pump.fun's create (the treasury as creator, so the fee can never be redirected away from the split), then pump's
 *      fee sharing: the coin's creator becomes its own sharing config, split between the treasury (LP_TREASURY_BPS: it
 *      pays for the coin's holder snapshots and their seals) and the launcher, from the very first trade;
 *   2. the launcher reimbursing the fee-sharing account's rent (pump makes the config's admin pay it), plus a Jito tip.
 * The launcher's wallet pays everything; the treasury is never out of pocket, so nobody can drain it by spamming.
 * A first buy is its own step after the coin is live (installed wallets simulate each transaction alone and block a
 * buy of a coin that doesn't exist yet), built by buildBuy.
 */
import BN from 'bn.js';
import bs58 from 'bs58';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type TransactionInstruction } from '@solana/web3.js';
import { pool } from '../db.js';
import { connection, JITO, jitoTipIx, LP_LAUNCHER_BPS, LP_TREASURY_BPS, PUBLIC_API, pump, sendBundle, broadcast, txOutcome, sha256, signedBy, SOL_MINT, TOKEN, TOKEN_2022, treasury } from './solana.js';

export class LaunchError extends Error {}

export interface LaunchInput { wallet: string; name: string; ticker: string; description?: string; image?: string }

/** pump makes the config's admin (the treasury) fund the fee-sharing account and grow the curve; the launcher pays it back. */
const SHARING_CONFIG_BYTES = 1024, CURVE_GROWTH_BYTES = 26;
export async function launchRentLamports(): Promise<number> {
  const [cfg, grown, base] = await Promise.all([SHARING_CONFIG_BYTES, CURVE_GROWTH_BYTES, 0].map((n) => connection.getMinimumBalanceForRentExemption(n)));
  return cfg + (grown - base);
}

export const walletOf = (v: unknown): PublicKey => {
  try {
    const k = new PublicKey(String(v));
    if (!PublicKey.isOnCurve(k.toBytes())) throw new Error();
    return k;
  } catch { throw new LaunchError('Connect a Solana wallet first.'); }
};

/** Checks a launch request; pump counts name bytes, not characters (an emoji is up to 4). */
export function validate(i: Partial<LaunchInput>): LaunchInput {
  const wallet = walletOf(i.wallet).toBase58();
  const name = String(i.name ?? '').trim();
  const ticker = String(i.ticker ?? '').trim().replace(/^\$/, '').toUpperCase();
  if (!name || Buffer.byteLength(name, 'utf8') > 32) throw new LaunchError('The name must be 1–32 characters (an emoji counts as 2–4).');
  if (!/^[A-Z0-9]{1,10}$/.test(ticker)) throw new LaunchError('The ticker must be 1–10 letters or numbers.');
  if (ticker === 'OMD') throw new LaunchError('$OMD is the Overmind’s own coin. Pick another ticker.');
  const description = String(i.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 280);
  // only images uploaded here (the metadata points at our copy, so it can't change after launch)
  const image = typeof i.image === 'string' && new RegExp(`^${PUBLIC_API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/api/lp/media/[a-f0-9]{64}$`).test(i.image) ? i.image : undefined;
  return { wallet, name, ticker, description, image };
}

async function lookupTable(): Promise<AddressLookupTableAccount> {
  const { lutAddress } = await import('./lut.js');
  const at = await lutAddress();
  const lut = at ? (await connection.getAddressLookupTable(new PublicKey(at)).catch(() => null))?.value : null;
  if (!lut) { console.error('[lp] no launch lookup table yet (the treasury makes one once it has 0.02 SOL): launches are refused'); throw new LaunchError('Launching is paused for a moment. Try again shortly.'); }
  return lut;
}

/** The treasury's side of a launch: open pump's fee-sharing config and set the split (SOL pairs). */
export async function feeSharingIxs(mint: PublicKey, launcher: PublicKey, payer: PublicKey): Promise<TransactionInstruction[]> {
  const p = pump();
  return [
    await p.PUMP_SDK.createFeeSharingConfig({ creator: payer, mint, pool: null }),
    await p.PUMP_SDK.updateFeeSharesV2({
      authority: payer, mint, currentShareholders: [payer],
      newShareholders: [{ address: payer, shareBps: LP_TREASURY_BPS }, { address: launcher, shareBps: LP_LAUNCHER_BPS }],
      quoteMint: new PublicKey(SOL_MINT), quoteTokenProgram: TOKEN,
    }),
  ];
}

/** A launch's instructions: pump's create, the fee split, the rent reimbursement (also what the lookup table is built from). */
export async function launchIxs(i: LaunchInput, mint: PublicKey, treasuryKey: PublicKey) {
  const p = pump(), launcher = new PublicKey(i.wallet);
  const create = await p.PUMP_SDK.createV2Instruction({
    mint, name: i.name, symbol: i.ticker, uri: `${PUBLIC_API}/api/lp/meta/${mint.toBase58()}.json`, creator: treasuryKey, user: launcher,
    mayhemMode: false, holderReward: false, // either would take the creator fee away from the split
  });
  const shares = await feeSharingIxs(mint, launcher, treasuryKey);
  const reimburse = SystemProgram.transfer({ fromPubkey: launcher, toPubkey: treasuryKey, lamports: await launchRentLamports() });
  return { create, shares, reimburse };
}

/** Builds a launch for the launcher's wallet to sign: { mint, txs } (base64, unsigned). Also used by the rehearsal. */
export async function buildLaunch(raw: Partial<LaunchInput>, opts: { lut?: AddressLookupTableAccount; skipBalance?: boolean } = {}): Promise<{ mint: string; txs: string[] }> {
  const i = validate(raw);
  const launcher = new PublicKey(i.wallet);
  if (!opts.skipBalance) {
    const have = (await connection.getBalance(launcher)) / 1e9;
    if (have < 0.03) throw new LaunchError(`Your wallet has ${have.toFixed(4)} SOL. Launching costs about 0.03 SOL (the coin's accounts and network fees). Add SOL and try again.`);
  }
  const t = await treasury();
  const mint = Keypair.generate();
  const { create, shares, reimburse } = await launchIxs(i, mint.publicKey, t.publicKey);
  const lut = opts.lut ?? (await lookupTable());
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const budget = (units: number) => [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 })];
  const compile = (list: TransactionInstruction[], units: number) =>
    new VersionedTransaction(new TransactionMessage({ payerKey: launcher, recentBlockhash: blockhash, instructions: [...budget(units), ...list] }).compileToV0Message([lut]));
  const tip = JITO ? [await jitoTipIx(launcher)] : [];
  const plan = [compile([create, ...shares], 500_000), compile([reimburse, ...tip], 20_000)];
  const size = (x: VersionedTransaction) => { try { return x.serialize().length; } catch { return Infinity; } };
  if (plan.some((x) => size(x) > 1232)) {
    console.error(`[lp] a launch no longer fits a transaction (${plan.map(size).join('/')} bytes): refresh the lookup table`);
    throw new LaunchError('Launching is paused for a moment. Try again shortly.');
  }
  // nothing is signed before the wallet (wallets refuse a transaction that arrives signed by others): the mint and the
  // treasury sign at submit, only this exact message
  const launchMsg = sha256(plan[0].message.serialize());
  await pool.query(
    `insert into lp_coins (mint, name, ticker, description, image, launcher, status, launch_msg, mint_secret) values ($1,$2,$3,$4,$5,$6,'pending',$7,$8)`,
    [mint.publicKey.toBase58(), i.name, i.ticker, i.description || null, i.image ?? null, i.wallet, launchMsg, bs58.encode(mint.secretKey)],
  );
  return { mint: mint.publicKey.toBase58(), txs: plan.map((x) => Buffer.from(x.serialize()).toString('base64')) };
}

/** Adds the mint's and the treasury's signatures to the create the launcher signed, if it's exactly the one built. */
export async function countersign(mint: string, raw: Buffer): Promise<Buffer | null> {
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(raw); } catch { return null; }
  const c = (await pool.query(`select launch_msg, mint_secret, launcher from lp_coins where mint = $1`, [mint])).rows[0] as { launch_msg: string; mint_secret: string | null; launcher: string } | undefined;
  if (!c?.mint_secret || sha256(tx.message.serialize()) !== c.launch_msg) return null;
  if (!signedBy(tx.message.serialize(), tx.signatures[0], new PublicKey(c.launcher))) return null; // the launcher's wallet signed it
  tx.sign([Keypair.fromSecretKey(bs58.decode(c.mint_secret)), await treasury()]);
  return Buffer.from(tx.serialize());
}

/** The follow-up must pay the treasury at least the fee-sharing rent, from its own fee payer (the launcher), signed. */
export async function checkFollowUp(raw: Buffer, launcher: string): Promise<boolean> {
  try {
    const tx = VersionedTransaction.deserialize(raw);
    const keys = tx.message.addressTableLookups.map((l) => l.accountKey);
    const luts = (await Promise.all(keys.map((k) => connection.getAddressLookupTable(k)))).map((r) => r.value).filter((v): v is AddressLookupTableAccount => !!v);
    if (luts.length !== keys.length) return false;
    const msg = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: luts });
    if (!msg.payerKey.equals(new PublicKey(launcher)) || !signedBy(tx.message.serialize(), tx.signatures[0], msg.payerKey)) return false;
    const rent = BigInt(await launchRentLamports()), lp = (await treasury()).publicKey;
    return msg.instructions.some((ix) => ix.programId.equals(SystemProgram.programId) && ix.data.length === 12 && ix.data.readUInt32LE(0) === 2
      && ix.keys[0]?.pubkey.equals(msg.payerKey) && ix.keys[1]?.pubkey.equals(lp) && ix.data.readBigUInt64LE(4) >= rent);
  } catch { return false; }
}

/** The coin exists on pump.fun with its sharing config as creator, our treasury as admin, and exactly our split. */
export async function launchOnChain(mint: string, launcher: string): Promise<{ ok: boolean; reason?: string }> {
  const p = pump(), mintPk = new PublicKey(mint);
  const curve = await new p.OnlinePumpSdk(connection).fetchBondingCurve(mintPk).catch(() => null);
  if (!curve) return { ok: false, reason: 'not confirmed yet' };
  if (!curve.creator.equals(p.feeSharingConfigPda(mintPk))) return { ok: false, reason: 'fee sharing not set on this coin' };
  const acc = await connection.getAccountInfo(p.feeSharingConfigPda(mintPk));
  if (!acc) return { ok: false, reason: 'fee sharing not set on this coin' };
  const cfg = p.PUMP_SDK.decodeSharingConfig(acc);
  const lp = (await treasury()).publicKey;
  const bps = (a: PublicKey) => cfg.shareholders.filter((s) => s.address.equals(a)).reduce((x, s) => x + s.shareBps, 0);
  if (!cfg.admin.equals(lp) || bps(lp) !== LP_TREASURY_BPS || bps(new PublicKey(launcher)) !== LP_LAUNCHER_BPS) return { ok: false, reason: 'unexpected fee split' };
  return { ok: true };
}

/**
 * Sends a signed launch: as one Jito bundle when it can (create and follow-up land together, nothing trades between),
 * else one at a time, each re-broadcast until it lands. Resolves with what happened; `onLive` runs once it's live.
 */
export async function runLaunch(mint: string, create: Buffer, follow: Buffer, onLive: (mint: string, sig: string) => Promise<void>): Promise<{ ok: boolean; sig: string; pending?: boolean; error?: string }> {
  const sig = bs58.encode(VersionedTransaction.deserialize(create).signatures[0]);
  const bundled = await sendBundle([create, follow]);
  if (!(bundled && (await txOutcome(sig, 12_000)) === 'landed')) {
    const c = await broadcast(create, 75_000);
    if (c.outcome === 'refused') return { ok: false, sig, error: 'The network refused the launch, so nothing was sent. Check your SOL balance and try again.' };
    if (c.outcome === 'failed') return { ok: false, sig, error: 'The launch failed on chain. Nothing was charged beyond the network fee.' };
    if (c.outcome === 'expired') return { ok: false, sig, error: 'The launch expired before it reached a block. Nothing was sent; launch again.' };
    if (c.outcome !== 'landed') return { ok: false, sig, pending: true };
    const f = await broadcast(follow, 60_000);
    if (f.outcome !== 'landed') console.warn(`[lp] ${mint}: the follow-up (rent reimbursement) didn't land: ${f.outcome}`);
  }
  const r = await confirmLaunch(mint, sig, onLive);
  return { ...r, sig };
}

/** Marks a landed launch live (once): checks it on chain, forgets the mint key, hands it to the room. */
export async function confirmLaunch(mint: string, sig: string, onLive: (mint: string, sig: string) => Promise<void>): Promise<{ ok: boolean; reason?: string }> {
  const c = (await pool.query(`select status, launcher from lp_coins where mint = $1`, [mint])).rows[0] as { status: string; launcher: string } | undefined;
  if (!c) return { ok: false, reason: 'unknown coin' };
  if (c.status === 'live') return { ok: true };
  const st = (await connection.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
  if (!st || st.err || (st.confirmationStatus !== 'confirmed' && st.confirmationStatus !== 'finalized')) return { ok: false, reason: st?.err ? 'the launch failed' : 'not confirmed yet' };
  const chk = await launchOnChain(mint, c.launcher);
  if (!chk.ok) return chk;
  const r = await pool.query(`update lp_coins set status = 'live', create_sig = $2, live_at = now(), mint_secret = null where mint = $1 and status = 'pending' returning mint`, [mint, sig]);
  if (r.rowCount) await onLive(mint, sig);
  return { ok: true };
}

/** Buys built here, by message hash (only these are relayed: the server is not an open relay). */
const builtBuys = new Map<string, number>();

/** A buy on a live coin's curve, for the buyer's wallet to sign (the launcher's first buy, right after launch). */
export async function buildBuy(wallet: string, mint: string, sol: number): Promise<{ txs: string[]; tokens: string }> {
  const buyer = walletOf(wallet), mintPk = new PublicKey(mint);
  if (!(sol > 0) || sol > 50) throw new LaunchError('A buy is between 0 and 50 SOL.');
  const p = pump(), sdk = new p.OnlinePumpSdk(connection);
  const [global, feeConfig, state] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig().catch(() => null), sdk.fetchBuyState(mintPk, buyer, TOKEN_2022)]);
  if (state.bondingCurve.complete) throw new LaunchError('This coin has graduated: buy it on pump.fun.');
  const solAmount = new BN(Math.floor(sol * 1e9));
  const amount = p.getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: state.bondingCurve.tokenTotalSupply, bondingCurve: state.bondingCurve, amount: solAmount, quoteMint: new PublicKey(SOL_MINT) });
  const ixs = await p.PUMP_SDK.buyInstructions({ global, bondingCurveAccountInfo: state.bondingCurveAccountInfo, bondingCurve: state.bondingCurve,
    associatedUserAccountInfo: state.associatedUserAccountInfo, mint: mintPk, user: buyer, amount, solAmount, slippage: 5, tokenProgram: TOKEN_2022 });
  const lut = await lookupTable().catch(() => undefined);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({ payerKey: buyer, recentBlockhash: blockhash, instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
    createAssociatedTokenAccountIdempotentInstruction(buyer, getAssociatedTokenAddressSync(mintPk, buyer, true, TOKEN_2022), buyer, mintPk, TOKEN_2022), ...ixs,
  ] }).compileToV0Message(lut ? [lut] : []);
  const now = Date.now();
  for (const [k, t] of builtBuys) if (now - t > 5 * 60_000) builtBuys.delete(k);
  builtBuys.set(sha256(msg.serialize()), now);
  return { txs: [Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64')], tokens: amount.toString() };
}

/** Sends a signed buy (checked: a pump.fun buy of a launchpad coin, paid by its signer). */
export async function submitBuy(raw: Buffer): Promise<{ ok: boolean; sig: string; error?: string }> {
  const tx = VersionedTransaction.deserialize(raw);
  const sig = bs58.encode(tx.signatures[0]);
  const payer = tx.message.staticAccountKeys[0], hash = sha256(tx.message.serialize());
  if (!builtBuys.has(hash) || !signedBy(tx.message.serialize(), tx.signatures[0], payer)) return { ok: false, sig, error: 'That buy isn’t one built here, or it isn’t signed.' };
  builtBuys.delete(hash);
  const r = await broadcast(raw, 60_000);
  return r.outcome === 'landed' ? { ok: true, sig } : { ok: false, sig, error: r.outcome === 'failed' ? 'The buy failed on chain (the price may have moved). Try again.' : 'The buy didn’t go through. Try again.' };
}
