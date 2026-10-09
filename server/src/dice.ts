/**
 * The Overmind's dice. Each round starts from a public random number, labelled honestly:
 *   1. CURBy (NIST + University of Colorado), used only when its latest round is quantum and recent;
 *   2. otherwise drand (League of Entropy), public and verifiable but not quantum;
 *   3. otherwise local randomness, marked as such.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Dice } from './db.js';

const UA = { 'User-Agent': 'OvermindArchivist/0.2 (+https://github.com/; gentle)' };
const FRESH_MS = 24 * 3600 * 1000;

async function curby(): Promise<Dice | undefined> {
  const res = await fetch('https://random.colorado.edu/api/curbyq/round/latest', { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return undefined;
  const entries = (await res.json()) as { cid?: { '/': string }; data?: { content?: { payload?: { round?: number; stage?: string; timestamp?: string; parameters?: { isQuantum?: boolean } } } } }[];
  const result = entries.find((e) => e.data?.content?.payload?.stage === 'result') ?? entries[entries.length - 1];
  const p = result?.data?.content?.payload;
  if (!p?.timestamp || !result?.cid) return undefined;
  const quantum = p.parameters?.isQuantum ?? entries.some((e) => e.data?.content?.payload?.parameters?.isQuantum === true);
  if (!quantum || Date.now() - Date.parse(p.timestamp) > FRESH_MS) return undefined;
  // the round's result record is content-addressed: hashing its CID commits to the published value
  return { source: 'curby', round: p.round ?? 0, value: createHash('sha256').update(result.cid['/']).digest('hex'), quantum: true, at: p.timestamp };
}

async function drand(): Promise<Dice | undefined> {
  const res = await fetch('https://api.drand.sh/public/latest', { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return undefined;
  const d = (await res.json()) as { round: number; randomness: string };
  return { source: 'drand', round: d.round, value: d.randomness, quantum: false, at: new Date().toISOString() };
}

export async function roll(): Promise<Dice> {
  for (const f of [curby, drand]) {
    try { const d = await f(); if (d) return d; } catch { /* next source */ }
  }
  return { source: 'local', round: 0, value: randomBytes(32).toString('hex'), quantum: false, at: new Date().toISOString(), note: 'public beacons unreachable' };
}

/** A deterministic stream of numbers in [0, 1) from the dice value (mulberry32 over its first 32 bits, re-keyed per call site). */
export function stream(value: string, salt = 0) {
  let s = (parseInt(value.slice(0, 8), 16) ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
