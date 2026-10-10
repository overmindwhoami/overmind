/**
 * $OMD's numbers for the board in the room: read from DexScreener (price and market cap from the pair with the most
 * liquidity, the day's volume summed across every pair), cached for a minute so every visitor shares one lookup. Until OMD_MINT is set the coin doesn't exist and this says so.
 */
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
      : { mint, live: true, at: Date.now() };
  } catch (e) {
    console.warn('coin lookup failed', String(e).slice(0, 120));
    cached = cached?.mint === mint ? { ...cached, at: Date.now() - TTL / 2 } : { mint, live: true, at: Date.now() - TTL / 2 }; // keep the last numbers, retry sooner
  }
  return cached;
}
