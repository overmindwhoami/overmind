// Screenshots of the pool's Wayback Machine captures (the old web pages the Overmind saves), as 16:9 stills for the
// instrument. Uses the capture's iframe mode (no Wayback toolbar). Gentle: one page at a time.
// Usage: node scripts/wayback-shots.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const poolPath = resolve(root, 'src/data/archive-pool.json');
const out = resolve(root, 'public/archive/media');
mkdirSync(out, { recursive: true });
const pool = JSON.parse(readFileSync(poolPath, 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 576 }, deviceScaleFactor: 1 });
let n = 0;
for (const item of pool.filter((p) => p.source === 'wayback')) {
  const safe = item.id.replace(/[^\w.-]/g, '_');
  const file = resolve(out, `${safe}.jpg`);
  if (!existsSync(file)) {
    const url = item.url.replace(/\/web\/(\d+)\//, '/web/$1if_/');
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: file, type: 'jpeg', quality: 76 });
    } catch (e) { console.log('skip', item.id, String(e).slice(0, 100)); continue; }
    await new Promise((r) => setTimeout(r, 1500));
  }
  item.media = `/archive/media/${safe}.jpg`;
  n++;
}
writeFileSync(poolPath, JSON.stringify(pool));
console.log('wayback stills', n);
await browser.close();
