// Smoke test: load the built site, collect console errors, capture idle / hover / focus frames at 1440×900.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = process.env.OVERMIND_URL ?? 'http://127.0.0.1:4173/';
const out = resolve(process.argv[2] ?? 'verification/out/smoke');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const t0 = Date.now();
await page.goto(URL + '?verify', { waitUntil: 'load' });
await page.waitForFunction(() => /is-ready|is-unsupported/.test(document.documentElement.className), null, { timeout: 60000 });
console.log('state', await page.evaluate(() => document.documentElement.className), 'in', Date.now() - t0, 'ms');
await page.waitForTimeout(3000);
await page.screenshot({ path: resolve(out, 'idle.png') });
const info = await page.evaluate(() => { const a = window.__overmind; return { calls: a.renderer.info.render.calls, tris: a.renderer.info.render.triangles, visible: a.tower.instances.length, h: +a.cameraHeight.toFixed(3), period: a.tower.height, ratio: a.renderer.getPixelRatio() }; });
console.log('info', JSON.stringify(info));
let hovered = null;
for (let i = 0; i < 40 && !hovered; i++) {
  await page.mouse.move(480 + (i % 8) * 70, 300 + Math.floor(i / 8) * 70);
  await page.waitForTimeout(90);
  hovered = await page.evaluate(() => window.__overmind.hover && window.__overmind.hover.slab.replica.gen);
}
console.log('hover gen', hovered);
await page.waitForTimeout(900);
await page.screenshot({ path: resolve(out, 'hover.png') });
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(2200);
console.log('focused', await page.evaluate(() => window.__overmind.focused && window.__overmind.focused.slab.replica.gen));
await page.screenshot({ path: resolve(out, 'focus.png') });
console.log('errors:', errors.length ? '\n' + [...new Set(errors)].join('\n') : 'none');
await browser.close();
