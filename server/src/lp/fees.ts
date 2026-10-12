/**
 * Creator fees, paid out: each coin's share of trading fees accrues in its sharing config's vault; pump's distribute
 * (permissionless) pays it to the shareholders, the treasury and the launcher, in their split. The job runs it for
 * every coin with enough to distribute, paid for by the treasury (the treasury's half is what refills it, and what
 * pays for the coin's snapshot seals).
 */
import { PublicKey } from '@solana/web3.js';
import { pool } from '../db.js';
import { connection, pump, sendIxs, treasury } from './solana.js';

/** Distributes what has accrued; returns how many coins paid out. */
export async function distributeFees(): Promise<number> {
  const p = pump(), sdk = new p.OnlinePumpSdk(connection), t = await treasury();
  if ((await connection.getBalance(t.publicKey).catch(() => 0)) < 1_000_000) return 0; // can't pay the fee yet
  const live = (await pool.query(`select mint from lp_coins where status = 'live'`)).rows as { mint: string }[];
  let paid = 0;
  for (const { mint } of live) {
    try {
      const m = new PublicKey(mint);
      const min = await sdk.getMinimumDistributableFee(m, t.publicKey);
      if (!min.canDistribute) continue;
      const r = await sdk.buildDistributeCreatorFeesInstructions(m);
      await sendIxs(r.instructions, t, { cuLimit: 400_000 });
      paid++;
      console.log(`[lp] ${mint.slice(0, 6)}: distributed ${(Number(min.distributableFees.toString()) / 1e9).toFixed(6)} SOL of creator fees`);
    } catch (e) { console.warn(`[lp] distribute ${mint.slice(0, 6)} failed: ${(e as Error).message.slice(0, 140)}`); }
  }
  return paid;
}
