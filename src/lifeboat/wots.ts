/**
 * Winternitz one-time signatures exactly as the lifeboat program checks them (programs/lifeboat/src/wots.rs):
 * 34 chains of 27-byte Keccak256 (w = 256): the message digest's 32 bytes and a two-digit checksum.
 * A key is 34 random 27-byte seeds; its public key is each seed hashed 256 times; the vault's root is Keccak256 of
 * the public key. Signing reveals part of the key, so a key signs once.
 */
import { keccak_256 } from '@noble/hashes/sha3';

export const HASH_LENGTH = 27; // 216-bit chains: a withdrawal with its compute budget fits one 1232-byte transaction
export const CHAINS = 34;
export const SIGNATURE_LENGTH = HASH_LENGTH * CHAINS; // 918

const step = (x: Uint8Array) => keccak_256(x).subarray(0, HASH_LENGTH);
const walk = (x: Uint8Array, times: number) => { let v = x; for (let i = 0; i < times; i++) v = step(v); return v; };

/** A fresh private key: 952 random bytes (34 seeds), from the browser's (or Node's) cryptographic random source. */
export const generateKey = () => crypto.getRandomValues(new Uint8Array(SIGNATURE_LENGTH));

/** The values each chain signs: the digest bytes, then the checksum's base-256 digits (sum of 255 - byte, <= 8160). */
export function chainValues(message: Uint8Array): Uint8Array {
  const digest = keccak_256(message), values = new Uint8Array(CHAINS);
  values.set(digest);
  let checksum = 0;
  for (const n of digest) checksum += 255 - n;
  values[32] = checksum >> 8; values[33] = checksum & 0xff;
  return values;
}
const chains = (key: Uint8Array, f: (seed: Uint8Array, i: number) => Uint8Array) => {
  const out = new Uint8Array(SIGNATURE_LENGTH);
  for (let i = 0; i < CHAINS; i++) out.set(f(key.subarray(i * HASH_LENGTH, (i + 1) * HASH_LENGTH), i), i * HASH_LENGTH);
  return out;
};
export const publicKey = (priv: Uint8Array) => chains(priv, (seed) => walk(seed, 256));
export const rootOf = (pub: Uint8Array) => keccak_256(pub);
export function sign(priv: Uint8Array, message: Uint8Array): Uint8Array {
  const v = chainValues(message);
  return chains(priv, (seed, i) => walk(seed, 256 - v[i]));
}
/** The root a signature of `message` points at (the program does the same; a wrong signature points elsewhere). */
export function recoverRoot(signature: Uint8Array, message: Uint8Array): Uint8Array {
  const v = chainValues(message);
  return rootOf(chains(signature, (s, i) => walk(s, v[i])));
}
export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
