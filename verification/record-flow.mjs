// Records the archivist flow as a video: real-time capture of the page (Chrome screencast), then an H.264 MP4.
// The clock is sped up and positioned so a disk seals early in the take.
// Usage: OVERMIND_URL=http://127.0.0.1:4173/ node verification/record-flow.mjs [out.mp4]
// Both scenes open at the top of the lineage (the write log, one write, a hover on the live disk, a seal); SCENE=opening
// stops there, the full flow goes on to a sealed disk, reading it in the machine and the lineage.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch } from './lib.mjs';

const BASE = process.env.OVERMIND_URL ?? 'http://127.0.0.1:4173/';
const OUT = process.argv[2] ?? new URL('./out/overmind-flow.mp4', import.meta.url).pathname;
const SCENE = process.env.SCENE ?? 'flow';
const W = Number(process.env.W ?? 1440), H = Number(process.env.H ?? 900), SPEED = Number(process.env.SPEED ?? 4);
const FRAMES = new URL('./out/record-frames/', import.meta.url).pathname;
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

// start the lineage so the live disk is most of the way through slot 89: a write lands ≈6 s in, the seal ≈21 s in (at 4×)
const minutes = 33 * 90 + 88.6;
const epoch = new Date(Date.now() - minutes * 60000).toISOString();

const browser = await launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?verify&speed=${SPEED}&epoch=${encodeURIComponent(epoch)}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'), null, { timeout: 90000 });
await page.waitForTimeout(800);

const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', async (f) => {
  frames.push({ data: f.data, t: f.metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

const wait = (ms) => page.waitForTimeout(ms);
const glide = async (x, y, ms = 900) => { await page.mouse.move(x, y, { steps: Math.max(8, Math.round(ms / 16)) }); };
const scroll = async (dy, ms) => { const n = Math.round(ms / 50); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy / n); await wait(50); } };
const diskOnScreen = () => page.evaluate(() => {
  const a = window.__overmind;
  const ndc = (i) => new a.camera.position.constructor().setFromMatrixPosition(a.tower.worldMatrix(i, new a.camera.matrixWorld.constructor())).project(a.camera);
  const c = a.tower.instances.filter((i) => i.slab.index !== a.tower.count).map((i) => ({ i, v: ndc(i) })).filter((c) => Math.abs(c.v.x) < 0.5 && Math.abs(c.v.y) < 0.6).sort((p, q) => Math.hypot(p.v.x, p.v.y) - Math.hypot(q.v.x, q.v.y));
  const keep = a.pointerTarget.clone();
  const hit = c.find((c) => { a.pointerTarget.set(c.v.x, c.v.y); return a.pick()?.slab === c.i.slab; });
  a.pointerTarget.copy(keep);
  return hit && { x: (hit.v.x * 0.5 + 0.5) * innerWidth, y: (-hit.v.y * 0.5 + 0.5) * innerHeight };
});

// 1. the top of the lineage: the log, a write (≈6 s), a look inside the live disk, the seal (≈21 s), the new disk
await page.mouse.move(W * 0.08, H * 0.16);
await wait(9000);
await glide(W * 0.5, H * 0.5, 1400);
await wait(3500);
await glide(W * 0.08, H * 0.16, 1200);
await wait(SCENE === 'opening' ? 15000 : 13000);
if (SCENE !== 'opening') {
// 2. scroll a little way down the lineage and hover a sealed disk (its clip plays in the HUD)
await glide(W * 0.18, H * 0.55, 800);
await scroll(700, 1400);
await wait(1800);
const t = await diskOnScreen();
if (t) {
  await glide(t.x, t.y, 1400);
  await wait(4200);
  // 3. click: it flies into the computer; read the directory, open an entry, go back, eject
  await page.mouse.down(); await page.mouse.up();
  await wait(3800);
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowUp'); await wait(260); }
  await page.keyboard.press('Enter');
  await wait(5200);
  await page.keyboard.press('Backspace');
  await wait(1400);
  await page.keyboard.press('ArrowDown'); await wait(300);
  await page.keyboard.press('Enter');
  await wait(4200);
  await page.keyboard.press('Escape'); await wait(700);
  await page.keyboard.press('Escape');
  await wait(3200);
}
// 4. down the lineage, then back up to the live disk
await glide(W * 0.2, H * 0.5, 600);
await scroll(2200, 4200);
await wait(1500);
await scroll(-3600, 4200);
await wait(3000);
}

await cdp.send('Page.stopScreencast');
await browser.close();

// write frames with their real timestamps, then resample to a constant 30 fps
const list = [];
frames.forEach((f, i) => {
  const file = `${FRAMES}${String(i).padStart(5, '0')}.jpg`;
  writeFileSync(file, Buffer.from(f.data, 'base64'));
  const next = frames[i + 1]?.t ?? f.t + 1 / 30;
  list.push(`file '${file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
});
writeFileSync(`${FRAMES}list.txt`, list.join('\n') + '\n');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${FRAMES}list.txt`,
  '-vf', `fps=30,scale=${Math.min(W, 1280)}:-2:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-movflags', '+faststart', OUT]);
const span = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
console.log(`${frames.length} frames over ${span.toFixed(1)} s (${(frames.length / Math.max(span, 1)).toFixed(1)} fps captured) → ${OUT}`);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
