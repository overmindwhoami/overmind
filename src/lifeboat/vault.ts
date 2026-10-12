/**
 * The lifeboat program's instructions (programs/lifeboat): open a vault for a ticket's root, split it (some to a wallet,
 * the rest to a fresh vault) or close it, each opened only by the ticket's Winternitz signature.
 */
import { Buffer } from 'buffer'; // the npm package in the browser (vite.config.ts aliases it), Node's own in tests
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { SIGNATURE_LENGTH } from './wots';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
export const PROGRAM_ID = new PublicKey(env.VITE_LIFEBOAT_PROGRAM ?? 'DwqEU77NsHMtLvkLVLhYKmLCC477edS1ftbfywYre4qo');

export const vaultOf = (root: Uint8Array) => PublicKey.findProgramAddressSync([root], PROGRAM_ID);

export function openIx(payer: PublicKey, root: Uint8Array): TransactionInstruction {
  const [vault, bump] = vaultOf(root);
  return new TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.from([0, ...root, bump]),
    keys: [{ pubkey: payer, isSigner: true, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] });
}
/** What a split signs: amount (u64 LE) | split | refund | vault. */
export function splitMessage(amount: bigint, split: PublicKey, refund: PublicKey, vault: PublicKey): Uint8Array {
  const m = new Uint8Array(104), dv = new DataView(m.buffer);
  dv.setBigUint64(0, amount, true);
  m.set(split.toBytes(), 8); m.set(refund.toBytes(), 40); m.set(vault.toBytes(), 72);
  return m;
}
export function splitIx(signature: Uint8Array, amount: bigint, root: Uint8Array, split: PublicKey, refund: PublicKey): TransactionInstruction {
  if (signature.length !== SIGNATURE_LENGTH) throw new Error('bad signature length');
  const [vault, bump] = vaultOf(root);
  const data = new Uint8Array(1 + SIGNATURE_LENGTH + 9);
  data[0] = 1; data.set(signature, 1); new DataView(data.buffer).setBigUint64(1 + SIGNATURE_LENGTH, amount, true); data[data.length - 1] = bump;
  return new TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.from(data),
    keys: [{ pubkey: vault, isSigner: false, isWritable: true }, { pubkey: split, isSigner: false, isWritable: true }, { pubkey: refund, isSigner: false, isWritable: true }] });
}
/** What a close signs: refund | vault. */
export const closeMessage = (refund: PublicKey, vault: PublicKey) => { const m = new Uint8Array(64); m.set(refund.toBytes(), 0); m.set(vault.toBytes(), 32); return m; };
export function closeIx(signature: Uint8Array, root: Uint8Array, refund: PublicKey): TransactionInstruction {
  const [vault, bump] = vaultOf(root);
  const data = new Uint8Array(1 + SIGNATURE_LENGTH + 1);
  data[0] = 2; data.set(signature, 1); data[data.length - 1] = bump;
  return new TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.from(data),
    keys: [{ pubkey: vault, isSigner: false, isWritable: true }, { pubkey: refund, isSigner: false, isWritable: true }] });
}
