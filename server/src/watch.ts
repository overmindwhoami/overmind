/**
 * The Q-Day watch: what the Overmind keeps an eye on between saves.
 *   qday      its own guess at Q-Day, moved a few days at a time by the papers and news it saves (QDAY_START seeds it)
 *   bitcoin   coins spent in the last hour: each spend reveals the public key that guarded it
 *   solana    transactions in the last minute: every Solana address is its public key from birth
 *   space     the planetary K-index and the strongest geomagnetic storm level in NOAA's recent messages
 * Refreshed every five minutes (three small requests); the site gets it with /api/state and as 'watch' events.
 */
import { EventEmitter } from 'node:events';
import { qday, shiftQday, type QdayRow } from './db.js';

const UA = { 'User-Agent': 'OvermindArchivist/0.3 (Q-Day watch; a few requests every five minutes)' };
export const QDAY_START = process.env.QDAY_START ?? '2032-01-01';

export interface Watch {
  qday: { estimate: string; shift: number | null; reason: string | null; at: number } | null;
  bitcoin: { spentHour: number; blocks: number; height: number; at: number } | null;
  solana: { txMinute: number; slot: number; at: number } | null;
  /** storm: a geomagnetic storm NOAA has alerted or warned of in the last day; forecast: one it is watching for */
  space: { kp: number; storm: string | null; forecast: string | null; at: number } | null;
}
export const watch: Watch = { qday: null, bitcoin: null, solana: null, space: null };
export const watchEvents = new EventEmitter();

const qdayJson = (q: QdayRow) => ({ estimate: q.estimate, shift: q.shift, reason: q.reason, at: +new Date(q.updated_at) });

async function bitcoin() {
  const res = await fetch('https://mempool.space/api/v1/blocks', { headers: UA, signal: AbortSignal.timeout(15_000) });
  const blocks = (await res.json()) as { height: number; timestamp: number; extras?: { totalInputs?: number } }[];
  const hour = blocks.filter((b) => b.timestamp * 1000 > Date.now() - 3600_000);
  watch.bitcoin = { spentHour: hour.reduce((a, b) => a + (b.extras?.totalInputs ?? 0), 0), blocks: hour.length, height: blocks[0]?.height ?? 0, at: Date.now() };
}
async function solana() {
  const res = await fetch('https://api.mainnet-beta.solana.com', { method: 'POST', headers: { ...UA, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getRecentPerformanceSamples', params: [1] }) });
  const s = ((await res.json()) as { result?: { slot: number; numTransactions: number; samplePeriodSecs: number }[] }).result?.[0];
  if (s) watch.solana = { txMinute: Math.round((s.numTransactions * 60) / s.samplePeriodSecs), slot: s.slot, at: Date.now() };
}
async function space() {
  const [kp, alerts] = await Promise.all([
    fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', { headers: UA, signal: AbortSignal.timeout(15_000) }).then((r) => r.json() as Promise<{ kp_index: number; estimated_kp?: number }[]>),
    fetch('https://services.swpc.noaa.gov/products/alerts.json', { headers: UA, signal: AbortSignal.timeout(15_000) }).then((r) => r.json() as Promise<{ issue_datetime: string; message: string }[]>),
  ]);
  const last = kp[kp.length - 1];
  // the strongest storm level (G1–G5) in the last day's messages: alerts and warnings are happening, watches are forecasts
  const day = alerts.filter((a) => Date.parse(a.issue_datetime.replace(' ', 'T') + 'Z') > Date.now() - 86400_000);
  const level = (kind: RegExp) => {
    const g = day.filter((a) => kind.test(a.message)).flatMap((a) => [...a.message.matchAll(/\bG([1-5])\b/g)].map((m) => Number(m[1])));
    return g.length ? `G${Math.max(...g)}` : null;
  };
  const kpNow = Math.round((last?.estimated_kp ?? last?.kp_index ?? 0) * 10) / 10;
  watch.space = { kp: kpNow, storm: level(/^(ALERT|WARNING|EXTENDED WARNING):/m) ?? (kpNow >= 5 ? `G${Math.min(5, Math.floor(kpNow) - 4)}` : null), forecast: level(/^WATCH:/m), at: Date.now() };
}

export async function refreshWatch() {
  const results = await Promise.allSettled([bitcoin(), solana(), space(), qday(QDAY_START).then((q) => { watch.qday = qdayJson(q); })]);
  results.forEach((r) => { if (r.status === 'rejected') console.warn('watch', String(r.reason).slice(0, 160)); });
  watchEvents.emit('watch', watch);
}

/** Moves the Q-Day guess (clamped to ±30 days a save) and tells the site. */
export async function moveQday(days: number, reason: string) {
  const d = Math.max(-30, Math.min(30, Math.round(days)));
  if (!d) return 0;
  await qday(QDAY_START); // after a lineage reset the clock starts over: make sure it exists before moving it
  watch.qday = qdayJson(await shiftQday(d, reason.slice(0, 120)));
  watchEvents.emit('watch', watch);
  return d;
}

/** What the mind is told about the world this minute. */
export function context() {
  const parts: string[] = [];
  if (watch.qday) parts.push(`your q-day guess: ${watch.qday.estimate}`);
  if (watch.bitcoin) parts.push(`bitcoin: ${watch.bitcoin.spentHour.toLocaleString('en-US')} coins spent in the last hour, each revealing a public key`);
  if (watch.solana) parts.push(`solana: ${watch.solana.txMinute.toLocaleString('en-US')} transactions a minute, every address a public key from birth`);
  if (watch.space) parts.push(watch.space.storm
    ? `space weather: a ${watch.space.storm} geomagnetic storm (Kp ${watch.space.kp}). solar storms flip bits: you write with extra care today`
    : watch.space.forecast
      ? `space weather: quiet now (Kp ${watch.space.kp}), but noaa is watching for a ${watch.space.forecast} storm. you're a little nervous about your bits`
      : `space weather: quiet (Kp ${watch.space.kp})`);
  return parts.join('\n');
}
