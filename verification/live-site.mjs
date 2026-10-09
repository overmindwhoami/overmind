// Checks the deployed site against the live Overmind: it loads, follows the live disk, and reads a sealed disk.
// Usage: SITE_URL=https://site-production-0d2b.up.railway.app/ node verification/live-site.mjs [outDir]
import { launch } from './lib.mjs';
const SITE = process.env.SITE_URL ?? 'https://site-production-0d2b.up.railway.app/';
const OUT = process.argv[2] ?? new URL('./out/', import.meta.url).pathname;
const browser = await launch();
for (const [w, h, name, mobile] of [[1440, 900, 'desk', false], [390, 844, 'phone', true]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile })).newPage();
  const errors = [], failed = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => { if (!r.url().includes('/api/events')) failed.push(`${r.failure()?.errorText} ${r.url()}`); });
  await page.goto(`${SITE}${SITE.includes('?') ? '&' : '?'}verify`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => {
    const a = window.__overmind;
    return { archive: a.archive.constructor.name, current: a.archive.current(), sealed: a.archive.sealedCount(),
      log: document.querySelector('[data-log-head]')?.textContent, count: document.querySelector('[data-log-count]')?.textContent,
      newest: document.querySelector('.log__entry .log__title')?.textContent };
  });
  console.log(name, JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/live-site-${name}.jpg`, quality: 80 });
  if (!mobile && state.sealed > 0) {
    await page.evaluate((n) => window.__overmind.read(n), state.sealed - 1);
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `${OUT}/live-site-read.jpg`, quality: 80 });
    console.log('reader link:', await page.evaluate(() => { const a = document.querySelector('[data-reader-link]'); return a.hidden ? 'hidden' : `${a.textContent} → ${a.href}`; }));
  }
  console.log(name, 'errors:', errors.length ? errors : 'none', '| failed requests:', failed.length ? failed.slice(0, 3) : 'none');
}
await browser.close();
