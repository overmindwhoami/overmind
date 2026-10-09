// Performance, head to head: boot milestones, main-thread long tasks, frame times and adaptive pixel ratio (1440×900 @2x).
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { OVERMIND_URL, REFERENCE_URL } from './lib.mjs';

const MARKS = () => {
  window.__perf = { marks: {}, long: [] };
  const mark = (k) => { if (!(k in window.__perf.marks)) window.__perf.marks[k] = Math.round(performance.now()); };
  new PerformanceObserver((l) => l.getEntries().forEach((e) => mark(e.name))).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__perf.long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
  const watch = () => new MutationObserver(() => { if (document.documentElement.classList.contains('is-ready')) mark('ready'); }).observe(document.documentElement, { attributes: true });
  if (document.documentElement) watch(); else document.addEventListener('readystatechange', watch, { once: true });
  document.addEventListener('DOMContentLoaded', () => mark('domcontentloaded'));
};
const frames = (page, n) => page.evaluate((n) => new Promise((res) => {
  const ft = []; let last = performance.now();
  const f = (t) => { ft.push(t - last); last = t; if (ft.length < n) requestAnimationFrame(f); else { const a = ft.slice(5).sort((x, y) => x - y); res({ median: +a[a.length >> 1].toFixed(1), p95: +a[Math.floor(a.length * 0.95)].toFixed(1), max: +a[a.length - 1].toFixed(1) }); } };
  requestAnimationFrame(f);
}), n);

const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const out = {};
for (const [which, url] of [['reference', REFERENCE_URL], ['overmind', OVERMIND_URL]]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.addInitScript(MARKS);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'), null, { timeout: 60000 });
  await page.mouse.move(8, 450);
  const idle = await frames(page, 240);
  const scrollP = frames(page, 120);
  for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(40); }
  const scroll = await scrollP;
  let hoverFrames = null;
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(470 + (i % 8) * 70, 300 + Math.floor(i / 8) * 70);
    const hovering = await page.evaluate(() => document.documentElement.classList.contains('is-hovering'));
    if (hovering) { hoverFrames = await frames(page, 90); break; }
  }
  await page.waitForTimeout(9000);
  const canvas = await page.evaluate(() => { const c = document.querySelector('canvas'); return [c.width, c.height]; });
  const perf = await page.evaluate(() => window.__perf);
  out[which] = {
    firstPaint: perf.marks['first-contentful-paint'], domContentLoaded: perf.marks.domcontentloaded, ready: perf.marks.ready,
    longTasksFirst15s: perf.long.length, longestTaskMs: Math.max(0, ...perf.long.map((l) => l[1])), longTaskTotalMs: perf.long.reduce((s, l) => s + l[1], 0),
    idle, scroll, hover: hoverFrames, pixelRatioAfter15s: +(canvas[0] / 1440).toFixed(2),
  };
  await context.close();
}
await browser.close();
mkdirSync('verification/out', { recursive: true });
writeFileSync('verification/out/perf-parity.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
