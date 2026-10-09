// Motion parity: the same timed inputs drive the reference and Overmind; every damped value is compared frame by frame.
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, open, freeze } from './lib.mjs';

const EXPERIMENTS = `
window.__experiments = {
  reset(h) {
    const a = window.__A;
    a.cameraHeight = a.cameraHeightTarget = h; a.spin = 0; a.elapsed = 0; a.spinBoost = 0; a.hoverSpin = 1; a.dragVelocity = 0;
    a.focused = undefined; a.hover = undefined; a.isDragging = false; a.pressDistance = 0; a.isPointerInside = false;
    a.pointer.set(0, 0); a.pointerTarget.set(0, 0); window.__step(3);
  },
  sample(n, f) { const out = []; for (let i = 0; i < n; i++) { window.__step(1); out.push(f()); } return out; },
  ev(type, x, y, ts) { return { type, clientX: x, clientY: y, timeStamp: ts, pointerType: 'mouse', target: document.body }; },
  run() {
    const a = window.__A, X = window.__experiments, h0 = a.cameraHeight, out = {};
    const wheel = (schedule, n) => { X.reset(h0); const rows = []; for (let f = 0; f < n; f++) { for (const s of schedule) if (s[0] === f) a.onWheel({ deltaY: s[1] }); window.__step(1); rows.push(a.cameraHeight - h0); } return rows; };
    out.wheelSingle = wheel([[0, 100]], 120);
    out.wheelFive = wheel([[0, 100], [5, 100], [10, 100], [14, 100], [19, 100]], 150);
    out.wheelFlick = wheel([[0, 1000]], 120);
    X.reset(h0); a.onKeyDown({ key: 'ArrowDown' }); out.arrowDown = X.sample(90, () => a.cameraHeight - h0);
    X.reset(h0); a.onKeyDown({ key: 'ArrowRight' }); out.arrowRightSpin = X.sample(240, () => a.spinVelocity);
    X.reset(h0); a.onPointerMove(X.ev('pointermove', innerWidth, 0, 1000)); a.isPointerInside = false;
    out.pointerX = X.sample(120, () => a.pointer.x); X.reset(h0); a.onPointerMove(X.ev('pointermove', innerWidth, 0, 1000)); a.isPointerInside = false;
    out.cameraX = X.sample(120, () => a.camera.position.x);
    X.reset(h0); out.cameraYOffset = X.sample(60, () => a.camera.position.y - a.cameraHeight);
    X.reset(h0); let ts = 2000; a.onPointerDown(X.ev('pointerdown', 400, 450, ts));
    for (let i = 1; i <= 10; i++) { ts += 1000 / 60; a.onPointerMove(X.ev('pointermove', 400 + i * 40, 450, ts)); window.__step(1); }
    a.onPointerUp(X.ev('pointerup', 800, 450, ts + 5)); a.isPointerInside = false;
    out.dragRelease = X.sample(240, () => a.spinVelocity);
    X.reset(h0); ts = 5000; a.onPointerDown(X.ev('pointerdown', 720, 300, ts));
    for (let i = 1; i <= 10; i++) { ts += 1000 / 60; a.onPointerMove(X.ev('pointermove', 720, 300 + i * 30, ts)); window.__step(1); }
    a.onPointerUp(X.ev('pointerup', 720, 600, ts + 5)); a.isPointerInside = false;
    out.verticalDragTarget = [a.cameraHeightTarget - h0];
    // focus: normalised travel of height (k=3) and turn (k=4); attention brake and reticle under focus
    X.reset(h0);
    if (window.__which === 'reference') window.dispatchEvent(new CustomEvent('projectfocus', { detail: 20 })); else a.focus(20);
    const fh0 = a.cameraHeight, ft = a.cameraHeightTarget, fs0 = a.spin, fst = a.focusSpin;
    const rows = X.sample(150, () => [(a.cameraHeight - fh0) / (ft - fh0), (a.spin - fs0) / (fst - fs0), a.hoverSpin, a.tracker.reticle]);
    out.focusHeight = rows.map((r) => r[0]); out.focusTurn = rows.map((r) => r[1]); out.attentionBrake = rows.map((r) => r[2]); out.reticle = rows.map((r) => r[3]);
    return out;
  },
};`;

const browser = await launch();
const results = {};
for (const which of ['reference', 'overmind']) {
  const { context, page } = await open(browser, which);
  await page.addScriptTag({ content: EXPERIMENTS });
  await freeze(page, { height: 0 }); // same start height for both apps (away from the loop seam)
  results[which] = await page.evaluate(() => window.__experiments.run());
  await context.close();
}
await browser.close();
const rows = Object.keys(results.reference).map((k) => {
  const r = results.reference[k], o = results.overmind[k];
  const n = Math.min(r.length, o.length);
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(r[i] - o[i]));
  const range = Math.max(...r.map(Math.abs)) || 1;
  return { series: k, samples: n, maxAbsDiff: +max.toExponential(2), relative: +(max / range).toExponential(2), pass: max / range < 1e-3 };
});
mkdirSync('verification/out', { recursive: true });
writeFileSync('verification/out/motion-parity.json', JSON.stringify({ rows, results }, null, 1));
console.table(rows);
