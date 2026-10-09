// Layout parity: DOM anchors, type and motion styles of the chrome at 1920 / 1440 / 768 / 390 for both apps.
// Content differs by design (Overmind copy and wordmark), so edges that anchor to the layout are compared, not widths.
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, open } from './lib.mjs';

const VIEWPORTS = [
  { name: '1920', width: 1920, height: 1080 },
  { name: '1440', width: 1440, height: 900 },
  { name: '768', width: 768, height: 1024, touch: true },
  { name: '390', width: 390, height: 844, touch: true, mobile: true },
];
const MAP = { reference: { logo: '.logo', contact: '.email', copy: '.copy', sound: '.sound', bars: '.bars' }, overmind: { logo: '.logo', contact: '.contact', copy: '.copy', sound: '.sound', bars: '.bars' } };

const measure = (sel) => {
  const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, top: r.top, right: innerWidth - r.right, bottom: innerHeight - r.bottom, width: r.width, height: r.height }; };
  const st = (s, pseudo) => { const c = getComputedStyle(document.querySelector(s), pseudo); return { fontSize: c.fontSize, lineHeight: c.lineHeight, letterSpacing: c.letterSpacing, color: c.color, maxWidth: c.maxWidth, textWrap: c.textWrap, transition: c.transition, outlineOffset: c.outlineOffset, padding: c.padding }; };
  return {
    logo: box(sel.logo), contact: box(sel.contact), copy: box(sel.copy), sound: box(sel.sound), bars: box(sel.bars),
    styles: { copy: st(sel.copy), contact: st(sel.contact), underline: st(sel.contact, '::after'), chrome: st('.chrome'), canvas: st('.canvas'), bar: st(sel.bars + ' span') },
  };
};

const browser = await launch();
const out = {};
for (const vp of VIEWPORTS) {
  out[vp.name] = {};
  for (const which of ['reference', 'overmind']) {
    const { context, page } = await open(browser, which, vp);
    await page.waitForTimeout(2800);
    out[vp.name][which] = await page.evaluate(measure, MAP[which]);
    await context.close();
  }
}
await browser.close();

const rows = [];
const check = (vp, label, a, b, tol = 1) => rows.push({ viewport: vp, check: label, reference: a, overmind: b, pass: typeof a === 'number' ? Math.abs(a - b) <= tol : a === b });
for (const vp of Object.keys(out)) {
  const r = out[vp].reference, o = out[vp].overmind;
  check(vp, 'logo left', +r.logo.left.toFixed(1), +o.logo.left.toFixed(1));
  check(vp, 'logo top', +r.logo.top.toFixed(1), +o.logo.top.toFixed(1));
  check(vp, 'logo height', +r.logo.height.toFixed(1), +o.logo.height.toFixed(1));
  check(vp, 'contact right gutter', +r.contact.right.toFixed(1), +o.contact.right.toFixed(1));
  check(vp, 'contact top', +r.contact.top.toFixed(1), +o.contact.top.toFixed(1));
  check(vp, 'copy left', +r.copy.left.toFixed(1), +o.copy.left.toFixed(1));
  check(vp, 'copy bottom gutter', +r.copy.bottom.toFixed(1), +o.copy.bottom.toFixed(1));
  check(vp, 'sound box right', +r.sound.right.toFixed(1), +o.sound.right.toFixed(1));
  check(vp, 'sound box bottom', +r.sound.bottom.toFixed(1), +o.sound.bottom.toFixed(1));
  check(vp, 'bars size', `${r.bars.width}×${r.bars.height}`, `${o.bars.width}×${o.bars.height}`);
  check(vp, 'copy font-size / line-height', `${r.styles.copy.fontSize} / ${r.styles.copy.lineHeight}`, `${o.styles.copy.fontSize} / ${o.styles.copy.lineHeight}`);
  check(vp, 'copy tracking / max-width / wrap', `${r.styles.copy.letterSpacing} / ${r.styles.copy.maxWidth} / ${r.styles.copy.textWrap}`, `${o.styles.copy.letterSpacing} / ${o.styles.copy.maxWidth} / ${o.styles.copy.textWrap}`);
  check(vp, 'ink colour', r.styles.copy.color, o.styles.copy.color);
  check(vp, 'chrome padding', r.styles.chrome.padding, o.styles.chrome.padding);
  check(vp, 'underline transition', r.styles.underline.transition, o.styles.underline.transition);
  check(vp, 'reveal transitions', `${r.styles.canvas.transition} | ${r.styles.chrome.transition}`, `${o.styles.canvas.transition} | ${o.styles.chrome.transition}`);
}
mkdirSync('verification/out', { recursive: true });
writeFileSync('verification/out/layout-parity.json', JSON.stringify({ rows, raw: out }, null, 1));
console.table(rows.filter((r) => !r.pass).length ? rows.filter((r) => !r.pass) : [{ all: `${rows.length} checks passed` }]);
console.log(`${rows.filter((r) => r.pass).length}/${rows.length} pass`);
