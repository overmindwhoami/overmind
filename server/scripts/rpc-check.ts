// Checks the Helius key end to end, one call for each way the server uses Solana, through the same RPC the server
// resolves (src/rpc.ts). Prints the RPC with its key hidden. Needs no database.
//   HELIUS_API_KEY=… npm run rpc:check
import { Connection, PublicKey } from '@solana/web3.js';
import { MAINNET_RPC, rpcKind } from '../src/rpc.js';

const SEALING = '7vTTFB3Lu8m2GF65F2oFYgNcKzJsuV7JQTkRBVFYZeXy', TREASURY = 'H2T5YfxqEsJsEX8qq2jBaoacE8DAMQAtNFBvkQtHo6jP';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // any mint will do: DAS lists its holders
const results: boolean[] = [];
const ok = (what: string, pass: boolean, detail = '') => { results.push(pass); console.log(`  ${pass ? '✓' : '✗'} ${what}${detail ? `: ${detail}` : ''}`); };
const ms = async <T>(f: () => Promise<T>) => { const t = performance.now(); const v = await f(); return [v, Math.round(performance.now() - t)] as const; };

console.log(`RPC: ${MAINNET_RPC.replace(/api-key=[^&]+/, 'api-key=••••')} (${rpcKind(MAINNET_RPC)})`);
ok('the key is set and the server would use Helius', rpcKind(MAINNET_RPC) === 'helius', rpcKind(MAINNET_RPC) === 'helius' ? '' : 'HELIUS_API_KEY is empty here');
const c = new Connection(MAINNET_RPC, { commitment: 'confirmed', disableRetryOnRateLimit: true });
try {
  const [v, t] = await ms(() => c.getVersion());
  ok('it answers (getVersion)', !!v['solana-core'], `solana ${v['solana-core']} in ${t} ms`);
  const [slot, t2] = await ms(() => c.getSlot());
  ok('mainnet, current (getSlot)', slot > 300_000_000, `slot ${slot.toLocaleString('en-US')} in ${t2} ms`);
  const [b1] = await ms(() => c.getBalance(new PublicKey(SEALING)));
  const [b2] = await ms(() => c.getBalance(new PublicKey(TREASURY)));
  ok('balances (seals, EXPOSED, the books)', true, `sealing wallet ${b1 / 1e9} SOL · launchpad treasury ${b2 / 1e9} SOL`);
  const [sigs, t3] = await ms(() => c.getSignaturesForAddress(new PublicKey(SEALING), { limit: 5 }));
  ok('history (the books)', sigs.length > 0, `${sigs.length} recent transactions in ${t3} ms`);
  const [perf] = await ms(() => c.getRecentPerformanceSamples(1));
  ok('performance samples (the watch, the Solana source)', perf.length === 1, `${Math.round((perf[0].numTransactions * 60) / perf[0].samplePeriodSecs).toLocaleString('en-US')} transactions a minute`);
  const [bh] = await ms(() => c.getLatestBlockhash());
  ok('a blockhash (every seal and launch)', !!bh.blockhash);
  const [das, t4] = await ms(async () => (await (await fetch(MAINNET_RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'check', method: 'getTokenAccounts', params: { mint: USDC, limit: 3 } }) })).json()) as { result?: { token_accounts?: unknown[] }; error?: { message: string } });
  ok('DAS getTokenAccounts (holder snapshots)', (das.result?.token_accounts?.length ?? 0) > 0, das.error ? das.error.message : `${das.result?.token_accounts?.length} holders listed in ${t4} ms`);
  const burst = await Promise.allSettled(Array.from({ length: 25 }, () => c.getSlot()));
  const limited = burst.filter((r) => r.status === 'rejected' && /429/.test(String(r.reason))).length;
  ok('25 calls at once without a rate limit (a seal backlog, a busy launch)', limited === 0, `${25 - limited}/25 answered`);
} catch (e) { ok('the RPC answered', false, (e as Error).message.replace(/api-key=[^&\s]+/, 'api-key=••••').slice(0, 200)); }
const failed = results.filter((r) => !r).length;
console.log(failed ? `\nRPC CHECK: ${failed} FAILED` : `\nRPC CHECK PASSED (${results.length})`);
process.exit(failed ? 1 : 0);
