// Behaviour checks for Overmind's adaptations: reduced motion policy, touch flow at 390 px, opt-in sound, styled fallback.
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, open } from './lib.mjs';

const browser = await launch();
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, pass: !!ok, detail }); };
mkdirSync('verification/out/behaviour', { recursive: true });

{ // Reduced motion
  const { context, page } = await open(browser, 'overmind', { reducedMotion: 'reduce' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => window.__manual(true));
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => {
    const a = window.__overmind; a.hoverSpin = 1; a.spinBoost = 0; window.__step(30);
    const c = getComputedStyle(document.querySelector('.canvas')), u = getComputedStyle(document.querySelector('.contact'), '::after');
    return { motionScale: a.motionScale, spinVelocity: +a.spinVelocity.toFixed(4), shutter: a.composer.u.motion.uShutter.value, canvas: c.transition, underline: u.transition };
  });
  check('reduced: continuous motion ×0.35', r.motionScale === 0.35 && Math.abs(r.spinVelocity - 0.2975) < 1e-3, r);
  check('reduced: motion blur off', r.shutter === 0, { shutter: r.shutter });
  check('reduced: reveal 0.3 s, underline 10 ms', /0\.3s/.test(r.canvas) && /0\.01s/.test(r.underline), { canvas: r.canvas, underline: r.underline });
  await context.close();
}
{ // Touch at 390 px: first tap selects (HUD), second tap on the same slab focuses it; tapping never enables sound
  const { context, page } = await open(browser, 'overmind', { width: 390, height: 844, touch: true, mobile: true });
  await page.waitForTimeout(2600);
  await page.evaluate(() => window.__manual(true));
  await page.waitForTimeout(100);
  const target = await page.evaluate(() => {
    const a = window.__overmind; a.cameraHeight = a.cameraHeightTarget = 0; a.spin = 0; a.motionScale = 0; window.__step(4);
    // the replica nearest the screen centre whose own centre the pick ray actually hits (nothing in front of it)
    const ndc = (i) => new a.camera.position.constructor().setFromMatrixPosition(a.tower.worldMatrix(i, new a.camera.matrixWorld.constructor())).project(a.camera);
    const candidates = a.tower.instances.map((i) => ({ i, v: ndc(i) })).filter((c) => Math.abs(c.v.x) < 0.9 && Math.abs(c.v.y) < 0.9).sort((p, q) => Math.hypot(p.v.x, p.v.y) - Math.hypot(q.v.x, q.v.y));
    const hit = candidates.find((c) => { a.pointerTarget.set(c.v.x, c.v.y); return a.pick()?.slab === c.i.slab; });
    a.pointerTarget.set(0, 0);
    return { x: (hit.v.x * 0.5 + 0.5) * innerWidth, y: (-hit.v.y * 0.5 + 0.5) * innerHeight };
  });
  await page.touchscreen.tap(target.x, target.y);
  await page.evaluate(() => window.__step(40));
  const first = await page.evaluate(() => ({ hover: !!window.__overmind.hover, focused: window.__overmind.station.reading, sound: window.__overmind.sound.enabled }));
  await page.screenshot({ path: 'verification/out/behaviour/touch-select-390.png' });
  await page.touchscreen.tap(target.x, target.y);
  await page.evaluate(() => window.__step(90));
  const second = await page.evaluate(() => ({ reading: window.__overmind.station.reading, sound: window.__overmind.sound.enabled }));
  await page.screenshot({ path: 'verification/out/behaviour/touch-focus-390.png' });
  check('touch: first tap selects and shows the instrument', first.hover && !first.focused, first);
  check('touch: second tap reads the disk in the machine', second.reading, second);
  check('sound stays off until asked for (opt-in)', !first.sound && !second.sound, { first: first.sound, second: second.sound });
  const gutter = await page.evaluate(() => { document.querySelector('.index a').focus(); const r = document.querySelector('.index').getBoundingClientRect(); return { left: r.left, width: r.width }; });
  check('mobile: index honours the 16 px gutter', gutter.left === 16 && gutter.width === 358, gutter);
  await context.close();
}
{ // Fallback styling
  const { context, page } = await open(browser, 'overmind');
  await page.evaluate(() => { document.documentElement.classList.remove('is-ready'); document.documentElement.classList.add('is-unsupported'); document.querySelector('canvas').style.display = 'none'; });
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.fallback')); return { display: c.display, font: c.fontFamily.split(',')[0], size: c.fontSize, color: c.color }; });
  await page.screenshot({ path: 'verification/out/behaviour/fallback.png' });
  check('fallback message uses the type system', s.display === 'block' && s.font === 'Inter' && s.size === '14px', s);
  await context.close();
}
await browser.close();
writeFileSync('verification/out/behaviour-checks.json', JSON.stringify(checks, null, 1));
console.table(checks.map(({ name, pass }) => ({ name, pass })));
