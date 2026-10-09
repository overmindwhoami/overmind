// Inspect state on floppies: focuses replicas deterministically and captures the HUD over the turned disk.
import { mkdirSync } from 'node:fs';
import { freeze, launch, open } from './lib.mjs';

const OUT = new URL('./out/focus/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await launch();
const { page } = await open(browser, 'overmind', { width: 1440, height: 900 });
await freeze(page, { height: 0 });
for (const index of (process.argv[2] ?? '59,12,33').split(',').map(Number)) {
  const rep = await page.evaluate((i) => {
    const a = window.__A; a.focus(i);
    for (let k = 0; k < 150; k++) window.__step(1);
    const r = a.tower.slabs.find((s) => s.replica.index === i).replica;
    return { gen: r.gen, strain: r.strain, label: r.label, open: r.open, protect: r.protect, hover: a.hover?.slab.replica.index };
  }, index);
  await page.screenshot({ path: `${OUT}replica-${index}.png` });
  console.log(index, JSON.stringify(rep));
  await page.evaluate(() => { window.__A.blur(); window.__step(30); });
}
await browser.close();
