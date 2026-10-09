// Mobile check: phone (390×844 @3×, touch) and tablet (768×1024 @2×, touch) with 4× CPU throttling.
// Captures idle, first tap (instrument) and second tap (inspect), and reports load phases and frame times.
// Usage: OVERMIND_URL=http://localhost:4173/ node verification/mobile-check.mjs [tag]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.OVERMIND_URL ?? 'http://127.0.0.1:4173/';
const tag = process.argv[2] ?? 'mobile';
const OUT = new URL(`./out/${tag}/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const DEVICES = [
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
  { name: 'tablet', viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2 },
];
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = {};
for (const d of DEVICES) {
  const context = await browser.newContext({ ...d, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(BASE + '?verify&speed=20', { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'), null, { timeout: 90000 });
  const ready = Date.now() - t0;
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}${d.name}-idle.png` });
  await page.touchscreen.tap(Math.round(d.viewport.width / 2), Math.round(d.viewport.height * 0.25)); // nothing: just wake
  await page.evaluate(() => { const a = window.__overmind; a.cameraHeightTarget -= 0.6; });
  await page.waitForTimeout(2200);
  const frames = await page.evaluate(() => new Promise((res) => { const ts = []; const tick = (t) => { ts.push(t); if (ts.length < 120) requestAnimationFrame(tick); else res(ts.slice(1).map((v, i) => v - ts[i]).sort((a, b) => a - b)); }; requestAnimationFrame(tick); }));
  const info = await page.evaluate(() => { const a = window.__overmind; const m = (n) => performance.getEntriesByName(n)[0]?.startTime ?? NaN; return { ratio: a.renderer.getPixelRatio(), calls: a.renderer.info.render.calls, tris: a.renderer.info.render.triangles, visible: a.tower.instances.length, fov: +a.camera.fov.toFixed(1), quality: new URLSearchParams(location.search).get('quality'), tower: Math.round(m('tower:end') - m('tower:start')), labels: Math.round(m('labels:end') - m('labels:start')) }; });
  // tap the replica nearest the centre whose centre the pick ray actually hits
  const target = await page.evaluate(() => {
    const a = window.__overmind;
    const ndc = (i) => new a.camera.position.constructor().setFromMatrixPosition(a.tower.worldMatrix(i, new a.camera.matrixWorld.constructor())).project(a.camera);
    const c = a.tower.instances.filter((i) => i.slab.index !== a.tower.count).map((i) => ({ i, v: ndc(i) })).filter((c) => Math.abs(c.v.x) < 0.85 && Math.abs(c.v.y) < 0.85).sort((p, q) => Math.hypot(p.v.x, p.v.y) - Math.hypot(q.v.x, q.v.y));
    const hit = c.find((c) => { a.pointerTarget.set(c.v.x, c.v.y); return a.pick()?.slab === c.i.slab; });
    a.pointerTarget.set(0, 0);
    return hit && { x: (hit.v.x * 0.5 + 0.5) * innerWidth, y: (-hit.v.y * 0.5 + 0.5) * innerHeight };
  });
  if (target) {
    await page.touchscreen.tap(target.x, target.y);
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${OUT}${d.name}-select.png` });
    await page.touchscreen.tap(target.x, target.y);
    await page.waitForTimeout(3200);
    await page.screenshot({ path: `${OUT}${d.name}-inspect.png` });
    const sz = await page.evaluate(() => { const a = window.__overmind; const r = a.station.readerCamera(a.camera); return { phase: a.station.phase, distance: +r.distance.toFixed(2) }; });
    console.log(d.name, 'reader', JSON.stringify(sz));
    // tap the first directory row on the tube
    await page.evaluate(() => { const a = window.__overmind; a.station.act({ kind: 'row', index: Math.max(0, a.archive.written(a.station.disk).length - 1) }); });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}${d.name}-entry.png` });
  }
  const pct = (q) => +frames[Math.floor(frames.length * q)].toFixed(1);
  report[d.name] = { readyMs: ready, frameMedian: pct(0.5), frameP95: pct(0.95), ...info, tapped: !!target, errors };
  await context.close();
}
await browser.close();
writeFileSync(`${OUT}report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
