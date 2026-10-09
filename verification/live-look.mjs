// Screenshots of the top of the lineage (the live disk and the write log) for look development.
// Usage: OVERMIND_URL=http://127.0.0.1:5173/ node verification/live-look.mjs <outDir> [pitch,pitch,...]
import { launch } from './lib.mjs';
const BASE = process.env.OVERMIND_URL ?? 'http://127.0.0.1:5173/';
const OUT = process.argv[2] ?? new URL('./out/', import.meta.url).pathname;
const pitches = (process.argv[3] ?? '').split(',').filter(Boolean).map(Number);
const minutes = 33 * 90 + 60.5;
const epoch = new Date(Date.now() - minutes * 60000).toISOString();
const browser = await launch();
for (const [w, h, name, mobile] of [[1440, 900, 'desk', false], [390, 844, 'phone', true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?verify&epoch=${encodeURIComponent(epoch)}${process.env.QUERY ?? ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'), null, { timeout: 90000 });
  if (!mobile) await page.mouse.move(w * 0.16, h * 0.5);
  await page.waitForTimeout(2500);
  for (const p of pitches.length ? pitches : [NaN]) {
    if (!Number.isNaN(p)) await page.evaluate(async (p) => { (await import('/src/engine/tower.ts')).LIVE_POSE.pitch = p; }, p);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${name}${Number.isNaN(p) ? '' : '_' + p}.jpg`, quality: 80 });
  }
  console.log(name, 'errors:', errors.length ? errors : 'none');
  await ctx.close();
}
await browser.close();
