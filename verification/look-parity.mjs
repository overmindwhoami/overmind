// Look parity: tonal profile of the rendered world across one full loop of each tower (12 heights, frozen spin and drift).
// The objects differ by design (glass replica slabs vs cassettes), so the comparison is statistical, not per pixel.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { launch, open, freeze } from './lib.mjs';

const SAMPLES = 12;
const browser = await launch();
const stats = {};
mkdirSync('verification/out/look', { recursive: true });
for (const which of ['reference', 'overmind']) {
  const { context, page } = await open(browser, which);
  await freeze(page, { height: 0 });
  await page.addStyleTag({ content: '.chrome, .tracker, .poster { display: none !important }' });
  const period = await page.evaluate(() => window.__A.tower.height);
  const L = [];
  let chromaMax = 0;
  const perFrame = [];
  for (let i = 0; i < SAMPLES; i++) {
    const h = -period / 2 + (period * (i + 0.5)) / SAMPLES;
    await page.evaluate((h) => { const a = window.__A; a.cameraHeight = a.cameraHeightTarget = h; a.spin = 0; a.elapsed = 0; window.__step(4); }, h);
    const file = `verification/out/look/${which}-${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: file });
    const png = PNG.sync.read(readFileSync(file));
    let sum = 0, n = 0;
    for (let y = 60; y < 800; y += 2) for (let x = 450; x < 1300; x += 2) {
      const k = (y * png.width + x) * 4, r = png.data[k] / 255, g = png.data[k + 1] / 255, b = png.data[k + 2] / 255;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      L.push(l); sum += l; n++;
      chromaMax = Math.max(chromaMax, Math.max(r, g, b) - Math.min(r, g, b));
    }
    perFrame.push(sum / n);
  }
  L.sort((a, b) => a - b);
  const q = (p) => +L[Math.min(L.length - 1, Math.floor((p / 100) * L.length))].toFixed(3);
  const share = (f) => +((L.filter(f).length / L.length) * 100).toFixed(1);
  const mean = L.reduce((a, b) => a + b, 0) / L.length;
  stats[which] = {
    period: +period.toFixed(4), median: q(50), p75: q(75), p90: q(90), p95: q(95), mean: +mean.toFixed(3),
    nearBlackPct: share((v) => v < 0.05), shadowPct: share((v) => v < 0.15), highlightPct: share((v) => v > 0.8), clippedPct: share((v) => v > 0.98),
    chromaMax: +chromaMax.toFixed(4), frameMeanRange: [Math.min(...perFrame), Math.max(...perFrame)].map((v) => +v.toFixed(3)),
  };
  await context.close();
}
await browser.close();
writeFileSync('verification/out/look-parity.json', JSON.stringify(stats, null, 1));
console.table(stats);
