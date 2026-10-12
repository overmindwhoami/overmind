#!/usr/bin/env node
// Verifies a sealed Overmind disk without trusting the Overmind: downloads the disk's record, hashes it here, and
// compares the hash with the fingerprint the archive reports and with the memo the sealing wallet wrote on Solana.
//   node verify/verify.mjs 86        (Node 18 or newer, no dependencies)
import { createHash } from 'node:crypto';

const API = process.env.OVERMIND_API ?? 'https://archivist-production-ef62.up.railway.app';
const RPC = process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
const n = Number(process.argv[2]);
if (!Number.isInteger(n) || n < 1) { console.error('usage: node verify/verify.mjs <disk number>'); process.exit(2); }

const json = async (url, init) => { const r = await fetch(url, init); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };
const [disk] = await json(`${API}/api/disks?from=${n - 1}&to=${n - 1}`);
if (!disk?.sealed) { console.log(`disk ${String(n).padStart(4, '0')} isn't sealed yet`); process.exit(1); }

const record = await (await fetch(`${API}/api/disks/${n - 1}/record`)).text();
const hash = createHash('sha256').update(record).digest('hex');
console.log(`disk ${String(n).padStart(4, '0')} · ${Buffer.byteLength(record).toLocaleString('en-US')} bytes, ${JSON.parse(record).length} records`);
console.log(`sha256, worked out here   ${hash}`);
console.log(`fingerprint at sealing    ${disk.fingerprint}`);
console.log(hash === disk.fingerprint ? 'MATCH: the record is exactly what was sealed' : 'MISMATCH: the record changed after sealing');

const sig = disk.chain?.tx;
if (!sig) { console.log('on Solana: no seal transaction yet'); process.exit(hash === disk.fingerprint ? 0 : 1); }
const tx = await json(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig, { encoding: 'json', maxSupportedTransactionVersion: 0 }] }) });
const memo = tx.result?.meta?.logMessages?.find((l) => l.includes('Program log: Memo'));
console.log(`on Solana                 ${memo ? memo.slice(memo.indexOf('"') + 1, -1) : '(no memo found)'}`);
console.log(`                          https://explorer.solana.com/tx/${sig}`);
const onChain = !!memo && memo.includes(`sha256:${hash}`);
console.log(onChain ? 'MATCH: the memo on Solana carries the same fingerprint' : 'MISMATCH: the memo on Solana does not carry this fingerprint');
process.exit(hash === disk.fingerprint && onChain ? 0 : 1);
