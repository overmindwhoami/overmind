// The archivist experience end to end: live top, write pulse, hover a sealed disk, read one in the machine
// (directory, entry, eject), and the lineage further down. Usage: OVERMIND_URL=... node verification/archive-flow.mjs [tag]
import { mkdirSync } from 'node:fs';
import { launch } from './lib.mjs';

const BASE = process.env.OVERMIND_URL ?? 'http://127.0.0.1:5173/';
const tag = process.argv[2] ?? 'flow';
const OUT = new URL(`./out/${tag}/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE + '?verify&speed=' + (process.env.SPEED ?? '20'), { waitUntil: 'load' });
await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'), null, { timeout: 90000 });
const shot = async (name, wait = 0) => { if (wait) await page.waitForTimeout(wait); await page.screenshot({ path: `${OUT}${name}.png` }); console.log('shot', name); };
const info = () => page.evaluate(() => { const a = window.__overmind; const c = a.archive.current(); return { disk: c.disk, written: c.written, sealed: a.tower.count, h: +a.cameraHeight.toFixed(2), range: a.tower.range, calls: a.renderer.info.render.calls, tris: a.renderer.info.render.triangles, hover: a.hover?.slab.index ?? null, phase: a.station.phase }; });
await shot('01-live-top', 2500);
console.log(JSON.stringify(await info()));
await shot('02-pulse', 3200);
// scroll a little way down the lineage, then hover a sealed disk
await page.mouse.move(720, 450);
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(40); }
await page.waitForTimeout(2200);
const target = await page.evaluate(() => {
  const a = window.__overmind;
  const ndc = (i) => new a.camera.position.constructor().setFromMatrixPosition(a.tower.worldMatrix(i, new a.camera.matrixWorld.constructor())).project(a.camera);
  const c = a.tower.instances.filter((i) => i.slab.index !== a.tower.count).map((i) => ({ i, v: ndc(i) })).filter((c) => Math.abs(c.v.x) < 0.9 && Math.abs(c.v.y) < 0.9).sort((p, q) => Math.hypot(p.v.x, p.v.y) - Math.hypot(q.v.x, q.v.y));
  const hit = c.find((c) => { a.pointerTarget.set(c.v.x, c.v.y); const hit = a.pick(); return hit?.slab === c.i.slab; });
  a.pointerTarget.set(0, 0);
  return hit && { x: (hit.v.x * 0.5 + 0.5) * innerWidth, y: (-hit.v.y * 0.5 + 0.5) * innerHeight, n: hit.i.slab.index };
});
console.log('target', JSON.stringify(target));
if (target) {
  await page.mouse.move(target.x, target.y); await shot('03-hover-sealed', 1400);
  await page.mouse.down(); await page.mouse.up();
  await shot('04-flying', 700);
  await shot('05-reading-dir', 2600);
  console.log(JSON.stringify(await info()));
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  await shot('06-reading-entry', 900);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await shot('07-ejecting', 800);
  await shot('08-back', 2200);
}
await page.mouse.move(200, 450);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(60); }
await shot('09-lineage', 2200);
console.log(JSON.stringify(await info()));
console.log('errors:', errors.length ? errors.slice(0, 6).join('\n') : 'none');
await browser.close();
