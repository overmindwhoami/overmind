// Tonal contribution per floppy part: renders frames with only one part visible and reports luminance stats.
import { PNG } from 'pngjs';
import { freeze, launch, open } from './lib.mjs';

const names = ['shell', 'shutter', 'hub', 'media', 'liner', 'slider', 'label', 'glass'];
const browser = await launch();
const { page } = await open(browser, 'overmind', { width: 1440, height: 900 });
await freeze(page, { height: 0 });
if (process.env.EXCLUDE) await page.evaluate(() => { window.__exclude = true; });
await page.addStyleTag({ content: '.chrome, .tracker, .poster { display: none !important }' });
const stats = (buf) => {
  const p = PNG.sync.read(buf), L = [];
  for (let i = 0; i < p.data.length; i += 4) L.push((0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2]) / 255);
  L.sort((a, b) => a - b);
  const share = (f) => ((L.filter(f).length / L.length) * 100).toFixed(1);
  return { mid: share((v) => v > 0.12 && v < 0.6), high: share((v) => v >= 0.8), mean: (L.reduce((a, b) => a + b, 0) / L.length).toFixed(3) };
};
const rows = {};
for (const only of [-1, ...names.keys()]) {
  const acc = { mid: 0, high: 0, mean: 0 };
  for (const [h, spin] of [[0, 0.6], [1.4, 2.1], [-1.8, 4.2]]) {
    await page.evaluate(([h, spin, only]) => {
      const a = window.__A; a.cameraHeight = a.cameraHeightTarget = h; a.spin = spin;
      a.tower.parts.forEach((p, i) => { p.mesh.visible = only < 0 || (window.__exclude ? i !== only : i === only); });
      window.__step(4);
    }, [h, spin, only]);
    const s = stats(await page.screenshot());
    for (const k of Object.keys(acc)) acc[k] += Number(s[k]) / 3;
  }
  rows[only < 0 ? 'all' : names[only]] = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, +v.toFixed(k === 'mean' ? 3 : 1)]));
}
console.table(rows);
await browser.close();
