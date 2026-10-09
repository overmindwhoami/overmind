import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:4173/?verify');
await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'));
await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const a = window.__overmind, tr = a.tracker;
  a.focus(30);
  await new Promise((res) => setTimeout(res, 2500));
  const t = tr.target;
  const cam = a.camera;
  const inst = t.instance;
  const proj = (x, y, z) => { const v = new cam.position.constructor(x * 0.01, y * 0.01, z * 0.01).applyMatrix4(tr.matrix).project(cam); return [+(((v.x * 0.5 + 0.5) * innerWidth).toFixed(0)), +(((-v.y * 0.5 + 0.5) * innerHeight).toFixed(0)), +v.z.toFixed(3)]; };
  return {
    instOffset: inst.offset, instGen: inst.slab.replica.gen,
    matrixPos: [tr.matrix.elements[12], tr.matrix.elements[13], tr.matrix.elements[14]].map((v) => +v.toFixed(3)),
    corners: [[-45, -28], [45, -28], [45, 28], [-45, 28]].map(([x, y]) => proj(x, y, 4.5)),
    center: proj(0, 0, 0),
    box0: t.boxes[0],
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
