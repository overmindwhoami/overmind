/**
 * $OMD's numbers for the board in the room: read from DexScreener (price and market cap from the pair with the most
 * liquidity, the day's volume summed across every pair), cached for a minute so every visitor shares one lookup. Until OMD_MINT is set the coin doesn't exist and this says so.
 * Before DexScreener lists it (the first minutes after launch), the price comes from its pump.fun bonding curve on chain,
 * in SOL, times SOL's dollar price; volume and the day's change wait for DexScreener.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { MAINNET_RPC } from './rpc.js';

const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const rpc = new Connection(MAINNET_RPC, 'confirmed');
/** The bonding curve: price in SOL per token, the supply, whether it graduated, and who created the coin. */
export async function curve(mint: string) {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()], PUMP);
  const a = await rpc.getAccountInfo(pda);
  if (!a || a.data.length < 81) return undefined;
  const d = a.data, vtr = Number(d.readBigUInt64LE(8)), vsr = Number(d.readBigUInt64LE(16)), supply = Number(d.readBigUInt64LE(40)) / 1e6;
  return { priceSol: vtr ? (vsr / 1e9) / (vtr / 1e6) : 0, supply, complete: d[48] === 1, creator: new PublicKey(d.subarray(49, 81)).toBase58() };
}
async function solUsd(): Promise<number | undefined> {
  const r = await fetch('https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112', { signal: AbortSignal.timeout(6000) });
  const j = (await r.json()) as Record<string, { usdPrice?: number }>;
  return j.So11111111111111111111111111111111111111112?.usdPrice;
}
async function fromCurve(mint: string): Promise<Partial<Coin>> {
  const [c, sol] = await Promise.all([curve(mint), solUsd()]);
  if (!c || !sol || c.complete) return {}; // graduated: DexScreener has it
  const price = c.priceSol * sol;
  return { price, mc: price * (c.supply || 1e9), url: `https://pump.fun/coin/${mint}` };
}
const MINT = () => process.env.OMD_MINT?.trim() || null;
const TTL = 60_000;

export interface Coin { mint: string | null; live: boolean; mc?: number; vol24?: number; change24?: number; price?: number; url?: string; at: number }
interface Pair { priceUsd?: string; marketCap?: number; fdv?: number; volume?: { h24?: number }; priceChange?: { h24?: number }; liquidity?: { usd?: number }; url?: string }

let cached: Coin | undefined;
let pending: Promise<Coin> | undefined;

export async function coin(): Promise<Coin> {
  const mint = MINT();
  if (!mint) return { mint: null, live: false, at: Date.now() };
  if (cached && cached.mint === mint && Date.now() - cached.at < TTL) return cached;
  pending ??= look(mint).finally(() => { pending = undefined; });
  return pending;
}

async function look(mint: string): Promise<Coin> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(String(res.status));
    const pairs = ((await res.json()) as { pairs?: Pair[] | null }).pairs ?? [];
    const p = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    cached = p
      ? { mint, live: true, mc: p.marketCap ?? p.fdv, vol24: pairs.reduce((v, q) => v + (q.volume?.h24 ?? 0), 0), change24: p.priceChange?.h24, price: p.priceUsd ? Number(p.priceUsd) : undefined, url: p.url, at: Date.now() }
      : { mint, live: true, ...(await fromCurve(mint).catch(() => ({}))), at: Date.now() };
  } catch (e) {
    console.warn('coin lookup failed', String(e).slice(0, 120));
    cached = cached?.mint === mint ? { ...cached, at: Date.now() - TTL / 2 } : { mint, live: true, at: Date.now() - TTL / 2 }; // keep the last numbers, retry sooner
  }
  return cached;
}
