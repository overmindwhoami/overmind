// The whole site, driven like a visitor would, on a desktop and on a phone (WebKit; an iPhone 15 Pro for the phone):
// every place in the menu, the walkthrough, a disk in the reader (share, its image, talking from inside it, eject), the
// terminal's commands, every docs page, the books, launching and buying, the explorer wall and a snapshot check, the
// lifeboat tickets (explained, nothing to do yet), the ticker, the sound, the routes a link can land on, and Esc. Page errors and failed requests are
// collected the whole way. Nothing it does spends money: on a preview it uses the preview wallet; the terminal's SAVE is
// only tried without a link.
//   node scripts/qa.mjs [site] [out-dir]        site defaults to https://overmind.im/?preview
import { webkit, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const SITE = process.argv[2] ?? 'https://overmind.im/?preview';
const OUT = process.argv[3] ?? 'qa-out';
mkdirSync(OUT, { recursive: true });
const PREVIEW = /[?&]preview/.test(SITE);
const url = (hash = '') => `${SITE}${hash}`;
const report = [];

async function run(tag, contextOptions) {
  const results = [];
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...contextOptions, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], failed = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon|\/api\/activity/.test(r.url())) failed.push(`${r.status()} ${r.url().slice(0, 140)}`); });
  const shot = (n) => page.screenshot({ path: `${OUT}/${tag}-${n}.png` }).catch(() => {});
  const text = (s) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? null, s);
  const visible = (s) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.closest('[hidden]')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }, s);
  const sheet = () => page.evaluate(() => [...document.querySelectorAll('.sheet')].find((s) => !s.hidden)?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 160) ?? null);
  async function step(what, fn) {
    const e0 = errors.length;
    try {
      const detail = await fn();
      const ok = detail !== false && errors.length === e0;
      results.push({ what, ok, detail: errors.length > e0 ? errors.slice(e0).join(' | ') : typeof detail === 'string' ? detail.slice(0, 200) : undefined });
    } catch (e) { results.push({ what, ok: false, detail: e.message.split('\n')[0].slice(0, 200) }); }
    const r = results[results.length - 1];
    console.log(`  [${tag}] ${r.ok ? '✓' : '✗'} ${what}${r.detail ? `: ${r.detail}` : ''}`);
  }
  // a place from the menu (desktop has no "room" item: its way there is the Back to the room button)
  const go = async (place) => {
    const item = `.menu [data-go="${place}"]`;
    if (await visible(item)) await page.click(item);
    else if (place === 'room' && await visible('.back[data-go="room"]')) await page.click('.back[data-go="room"]');
    else await page.evaluate((p) => { location.hash = `#${p}`; }, place);
    await page.waitForTimeout(2600);
  };
  const term = async (q, wait = 2500) => { await page.fill('#term-field', q); await page.press('#term-field', 'Enter'); await page.waitForTimeout(wait); };
  const lastLines = (n = 3) => page.evaluate((n) => [...document.querySelectorAll('.term-log p, .term-log li, .term-log > *')].slice(-n).map((e) => e.textContent.trim()).join(' / '), n);

  console.log(`\n=== ${tag} ===`);
  await step('the page loads and the tower draws', async () => {
    await page.goto(url('#tower'), { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.classList.contains('is-ready') || document.querySelector('.story__line'), null, { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(6000);
    await shot('tower');
    return (await text('.story')) ?? false;
  });
  if (PREVIEW) await step('the preview bar says what is simulated', async () => (await visible('.preview-bar')) && (await text('.preview-bar b')) === 'PREVIEW');
  await step('the room count shows', async () => (await text('[data-here]')) || false);
  await step('the walkthrough runs start to end', async () => {
    const tour = await page.$('.story__tour');
    if (!tour) return false;
    await tour.click(); await page.waitForTimeout(1800);
    const lines = [];
    for (let i = 0; i < 10 && await visible('.tour__btn--next'); i++) { lines.push(await text('.tour__line')); await page.click('.tour__btn--next'); await page.waitForTimeout(2200); }
    await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
    return `${lines.length} stops`;
  });
  await step('a disk opens in the reader from its link (#disk-1)', async () => {
    await page.goto(url('#disk-1'), { waitUntil: 'load' }); await page.waitForTimeout(9000);
    await shot('reader');
    return (await visible('[data-eject]')) ? 'eject shown' : false;
  });
  await step('the disk image link answers', async () => {
    const href = await page.getAttribute('[data-image]', 'href');
    if (!href) return false;
    const r = await page.request.get(new URL(href, page.url()).href);
    return r.status() === 200 ? `${r.status()} ${r.headers()['content-type']}` : false;
  });
  await step('share gives a link', async () => {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.click('[data-share]'); await page.waitForTimeout(800);
    return (await text('[data-share]')) || false;
  });
  await step('talking from inside the disk: the screen turns to the conversation', async () => {
    await term('what is on this disk?', 5000);
    const back = await visible('[data-todisk]');
    await shot('reader-talk');
    return back ? await lastLines(1) : false;
  });
  await step('↩ the disk goes back to it', async () => { await page.click('[data-todisk]'); await page.waitForTimeout(1000); return !(await visible('[data-todisk]')) && (await visible('[data-eject]')); });
  await step('eject', async () => { await page.click('[data-eject]'); await page.waitForTimeout(3000); return !(await visible('[data-eject]')); });
  await step('the story\'s "check a disk" opens a sealed disk', async () => {
    const b = await page.$('.story__check:not(.story__tour)');
    if (!b) return 'no check link on this screen';
    await b.click(); await page.waitForTimeout(6000);
    const ok = await visible('[data-eject]');
    await page.keyboard.press('Escape'); await page.waitForTimeout(2500);
    return ok;
  });

  for (const place of ['room', 'docs', 'omd', 'terminal', 'launch', 'explorer', 'mint']) {
    await step(`menu: ${place}`, async () => {
      await go(place);
      await shot(`place-${place}`);
      const cur = await page.evaluate(() => location.hash);
      return `${cur} ${(await sheet()) ?? ''}`.trim();
    });
  }

  await step('docs: every page, forward and back', async () => {
    await go('docs');
    const labels = [await text('[data-page-label]')];
    for (let i = 0; i < 10; i++) { await page.click('[data-page="1"]'); await page.waitForTimeout(500); labels.push(await text('[data-page-label]')); }
    await shot('docs-last');
    for (let i = 0; i < 10; i++) { await page.click('[data-page="-1"]'); await page.waitForTimeout(300); }
    labels.push(await text('[data-page-label]'));
    return labels.join(' → ').includes('10') ? labels.filter((x, i, a) => a.indexOf(x) === i).join(' ') : false;
  });

  await step('$OMD: the books read', async () => {
    await go('omd'); await page.waitForTimeout(4000);
    const b = await text('.books');
    return b && /adds up|nothing in or out|the books live/.test(b) ? b.slice(0, 120) : (b ?? false);
  });

  await step('terminal: opens ready to type', async () => { await go('terminal'); return (await page.evaluate(() => document.activeElement?.id)) === 'term-field' || (await visible('#term-field')); });
  for (const [cmd, expect] of [['HELP', /WHY/], ['WHY', /./], ['DIR', /DISK \d{4}/], ['QDAY', /guess|clock/], ['CHECK', /MATCH|simulation|sealed yet/], ['EXPOSED 7vTTFB3Lu8m2GF65F2oFYgNcKzJsuV7JQTkRBVFYZeXy', /SOL|public key|exposed|address/i], ['SAVE', /link/], ['MINE', /./], ['hello', /./]]) {
    await step(`terminal: ${cmd.split(' ')[0]}`, async () => {
      await term(cmd, cmd === 'CHECK' ? 9000 : cmd === 'hello' || cmd.startsWith('EXPOSED') ? 6000 : 2000);
      const l = await lastLines(cmd === 'HELP' || cmd === 'DIR' ? 12 : 4);
      return expect.test(l) ? l.slice(-160) : `unexpected: ${l.slice(-160)}` && false;
    });
  }
  await step('terminal: CLEAR', async () => { await term('CLEAR', 800); return (await lastLines(5)).length < 40; });

  await step('launch: the form, a wallet, a launch, a first buy', async () => {
    await go('launch');
    if (!PREVIEW) return (await sheet()) ?? false;
    await page.fill('.lp__form [name=name]', 'QA Coin'); await page.fill('.lp__form [name=ticker]', 'QA');
    await page.fill('.lp__form [name=x]', '@overmind'); await page.fill('.lp__form [name=web]', 'overmind.im');
    await page.click('.lp__form [data-wallet]'); await page.waitForTimeout(500);
    await page.click('.lp__form [data-go]');
    await page.waitForFunction(() => /LAUNCHED/.test(document.querySelector('.sheet:not([hidden]) .sheet__eyebrow')?.textContent ?? ''), null, { timeout: 30_000 });
    await page.click('[data-buy] button[type=submit]'); await page.waitForTimeout(2500);
    await shot('launched');
    return await text('.sheet:not([hidden]) [data-say]');
  });
  if (PREVIEW) await step('launch: "see it on the wall" opens its disk with its links', async () => {
    await page.click('[data-wall]'); await page.waitForTimeout(4000);
    const links = await page.$$eval('.sheet.coin .coin__links a', (as) => as.map((a) => a.textContent));
    return (await text('.sheet.coin .coin__ticker')) === '$QA' && links.length === 2 ? links.join(' ') : false;
  });
  await step('explorer: the wall, explained', async () => { await go('explorer'); await page.waitForTimeout(2500); return (await text('.sheet.coin')) || false; });
  if (PREVIEW) {
    await step('explorer: a coin opens from its link and every check matches', async () => {
      const mint = await page.evaluate(async () => (await (await fetch('https://preview.overmind.invalid/api/lp/coins')).json())[0].mint);
      await page.goto(url(`#coin-${mint}`), { waitUntil: 'load' }); await page.waitForTimeout(9000);
      const buttons = await page.$$('.sheet.coin [data-check]');
      for (const b of buttons.slice(0, 4)) await b.click();
      await page.waitForTimeout(2000);
      const m = await page.$$eval('.sheet.coin .coin__match', (es) => es.map((e) => e.textContent).filter(Boolean));
      await shot('coin');
      return m.length && m.every((x) => x === 'MATCH') ? `${m.length} MATCH` : false;
    });
    await step('explorer: ← the wall, then "launch a coin →"', async () => {
      await page.click('.sheet.coin [data-close]'); await page.waitForTimeout(800);
      await page.click('.sheet.coin [data-launch]'); await page.waitForTimeout(2500);
      return (await page.evaluate(() => location.hash)) === '#launch';
    });
  }
  await step('mint: explains lifeboat tickets, nothing to connect, print or save', async () => {
    await go('mint'); await page.waitForTimeout(2000);
    await shot('mint');
    const controls = await page.$$eval('.mint button, .mint input, .mint a[download]', (es) => es.length);
    const t = await text('.mint .sheet__eyebrow');
    return /COMING SOON/.test(t ?? '') && controls === 0 ? t : `${t} · ${controls} controls` && false;
  });
  if (!PREVIEW) await step('launch: open, the form ready for a wallet', async () => {
    await go('launch'); await page.waitForTimeout(2500);
    const button = await text('.lp__form [data-go]');
    // no wallet in a test browser: desktop says to install one, a phone offers to open the page in a wallet's browser
    const offer = (await page.$$('.lp__wallets a')).length > 0 || /no solana wallet/.test((await text('.lp__form')) ?? '');
    return /connect a wallet to launch/.test(button ?? '') && offer ? button : `${button}` && false;
  });
  await step('the ticker: tapping it follows', async () => {
    for (let i = 0; i < 12 && !(await page.$('.here__go')); i++) await page.waitForTimeout(1500);
    const b = await page.$('.here__go');
    if (!b) return PREVIEW ? false : 'nobody else did anything';
    const line = await b.textContent();
    await b.click(); await page.waitForTimeout(3000);
    return `${line} → ${await page.evaluate(() => location.hash)}`;
  });
  await step('sound toggles', async () => {
    await page.click('[data-sound]'); await page.waitForTimeout(400);
    const on = await page.getAttribute('[data-sound]', 'aria-pressed');
    await page.click('[data-sound]');
    return on === 'true';
  });
  await step('Esc / back to the room', async () => {
    await go('docs'); await page.keyboard.press('Escape'); await page.waitForTimeout(2600);
    return (await page.evaluate(() => location.hash)) || 'home';
  });
  await step('the logo goes home', async () => { await page.click('.logo'); await page.waitForTimeout(4000); return `${await page.evaluate(() => location.hash) || '(no hash)'}`; });
  await step('no request failed along the way', async () => (failed.length ? false : 'none') );
  if (failed.length) results[results.length - 1].detail = failed.slice(0, 6).join(' | ');
  await browser.close();
  report.push({ tag, results, errors, failed });
}

await run('desktop', { viewport: { width: 1440, height: 900 } });
await run('phone', { ...devices['iPhone 15 Pro'] });
const all = report.flatMap((r) => r.results.map((x) => ({ ...x, tag: r.tag })));
const bad = all.filter((x) => !x.ok);
writeFileSync(`${OUT}/qa.json`, JSON.stringify({ site: SITE, at: new Date().toISOString(), report }, null, 1));
console.log(`\n${all.length - bad.length}/${all.length} passed${bad.length ? `; failed:\n${bad.map((b) => `  [${b.tag}] ${b.what}: ${b.detail ?? ''}`).join('\n')}` : ''}`);
process.exit(bad.length ? 1 : 0);
