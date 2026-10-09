// Shared harness: opens the reference (projects.bizar.ro, bundle patched to expose its app) or Overmind (?verify),
// with requestAnimationFrame replaced by a manual queue so frames can be stepped at a fixed dt.
import { chromium } from 'playwright';

export const OVERMIND_URL = process.env.OVERMIND_URL ?? 'http://127.0.0.1:4173/';
export const REFERENCE_URL = 'https://projects.bizar.ro/';
const REFERENCE_BUNDLE = 'assets/index-DYQWZS1f.js';
const ANCHOR = 'new gd({after:document.querySelector(`.logo`)});try{new Cp().load().catch(wp)}';
const EXPOSE = 'window.__nav=new gd({after:document.querySelector(`.logo`)});window.__projects=wu;window.__settings=Nu;try{window.__app=new Cp();window.__app.load().catch(wp)}';
const STEPPER = `
  window.__raf = { manual: false, queue: [], t: 0 };
  const _raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { if (window.__raf.manual) { window.__raf.queue.push(cb); return 1; } return _raf(cb); };
  window.__manual = (on) => { window.__raf.manual = on; window.__raf.t = performance.now(); };
  window.__step = (n = 1, dt = 1000 / 60) => { for (let i = 0; i < n; i++) { const q = window.__raf.queue; window.__raf.queue = []; window.__raf.t += dt; for (const cb of q) cb(window.__raf.t); } };
`;

let bundleCache;
async function referenceBundle() {
  if (bundleCache) return bundleCache;
  const src = await (await fetch(REFERENCE_URL + REFERENCE_BUNDLE)).text();
  if (!src.includes(ANCHOR)) throw new Error('Reference bundle changed; update ANCHOR in verification/lib.mjs');
  bundleCache = src.replace(ANCHOR, EXPOSE);
  return bundleCache;
}

export async function launch() {
  return chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
}

/** Opens `which` ('reference' | 'overmind') and resolves once the page is ready. */
export async function open(browser, which, { width = 1440, height = 900, dpr = 1, reducedMotion = 'no-preference', touch = false, mobile = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion, hasTouch: touch, isMobile: mobile });
  const page = await context.newPage();
  await page.addInitScript(STEPPER);
  if (which === 'reference') {
    const body = await referenceBundle();
    await page.route('**/' + REFERENCE_BUNDLE, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body }));
    await page.goto(REFERENCE_URL, { waitUntil: 'load' });
  } else {
    await page.goto(OVERMIND_URL + '?verify', { waitUntil: 'load' });
  }
  await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'), null, { timeout: 60000 });
  await page.evaluate((which) => { window.__A = which === 'reference' ? window.__app : window.__overmind; window.__which = which; }, which);
  return { context, page };
}

/** Freeze both apps into the same deterministic state and switch to manual stepping. */
export async function freeze(page, { height } = {}) {
  await page.waitForTimeout(2600);
  await page.evaluate(() => window.__manual(true));
  await page.waitForTimeout(120);
  await page.evaluate((height) => {
    const a = window.__A;
    if (height !== undefined) a.cameraHeight = a.cameraHeightTarget = height;
    a.spin = 0; a.elapsed = 0; a.spinBoost = 0; a.hoverSpin = 1; a.dragVelocity = 0;
    a.focused = undefined; a.hover = undefined; a.isDragging = false; a.pressDistance = 0;
    a.isPointerInside = false; a.pointer.set(0, 0); a.pointerTarget.set(0, 0);
    window.__step(3);
  }, height);
}
