/**
 * The launchpad's address lookup table: pump's fixed accounts, so a launch (create + fee split, three signers) fits in
 * one transaction. Owned and paid for by the launchpad treasury (about 0.01 SOL of rent, once). Rebuild after a
 * pump.fun upgrade that changes accounts: `npm run lp:lut` simulates, `SEND=yes npm run lp:lut` creates it and prints
 * LP_LUT to set on the server.
 */
import { AddressLookupTableProgram, Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { launchIxs } from './launch.js';
import { pump, SOL_MINT, TOKEN, TOKEN_2022, sendIxs } from './solana.js';

const FIXED = ['ComputeBudget111111111111111111111111111111', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'SysvarRent111111111111111111111111111111111', SOL_MINT];

/** Every address a launch names that isn't per-coin: pump's programs and globals, the token programs, the treasury. */
export async function lutAddresses(read: Connection, treasuryKey: PublicKey): Promise<PublicKey[]> {
  const p = pump();
  const sample = await launchIxs({ wallet: Keypair.generate().publicKey.toBase58(), name: 'Lookup', ticker: 'LUT' }, Keypair.generate().publicKey, treasuryKey);
  const named = [sample.create, ...sample.shares, sample.reimburse].flatMap((ix) => [ix.programId, ...ix.keys.filter((k) => !k.isSigner).map((k) => k.pubkey)]);
  const fixed = [p.PUMP_PROGRAM_ID, p.GLOBAL_PDA, p.PUMP_EVENT_AUTHORITY_PDA, p.PUMP_FEE_PROGRAM_ID, p.PUMP_FEE_CONFIG_PDA, p.PUMP_FEE_EVENT_AUTHORITY_PDA,
    p.GLOBAL_VOLUME_ACCUMULATOR_PDA, p.QUOTE_CONTROL_PDA, p.MAYHEM_PROGRAM_ID, p.PUMP_AMM_PROGRAM_ID, p.FEE_PROGRAM_GLOBAL_PDA,
    SystemProgram.programId, TOKEN, TOKEN_2022, treasuryKey, p.creatorVaultPda(treasuryKey), ...FIXED.map((a) => new PublicKey(a))];
  // per-coin accounts (the curve, its vaults, the sharing config) don't exist yet: only what's already on chain is worth a slot
  const unique = [...new Map([...fixed, ...named].map((k) => [k.toBase58(), k])).values()];
  const infos = await read.getMultipleAccountsInfo(unique);
  return unique.filter((k, i) => !!infos[i] || fixed.some((f) => f.equals(k)));
}

/** Creates and fills the table with the treasury; returns its address. */
export async function createLut(conn: Connection, payer: Keypair): Promise<PublicKey> {
  const addresses = await lutAddresses(conn, payer.publicKey);
  const slot = await conn.getSlot('finalized');
  const [create, lut] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot });
  const extend = (list: PublicKey[]) => AddressLookupTableProgram.extendLookupTable({ lookupTable: lut, authority: payer.publicKey, payer: payer.publicKey, addresses: list });
  await sendIxs([create, extend(addresses.slice(0, 20))], payer);
  for (let i = 20; i < addresses.length; i += 20) await sendIxs([extend(addresses.slice(i, i + 20))], payer);
  return lut;
}
