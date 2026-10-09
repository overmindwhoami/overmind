// Hides one floppy part at a time and reports the share of blown-out pixels, to find over-bright materials.
import { mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { freeze, launch, open } from './lib.mjs';

const OUT = new URL('./out/isolate/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await launch();
const { page } = await open(browser, 'overmind', { width: 1440, height: 900 });
await freeze(page, { height: 0 });
const names = ['shell', 'shutter', 'hub', 'media', 'liner', 'slider', 'label', 'glass'];
const blown = (buf) => { const p = PNG.sync.read(buf); let n = 0; for (let i = 0; i < p.data.length; i += 4) if (p.data[i] > 250 && p.data[i + 1] > 250) n++; return (n / (p.width * p.height) * 100).toFixed(2) + '%'; };
for (const [h, spin] of [[0, 1.2], [2.2, 2.4]]) {
  const row = [];
  for (const hide of [-1, ...names.keys()]) {
    const buf = await page.evaluate(([h, spin, hide]) => {
      const a = window.__A; a.cameraHeight = a.cameraHeightTarget = h; a.spin = spin;
      a.tower.parts.forEach((p, i) => { p.mesh.visible = i !== hide; });
      window.__step(4);
    }, [h, spin, hide]).then(() => page.screenshot({ path: `${OUT}h${h}_${hide < 0 ? 'all' : 'no-' + names[hide]}.png` }));
    row.push(`${hide < 0 ? 'all' : 'no-' + names[hide]}=${blown(buf)}`);
  }
  console.log(`h${h}:`, row.join('  '));
}
await browser.close();
