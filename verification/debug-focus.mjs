import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:4173/?verify');
await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'));
await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const a = window.__overmind;
  a.focus(30);
  await new Promise((res) => setTimeout(res, 2500));
  const f = a.focused, m = a.tower.worldMatrix({ slab: f.slab, offset: f.offset }, new a.camera.matrixWorld.constructor());
  const p = new a.camera.position.constructor().setFromMatrixPosition(m);
  const ndc = p.clone().project(a.camera);
  const tr = a.tracker;
  return { slabY: f.slab.y, offset: f.offset, camH: a.cameraHeight, target: a.cameraHeightTarget, world: p.toArray().map((v) => +v.toFixed(3)), ndc: ndc.toArray().map((v) => +v.toFixed(3)), spin: a.spin, focusSpin: a.focusSpin, hover: !!a.hover, trackerOpacity: tr.opacity, dim: tr.dim, locked: tr.locked && tr.locked.slab.replica.index, groupY: a.tower.group.position.y };
});
console.log(JSON.stringify(r, null, 1));
await page.screenshot({ path: 'verification/out/smoke/focus-debug.png' });
await browser.close();
