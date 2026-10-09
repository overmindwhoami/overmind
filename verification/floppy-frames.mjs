// Deterministic tower frames for floppy lookdev: freezes the app at given camera heights and spins.
// Usage: OVERMIND_URL=http://localhost:5173/ node verification/floppy-frames.mjs [tag]
import { mkdirSync } from 'node:fs';
import { freeze, launch, open } from './lib.mjs';

const tag = process.argv[2] ?? 'frames';
const OUT = new URL(`./out/${tag}/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await launch();
const { page } = await open(browser, 'overmind', { width: 1440, height: 900 });
await freeze(page, { height: 0 });
for (const [h, spin] of [[0, 0], [0, 1.2], [1.1, 0.4], [2.2, 2.4], [-1.5, 3.6]]) {
  await page.evaluate(([h, spin]) => { const a = window.__A; a.cameraHeight = a.cameraHeightTarget = h; a.spin = spin; window.__step(4); }, [h, spin]);
  await page.screenshot({ path: `${OUT}h${h}_s${spin}.png` });
}
const info = await page.evaluate(() => { const a = window.__A; return { calls: a.renderer.info.render.calls, tris: a.renderer.info.render.triangles, visible: a.tower.instances.length }; });
console.log(JSON.stringify(info));
await browser.close();
