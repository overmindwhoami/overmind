// Renders the opening frame of the built site and saves it as public/poster.webp (960×436, shown blurred while WebGL boots).
// Usage: npm run build && npx vite preview --port 4173 & node scripts/make-poster.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.OVERMIND_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 872 } });
await page.goto(url + '?verify');
await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'));
await page.addStyleTag({ content: '.chrome, .tracker, .poster { display: none !important }' });
await page.waitForTimeout(2500);
const png = resolve(root, 'verification/out/poster.png');
await page.screenshot({ path: png });
await browser.close();
execFileSync('magick', [png, '-resize', '960x436!', '-quality', '62', resolve(root, 'public/poster.webp')]);
console.log('wrote public/poster.webp');
