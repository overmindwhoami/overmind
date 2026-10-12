// Launch-day preflight: reads the live service (nothing here changes anything) and says what's ready and what isn't.
//   npm run preflight            (API=https://… to check another deployment)
const API = process.env.API ?? 'https://archivist-production-ef62.up.railway.app';
const SITE = process.env.SITE ?? 'https://overmind.im';
type Row = { ok: boolean | null; what: string; detail: string; fix?: string };
const rows: Row[] = [];
const add = (ok: boolean | null, what: string, detail: string, fix?: string) => rows.push({ ok, what, detail, fix });
const get = async <T,>(path: string): Promise<T | undefined> => {
  try { const r = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(15_000) }); return r.ok ? ((await r.json()) as T) : undefined; } catch { return undefined; }
};

const health = await get<{ ok: boolean; disk: number; model: string; wallet?: { address: string; balance: number | null; cluster: string } }>('/health');
add(!!health?.ok, 'the archivist is running', health ? `writing disk ${String((health.disk ?? 0) + 1).padStart(4, '0')}` : `no answer from ${API}`, 'check the Railway service "archivist"');
add(!!health && !health.model.startsWith('template'), 'Claude writes the notes and talks at the terminal', health?.model ?? '—', 'set ANTHROPIC_API_KEY on "archivist" (Railway → Variables)');
const w = health?.wallet;
add(!!w && w.cluster === 'mainnet-beta', 'seals go to Solana mainnet', w ? w.cluster : '—', 'SOLANA_CLUSTER=mainnet-beta on "archivist"');
add(!!w && (w.balance ?? 0) >= 0.01, 'the sealing wallet can pay for seals', w ? `${w.address}: ${w.balance ?? '?'} SOL` : '—', `send about 0.05 SOL to the sealing wallet${w ? ` ${w.address}` : ''} (a seal costs ~0.000005 SOL)`);
const state = await get<{ launchAt: number | null; disk: { n: number; written: number } | null }>('/api/state');
add(state?.launchAt ? true : null, 'a launch time is set', state?.launchAt ? new Date(state.launchAt).toISOString() : 'none: writing now', 'optional: LAUNCH_AT=<ISO time> on "archivist" (the first save lands on that minute)');
const coin = await get<{ mint: string | null; mc?: number }>('/api/coin');
add(!!coin?.mint, '$OMD is on the board', coin?.mint ? `${coin.mint}${coin.mc ? ` · MC $${Math.round(coin.mc).toLocaleString('en-US')}` : ''}` : 'NOT LAUNCHED', 'after launching $OMD on pump.fun: OMD_MINT=<mint> on "archivist"');
const lp = await get<{ open: boolean; switchedOn: boolean; lookupTable: string | null; treasury: string; split: { treasury: number; launcher: number } }>('/api/lp/status');
if (!lp) add(false, 'the launchpad answers', 'no /api/lp/status', 'deploy the server');
else {
  add(lp.switchedOn ? true : null, 'the launchpad is switched on', lp.switchedOn ? `split ${lp.split.launcher / 100}% launcher / ${lp.split.treasury / 100}% treasury` : 'off', 'LP_LIVE=true on "archivist" when you want launches open (after $OMD)');
  add(lp.switchedOn ? !!lp.lookupTable : null, 'the launch lookup table exists', lp.lookupTable ?? 'not yet', `send about 0.05 SOL to the launchpad treasury ${lp.treasury}; the server makes the table within 5 minutes`);
}
try {
  const r = await fetch(SITE, { signal: AbortSignal.timeout(15_000) });
  add(r.ok, `${SITE} is up`, `${r.status}`, 'check CloudFront / S3');
} catch { add(false, `${SITE} is up`, 'no answer', 'check CloudFront / S3'); }
const rpc = process.env.LP_RPC_URL ?? '';
add(null, 'a paid RPC for launches and holder snapshots', rpc ? rpc.replace(/api-key=[^&]+/, 'api-key=…') : 'not checked from here', 'LP_RPC_URL and LP_DAS_URL on "archivist" (Helius: https://mainnet.helius-rpc.com/?api-key=…) — the public RPC is rate-limited');

const mark = (ok: boolean | null) => (ok === true ? '✓' : ok === false ? '✗' : '·');
console.log(`\novermind preflight · ${API}\n`);
for (const r of rows) console.log(`${mark(r.ok)} ${r.what}${r.detail ? `: ${r.detail}` : ''}${r.ok !== true && r.fix ? `\n    → ${r.fix}` : ''}`);
const missing = rows.filter((r) => r.ok === false).length;
console.log(`\n${missing ? `${missing} to do before launch` : 'ready'} (· = optional or depends on when you launch)\n`);
