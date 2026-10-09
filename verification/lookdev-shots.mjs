// Lookdev captures: renders lookdev.html presets through the production lighting and post chain.
// Usage: node verification/lookdev-shots.mjs [name=query ...]   (dev server on :5173)
import { mkdirSync } from 'node:fs';
import { launch } from './lib.mjs';

const BASE = process.env.LOOKDEV_URL ?? 'http://127.0.0.1:5173/lookdev.html';
const OUT = new URL('./out/lookdev/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const DEFAULT = {
  front: 'view=single&shell=2&rx=-6&ry=10',
  back: 'view=single&shell=2&side=0&rx=-6&ry=10',
  hero: 'view=single&shell=2&rx=-58&ry=28&rz=8&d=1.6',
  row: 'view=row',
  rowBack: 'view=row&side=0',
  stack: 'view=stack',
};
const args = process.argv.slice(2);
const shots = args.length ? Object.fromEntries(args.map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; })) : DEFAULT;
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: Number(process.env.W ?? 1200), height: Number(process.env.H ?? 900) }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
for (const [name, query] of Object.entries(shots)) {
  const t0 = Date.now();
  await page.goto(`${BASE}?${query}&dpr=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(`${name}: ${Date.now() - t0} ms`);
}
if (errors.length) console.log('console:', [...new Set(errors)].slice(0, 12).join('\n'));
await browser.close();
