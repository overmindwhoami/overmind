// Pipeline parity: an identical test scene is rendered by each app's own renderer, lighting rig, environment, glass
// material and post chain from the same frozen state, then the two frames are diffed pixel by pixel.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { launch, open, freeze } from './lib.mjs';

const BUILD = `
window.__buildTestScene = () => {
  const a = window.__A, ref = window.__which === 'reference';
  const parts = ref ? a.tower.parts : [], T = window.__THREE;
  // reference: classes recovered from its own meshes; Overmind (floppy parts) exposes three.js in ?verify mode
  const Mesh = ref ? a.composer.finalPass.constructor : T.Mesh;
  const Box = ref ? parts[6].mesh.geometry.constructor : T.BoxGeometry;
  const Cylinder = ref ? parts[3].mesh.geometry.constructor : T.CylinderGeometry;
  const Standard = ref ? parts[2].mesh.material.constructor : T.MeshStandardMaterial;
  const Basic = ref ? parts[6].mesh.material.constructor : T.MeshBasicMaterial;
  const glassBase = ref ? parts[0].mesh.material : a.tower.glassMaterial;
  const glass = (tint) => { const m = glassBase.clone(); m.onBeforeCompile = glassBase.onBeforeCompile; m.normalMap = null; m.color.setScalar(tint); return m; };
  if (ref) parts.forEach((p) => { p.mesh.visible = false; }); else { a.tower.group.children.forEach((c) => { if (c.isMesh) c.visible = false; }); a.station.root.visible = false; }
  const add = (geo, mat, pos, rot) => { const m = new Mesh(geo, mat); m.position.set(...pos); m.rotation.set(...rot); m.frustumCulled = false; a.scene.add(m); return m; };
  const slab = () => new Box(0.5, 0.32, 0.088);
  const plastic = new Standard({ color: 0xffffff, roughness: 0.38, metalness: 0 });
  const metal = new Standard({ color: 0xcfcfcf, roughness: 0.26, metalness: 1 });
  const glint = new Basic({ color: 0xffffff }); glint.color.setScalar(1.2);
  const hot = new Basic({ color: 0xffffff }); hot.color.setScalar(4);
  add(new Box(0.2, 0.2, 0.2), plastic, [-0.55, 0.28, 0.32], [0.4, 0.6, 0]);
  add(slab(), glass(1.0), [-0.55, 0.28, 0.6], [0.5, 0.35, 0.1]);
  add(slab(), glass(0.32), [0.0, 0.28, 0.6], [0.5, -0.25, 0.05]);
  add(slab(), glass(0.12), [0.55, 0.28, 0.6], [0.45, -0.6, -0.1]);
  add(new Box(0.26, 0.26, 0.26), plastic, [-0.5, -0.24, 0.6], [0.6, 0.7, 0]);
  add(new Cylinder(0.12, 0.12, 0.3, 48, 1), metal, [0.02, -0.24, 0.6], [0.4, 0, 0.3]);
  add(new Box(0.42, 0.03, 0.03), glint, [0.5, -0.16, 0.7], [0, 0, 0.2]);
  add(new Box(0.3, 0.025, 0.025), hot, [0.5, -0.3, 0.7], [0, 0, -0.15]);
  a.motionScale = 0; a.spin = 0; a.elapsed = 0; a.frame = 500;
  window.__step(4);
  return true;
};`;

const browser = await launch();
mkdirSync('verification/out/pipeline', { recursive: true });
const frames = {};
for (const which of ['reference', 'overmind']) {
  const { context, page } = await open(browser, which);
  await page.addScriptTag({ content: BUILD });
  await freeze(page, { height: 0 });
  await page.addStyleTag({ content: '.chrome, .tracker, .poster, .lil-gui { display: none !important }' });
  await page.evaluate(() => window.__buildTestScene());
  const file = `verification/out/pipeline/${which}.png`;
  await page.screenshot({ path: file });
  frames[which] = PNG.sync.read(readFileSync(file));
  await context.close();
}
await browser.close();

const { width, height } = frames.reference;
const diff = new PNG({ width, height });
const differing = pixelmatch(frames.reference.data, frames.overmind.data, diff.data, width, height, { threshold: 0.1 });
writeFileSync('verification/out/pipeline/diff.png', PNG.sync.write(diff));
let sum = 0, sq = 0, maxd = 0;
const a = frames.reference.data, b = frames.overmind.data;
for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] - b[i + c]); sum += d; sq += d * d; maxd = Math.max(maxd, d); }
const n = (a.length / 4) * 3, mse = sq / n;
const result = { pixels: width * height, differingPixels: differing, differingShare: +(differing / (width * height) * 100).toFixed(3) + '%', meanAbsDiff: +(sum / n).toFixed(3), psnr: mse === 0 ? Infinity : +(10 * Math.log10((255 * 255) / mse)).toFixed(2), maxChannelDiff: maxd };
writeFileSync('verification/out/pipeline/result.json', JSON.stringify(result, null, 1));
console.log(result);
