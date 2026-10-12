// The site's launch flow, driven like a person would, against the rehearsal's fork (npm run lp:rehearse -- --hold, then
// the server on :8787 with .rehearse/server.env.json, and the site on :5173). Three test wallets stand in for Phantom,
// Solflare and Backpack: they register through the Wallet Standard and really sign (with .rehearse/ui-*.json), so the
// launch goes through the same pump.fun programs as mainnet. Each launches a coin with a picture, an X handle and a
// website, makes a first buy, and the coin is then checked on the fork, in the metadata pump.fun reads, and on the wall.
//   npx tsx scripts/ui-launch.ts [site] [out-dir]
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import sharp from 'sharp';
import { webkit, devices } from 'playwright';

const SITE = process.argv[2] ?? 'http://localhost:5173/?api=http://localhost:8787';
const OUT = process.argv[3] ?? '/tmp';
const DIR = new URL('../.rehearse/', import.meta.url).pathname;
const API = 'http://localhost:8787';
const fork = new Connection('http://127.0.0.1:8899', 'confirmed');
const keyOf = (n: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${DIR}ui-${n}.json`, 'utf8'))));
const WALLETS = [['Phantom', 'phantom', 'PHNTM', '#7c5cff'], ['Solflare', 'solflare', 'SFLR', '#fc7227'], ['Backpack', 'backpack', 'BPACK', '#e33e3f']] as const;
const results: { what: string; ok: boolean; detail?: string }[] = [];
const check = (what: string, ok: boolean, detail?: unknown) => { results.push({ what, ok, detail: detail === undefined ? undefined : String(detail).slice(0, 160) }); console.log(`  ${ok ? '✓' : '✗'} ${what}${detail === undefined ? '' : `: ${String(detail).slice(0, 160)}`}`); };

const keys = Object.fromEntries(WALLETS.map(([name, file]) => [name, keyOf(file)]));
// the wallets, as an extension would register them: connect gives the address, signing goes back to node to sign
const init = `(() => {
  const ws = ${JSON.stringify(WALLETS.map(([name, , , colour]) => ({ name, address: keys[name].publicKey.toBase58(), colour })))};
  const b64 = (u) => { let s = ''; for (const b of u) s += String.fromCharCode(b); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  for (const w of ws) {
    const account = { address: w.address, publicKey: new Uint8Array(32), chains: ['solana:mainnet'], features: ['solana:signTransaction'] };
    const wallet = { version: '1.0.0', name: w.name, chains: ['solana:mainnet', 'solana:devnet'], accounts: [],
      icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="' + w.colour + '"/></svg>'),
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
        'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy', 0], signTransaction: async (...inputs) => {
          const signed = await window.omdSign(w.name, inputs.map((i) => b64(i.transaction)));
          return signed.map((s) => ({ signedTransaction: unb64(s) }));
        } },
      } };
    const register = (api) => api.register(wallet);
    window.addEventListener('wallet-standard:app-ready', (e) => register(e.detail));
    try { window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register })); } catch {}
  }
})();`;

const browser = await webkit.launch();
for (const [i, [name, , ticker, colour]] of WALLETS.entries()) {
  const phone = i === 2;
  console.log(`\n— ${name} (${phone ? 'phone' : 'desktop'}) launches $${ticker}`);
  const ctx = await browser.newContext(phone ? { ...devices['iPhone 15 Pro'] } : { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.exposeFunction('omdSign', (who: string, txs: string[]) => txs.map((t) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(t, 'base64'));
    tx.sign([keys[who]]);
    return Buffer.from(tx.serialize()).toString('base64');
  }));
  await page.addInitScript(init);
  await page.goto(`${SITE}#launch`, { waitUntil: 'load' });
  await page.waitForSelector('.lp__form', { timeout: 60_000 });
  await page.waitForTimeout(3000);
  const picture = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${colour}"/><text x="200" y="250" font-size="120" text-anchor="middle" fill="#fff" font-family="Helvetica">${ticker.slice(0, 2)}</text></svg>`)).png().toBuffer();
  await page.setInputFiles('.lp__form [data-file]', { name: 'picture.png', mimeType: 'image/png', buffer: picture });
  await page.fill('.lp__form [name=name]', `${name} Test`);
  await page.fill('.lp__form [name=ticker]', ticker);
  await page.fill('.lp__form [name=about]', `a coin launched from ${name} on a copy of mainnet`);
  await page.fill('.lp__form [name=x]', `@${name.toLowerCase()}`);
  await page.fill('.lp__form [name=web]', `${name.toLowerCase()}.example.com`);
  const offered = await page.$$eval('.lp__form [data-wallet]', (bs) => bs.map((b) => b.textContent!.trim()));
  check(`${name}: the wallets are offered`, offered.includes(name), offered.join(', '));
  await page.click(`.lp__form [data-wallet]:has-text("${name}")`);
  await page.waitForTimeout(400);
  const go = await page.textContent('.lp__form [data-go]');
  check(`${name}: connected, the launch button is ready`, /launch · about/.test(go ?? ''), go);
  await page.click('.lp__form [data-go]');
  await page.waitForFunction(() => /LAUNCHED/.test(document.querySelector('.sheet:not([hidden]) .sheet__eyebrow')?.textContent ?? '') || document.querySelector('.sheet:not([hidden]) .sheet__say.is-error'), null, { timeout: 120_000 }).catch(() => {});
  const said = await page.evaluate(() => document.querySelector('.sheet:not([hidden])')?.textContent?.replace(/\s+/g, ' ').slice(0, 200));
  check(`${name}: launched through the site`, /LAUNCHED/.test(said ?? ''), said);
  await page.screenshot({ path: `${OUT}/ui-${ticker}-launched.png` });
  // the first buy
  await page.fill('[data-buy] [name=sol]', '0.25');
  await page.click('[data-buy] button[type=submit]');
  await page.waitForFunction(() => /bought|cancel|didn/.test(document.querySelector('.sheet:not([hidden]) [data-say]')?.textContent ?? ''), null, { timeout: 90_000 }).catch(() => {});
  const bought = await page.textContent('.sheet:not([hidden]) [data-say]');
  check(`${name}: first buy`, /bought/.test(bought ?? ''), bought);
  // on the wall
  await page.click('[data-wall]');
  await page.waitForFunction(() => document.querySelector('.sheet.coin .coin__ticker'), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const sheet = await page.evaluate(() => ({ ticker: document.querySelector('.sheet.coin .coin__ticker')?.textContent, links: [...document.querySelectorAll('.sheet.coin .coin__links a')].map((a) => (a as HTMLAnchorElement).href), hash: location.hash }));
  check(`${name}: its disk opens on the wall with its links`, sheet.ticker === `$${ticker}` && sheet.links.length === 2, JSON.stringify(sheet));
  await page.screenshot({ path: `${OUT}/ui-${ticker}-wall.png` });
  const mint = sheet.hash.replace('#coin-', '');
  // the chain and the metadata
  const meta = await (await fetch(`${API}/api/lp/meta/${mint}.json`)).json().catch(() => ({})) as Record<string, string>;
  check(`${name}: metadata carries X and website`, meta.twitter === `https://x.com/${name.toLowerCase()}` && meta.website === `https://${name.toLowerCase()}.example.com/`, `${meta.twitter} ${meta.website}`);
  check(`${name}: metadata picture is the uploaded one`, /\/api\/lp\/media\/[a-f0-9]{64}$/.test(meta.image ?? ''), meta.image);
  const held = await fork.getParsedTokenAccountsByOwner(keys[name].publicKey, { mint: new PublicKey(mint) }).catch(() => ({ value: [] }));
  const amount = held.value[0]?.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
  check(`${name}: the wallet holds its coin on chain`, amount > 0, amount);
  check(`${name}: no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nUI LAUNCH: ${failed.length} FAILED` : `\nUI LAUNCH PASSED (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
