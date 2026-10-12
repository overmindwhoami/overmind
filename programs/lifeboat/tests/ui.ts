// The vending machine's panel, end to end, against a local validator running the lifeboat program (no real network):
//   npx tsx programs/lifeboat/tests/ui.ts      (the site's dev server on :5173)
// A Wallet Standard test wallet signs with a funded local key, as Phantom would.
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Connection, Keypair, LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
import { PROGRAM_ID, vaultOf } from '../../../src/lifeboat/vault';
import { readTicket } from '../../../src/lifeboat/ticket';

const OUT = process.argv[2] ?? tmpdir();
const SO = new URL('../target/deploy/lifeboat.so', import.meta.url).pathname;
const ledger = mkdtempSync(join(tmpdir(), 'lifeboat-ui-'));
execSync('pkill -f solana-test-validator || true');
const validator = spawn('solana-test-validator', ['--reset', '--quiet', '--ledger', ledger, '--rpc-port', '8899', '--bpf-program', PROGRAM_ID.toBase58(), SO], { stdio: 'ignore' });
const conn = new Connection('http://127.0.0.1:8899', 'confirmed');
for (let i = 0; i < 60 && !(await conn.getSlot().then(() => true, () => false)); i++) await new Promise((r) => setTimeout(r, 1000));
const results: [string, boolean, string?][] = [];
const check = (n: string, ok: boolean, d?: string) => { results.push([n, ok, d]); console.log(`${ok ? '  ✓' : '  ✗'} ${n}${d ? `: ${d}` : ''}`); };
const kp = Keypair.generate();
await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL), 'confirmed');
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror:', e.message));
  await p.exposeFunction('__sign', (bytes: number[]) => { const t = VersionedTransaction.deserialize(Uint8Array.from(bytes)); t.sign([kp]); return Array.from(t.serialize()); });
  // plain script text: the TypeScript runner would otherwise wrap a function with helpers the page doesn't have
  await p.addInitScript(`
    localStorage.setItem('overmind.seen', String(Date.now()));
    const account = { address: ${JSON.stringify(kp.publicKey.toBase58())}, publicKey: Uint8Array.from(${JSON.stringify(Array.from(kp.publicKey.toBytes()))}), chains: ['solana:devnet'], features: ['solana:signTransaction'] };
    const w = { version: '1.0.0', name: 'Test Wallet', icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=', chains: ['solana:devnet'], accounts: [account],
      features: { 'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
        'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: [0], signTransaction: async (...inputs) => Promise.all(inputs.map(async (i) => ({ signedTransaction: Uint8Array.from(await window.__sign(Array.from(i.transaction))) }))) } } };
    window.addEventListener('wallet-standard:app-ready', (e) => e.detail.register(w));
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: (api) => api.register(w) }));
  `);
  await p.goto('http://localhost:5173/?verify&api=https://archivist-production-ef62.up.railway.app&lifeboat=http://127.0.0.1:8899#mint', { waitUntil: 'load' });
  await p.waitForFunction(() => document.documentElement.classList.contains('is-ready'), null, { timeout: 180000 });
  await p.waitForSelector('.mint [data-print]', { timeout: 30000 });
  await p.waitForTimeout(2000);
  await p.screenshot({ path: `${OUT}/mint-start.png` });
  const save = async (click: () => Promise<void>) => { const [d] = await Promise.all([p.waitForEvent('download'), click()]); const f = await d.path(); return readTicket(readFileSync(f!)); };

  // print a ticket: it downloads, and reads back to the same key
  const t1 = await save(() => p.click('.mint [data-print]'));
  check('printing a ticket downloads it as a floppy image', t1.key.length === 918);
  const [v1] = vaultOf(t1.root);
  check('the panel shows that ticket\'s vault', (await p.textContent('.mint'))!.includes(v1.toBase58().slice(0, 4)));
  await p.click('.mint [data-wallet="0"]');
  await p.fill('.mint [data-in] input', '0.5');
  await p.click('.mint [data-in] button');
  await p.waitForFunction(() => /is in the vault|refused|wrong|cancel/.test(document.querySelector('.mint [data-say]')?.textContent ?? ''), null, { timeout: 60000 });
  const b1 = await conn.getBalance(v1);
  check('putting in 0.5 SOL opens and fills the vault', b1 >= 0.5 * LAMPORTS_PER_SOL, `${b1 / LAMPORTS_PER_SOL} SOL`);

  // take some out: a fresh ticket downloads first; the rest moves to its vault
  await p.waitForSelector('.mint [data-out] input');
  await p.fill('.mint [data-out] input', '0.1');
  const before = await conn.getBalance(kp.publicKey);
  const t2 = await save(() => p.click('.mint [data-out] button'));
  await p.waitForFunction(() => /in your wallet|refused|wrong|cancel/.test(document.querySelector('.mint [data-say]')?.textContent ?? ''), null, { timeout: 90000 });
  const [v2] = vaultOf(t2.root);
  check('taking out 0.1 SOL reaches the wallet', (await conn.getBalance(kp.publicKey)) > before + 0.09 * LAMPORTS_PER_SOL, (await p.textContent('.mint [data-say]')) ?? '');
  check('the old vault is closed', (await conn.getAccountInfo(v1)) === null);
  check('the rest is in the new ticket\'s vault', (await conn.getBalance(v2)) >= 0.39 * LAMPORTS_PER_SOL, `${(await conn.getBalance(v2)) / LAMPORTS_PER_SOL} SOL`);
  await p.screenshot({ path: `${OUT}/mint-renewed.png` });

  // take everything out with the new ticket
  await p.click('.mint [data-all]');
  await p.waitForFunction(() => /everything is in your wallet|refused|wrong|cancel/.test(document.querySelector('.mint [data-say]')?.textContent ?? ''), null, { timeout: 90000 });
  check('taking everything out empties and closes the vault', (await conn.getAccountInfo(v2)) === null, (await p.textContent('.mint [data-say]')) ?? '');
  await p.screenshot({ path: `${OUT}/mint-done.png` });
} finally {
  await b.close();
  validator.kill('SIGTERM');
}
const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
