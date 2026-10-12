/**
 * The launchpad's two panels, in the room:
 *   the launch sheet at the duplicator: a picture, a name, a ticker, what it's about, the visitor's wallet, launch.
 *     One wallet prompt; the duplicator's LCD follows along. When it's live: see it on the wall, a first buy, pump.fun.
 *   the coin sheet at the explorer wall: one coin's disk read out: its picture and ticker, the Overmind's note, who holds
 *     it, and every snapshot, each re-hashed in the visitor's own browser with CHECK.
 * Short by design: everything a visitor needs is on one screen, nothing waits on them to read.
 */
import { b64ToBytes, bytesToB64, type Launchpad, type LpCoin, type LpStatus, type Sent } from '../archive/launchpad';
import { connect, onWallets, short, signAll, walletBrowserLinks, wallets, type Connected } from './wallet';

const DRAFT = 'overmind.launch-draft';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const touch = () => window.matchMedia('(pointer: coarse)').matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** A square picture for a coin: centre-cropped, at most 1024 px, WebP under 1 MB (GIFs stay as they are, up to 1 MB). */
async function squareImage(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Use a PNG, JPEG, WebP or GIF.');
  if (file.type === 'image/gif') { if (file.size > 1_000_000) throw new Error('GIFs up to 1 MB.'); return file; }
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height), size = Math.min(1024, s);
  const c = document.createElement('canvas'); c.width = c.height = size;
  c.getContext('2d')!.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  for (let q = 0.92; q >= 0.4; q -= 0.1) {
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', q));
    if (b && b.size <= 1_000_000) return b;
  }
  throw new Error('That picture is too large. Try a smaller one.');
}

/** Panels share this: the wallet a visitor connected (for the launch and their first buy). */
let connected: Connected | undefined;

export class LaunchSheet {
  readonly root = document.createElement('section');
  private status?: LpStatus;
  private image?: Blob;
  private busy = false;
  private done?: { mint: string; ticker: string };
  private message = '';
  private error = false;

  constructor(private lp: Launchpad | undefined, private hooks: { lcd: (a: string, b: string) => void; toWall: (mint: string) => void; launched: () => void }) {
    this.root.className = 'sheet lp';
    this.root.setAttribute('aria-label', 'Launch a coin');
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(this.root);
    onWallets(() => { if (!this.root.hidden) this.render(); });
    this.render();
  }

  async show() {
    this.root.hidden = false;
    this.render();
    if (this.lp && !this.status) { this.status = await this.lp.status().catch(() => undefined); this.render(); }
    this.lcdIdle();
  }
  hide() { this.root.hidden = true; }

  private draft(): { name: string; ticker: string; about: string } {
    try { return { name: '', ticker: '', about: '', ...JSON.parse(localStorage.getItem(DRAFT) ?? '{}') }; } catch { return { name: '', ticker: '', about: '' }; }
  }
  private save(d: { name: string; ticker: string; about: string }) { try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch { /* fine */ } }
  private lcdIdle() {
    const d = this.draft();
    if (this.done) this.hooks.lcd(`$${this.done.ticker}`, 'ON THE WALL');
    else if (d.ticker) this.hooks.lcd(`$${d.ticker}`, (d.name || 'NAME IT').toUpperCase());
    else this.hooks.lcd('INSERT NAME', this.status?.open ? 'READY' : 'LAUNCH SOON');
  }
  private say(text: string, error = false) { this.message = text; this.error = error; const el = this.root.querySelector('[data-say]'); if (el) { el.textContent = text; el.classList.toggle('is-error', error); } }

  private render() {
    const d = this.draft(), open = !!this.status?.open, ws = wallets();
    const split = this.status ? `${this.status.split.launcher / 100}% to you, ${this.status.split.treasury / 100}% to the overmind's treasury` : 'shared with the overmind’s treasury';
    if (this.done) {
      this.root.innerHTML = `
        <p class="sheet__eyebrow">LAUNCHED</p>
        <p class="sheet__voice">&gt; $${esc(this.done.ticker.toLowerCase())} is live. its disk is on my wall, and i've written down who holds it.</p>
        <div class="sheet__actions">
          <button class="sheet__btn sheet__btn--primary" data-wall type="button">see it on the wall</button>
          <a class="sheet__btn" href="https://pump.fun/coin/${this.done.mint}" target="_blank" rel="noopener">pump.fun ↗</a>
        </div>
        <form class="lp__buy" data-buy>
          <label>first buy <input name="sol" inputmode="decimal" value="0.1" aria-label="SOL to spend"> SOL</label>
          <button class="sheet__btn" type="submit">buy</button>
        </form>
        <p class="sheet__say" data-say aria-live="polite">${esc(this.message)}</p>
        <button class="sheet__link" data-again type="button">launch another</button>`;
      this.root.querySelector('[data-wall]')!.addEventListener('click', () => this.hooks.toWall(this.done!.mint));
      this.root.querySelector('[data-again]')!.addEventListener('click', () => { this.done = undefined; this.message = ''; this.render(); this.lcdIdle(); });
      this.root.querySelector<HTMLFormElement>('[data-buy]')!.addEventListener('submit', (e) => { e.preventDefault(); void this.firstBuy(Number(new FormData(e.target as HTMLFormElement).get('sol'))); });
      return;
    }
    const walletRow = connected
      ? `<p class="lp__wallet"><span class="lp__dot" aria-hidden="true"></span>${esc(connected.name)} · ${short(connected.address)} <button class="sheet__link" data-change type="button">change</button></p>`
      : ws.length
        ? `<div class="lp__wallets">${ws.map((w, i) => `<button class="sheet__btn" data-wallet="${i}" type="button"><img alt="" src="${esc(w.icon)}" width="18" height="18">${esc(w.name)}</button>`).join('')}</div>`
        : touch()
          ? `<p class="sheet__fine">your browser has no wallet in it. open this page in your wallet:</p><div class="lp__wallets">${walletBrowserLinks().map((l) => `<a class="sheet__btn" href="${l.href}">${l.name} ↗</a>`).join('')}</div>`
          : `<p class="sheet__fine">no solana wallet found in this browser. install <a href="https://phantom.com" target="_blank" rel="noopener">phantom</a> or <a href="https://solflare.com" target="_blank" rel="noopener">solflare</a>, then come back.</p>`;
    this.root.innerHTML = `
      <p class="sheet__eyebrow">LAUNCH A COIN</p>
      <p class="sheet__voice">&gt; every coin launched here gets a disk on my wall. every few hours i write down who holds it and seal it, so it's provable after q-day.</p>
      <form class="lp__form" data-form>
        <label class="lp__image" title="picture">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-file>
          <span data-preview>${this.image ? '' : '+ picture'}</span>
        </label>
        <div class="lp__fields">
          <input class="sheet__input" name="name" placeholder="name" maxlength="32" autocomplete="off" value="${esc(d.name)}" aria-label="Name">
          <label class="lp__ticker"><span aria-hidden="true">$</span><input class="sheet__input" name="ticker" placeholder="TICKER" maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(d.ticker)}" aria-label="Ticker"></label>
        </div>
        <textarea class="sheet__input lp__about" name="about" rows="2" maxlength="280" placeholder="what is it about? (optional: the overmind reads it)" aria-label="What is it about">${esc(d.about)}</textarea>
        ${walletRow}
        <button class="sheet__btn sheet__btn--primary lp__go" type="submit" data-go ${open && connected && !this.busy ? '' : 'disabled'}>${!this.lp ? 'the launchpad lives on the real server' : open ? (connected ? `launch · about ${this.status?.costSol ?? 0.03} SOL` : 'connect a wallet to launch') : 'opens after $OMD launches'}</button>
        <p class="sheet__say${this.error ? ' is-error' : ''}" data-say aria-live="polite">${esc(this.message)}</p>
        <p class="sheet__fine">creator fees: ${split}, which pays for your coin's snapshots. nothing here is financial advice.</p>
      </form>`;
    if (this.image) this.preview(this.image);
    const form = this.root.querySelector<HTMLFormElement>('[data-form]')!;
    const sync = () => {
      const f = new FormData(form);
      const ticker = String(f.get('ticker') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
      const t = form.elements.namedItem('ticker') as HTMLInputElement;
      if (t.value !== ticker) t.value = ticker;
      this.save({ name: String(f.get('name') ?? ''), ticker, about: String(f.get('about') ?? '') });
      this.lcdIdle();
    };
    form.addEventListener('input', sync);
    form.addEventListener('submit', (e) => { e.preventDefault(); void this.launch(); });
    this.root.querySelector<HTMLInputElement>('[data-file]')!.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try { this.image = await squareImage(file); this.preview(this.image); this.say(''); } catch (err) { this.say((err as Error).message, true); }
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-wallet]').forEach((b) => b.addEventListener('click', async () => {
      try { connected = await connect(ws[Number(b.dataset.wallet)]); this.say(''); this.render(); } catch (err) { this.say((err as Error).message || 'The wallet didn’t connect.', true); }
    }));
    this.root.querySelector('[data-change]')?.addEventListener('click', () => { connected = undefined; this.render(); });
  }

  private preview(b: Blob) {
    const el = this.root.querySelector<HTMLElement>('[data-preview]');
    if (!el) return;
    el.textContent = '';
    el.style.backgroundImage = `url(${URL.createObjectURL(b)})`;
    el.classList.add('has-image');
  }

  private async launch() {
    if (!this.lp || !connected || this.busy) return;
    const d = this.draft();
    if (!d.name.trim()) { this.say('give it a name.', true); return; }
    if (!/^[A-Z0-9]{1,10}$/.test(d.ticker)) { this.say('give it a ticker: 1 to 10 letters or numbers.', true); return; }
    this.busy = true;
    this.render();
    try {
      let image: string | undefined;
      if (this.image) { this.say('uploading the picture…'); this.hooks.lcd('UPLOADING', 'PICTURE'); image = (await this.lp.upload(this.image)).url; }
      const attempt = async () => {
        this.say('preparing your coin…'); this.hooks.lcd('PREPARING', `$${d.ticker}`);
        const built = await this.lp!.launch({ wallet: connected!.address, name: d.name.trim(), ticker: d.ticker, description: d.about.trim() || undefined, image });
        this.say(`approve it in ${connected!.name}.`); this.hooks.lcd('SIGN IN', 'YOUR WALLET');
        const signed = await signAll(connected!, built.txs.map(b64ToBytes));
        this.say('sending it to solana…'); this.hooks.lcd('COPYING...', `$${d.ticker}`);
        const first = await this.lp!.submit(built.mint, signed.map(bytesToB64)).catch((e: Error) => { throw e; });
        return { built, first };
      };
      let { built, first } = await attempt();
      for (let i = 0; first.expired && i < 2; i++) ({ built, first } = await attempt());
      let r: Sent = first;
      for (let i = 0; !r.ok && (r.pending || r.reason === 'not confirmed yet') && r.sig && i < 40; i++) {
        this.say('waiting for solana to confirm…');
        await sleep(3000);
        r = { ...r, ...(await this.lp.confirm(built.mint, r.sig).catch(() => ({ ok: false, pending: true } as Sent))), sig: r.sig };
      }
      if (!r.ok) throw new Error(r.pending || r.reason === 'not confirmed yet' ? 'still confirming. it will appear on the wall once it lands; nothing needs signing again.' : r.reason ?? r.error ?? 'the launch didn’t confirm.');
      this.done = { mint: built.mint, ticker: d.ticker };
      this.image = undefined;
      this.save({ name: '', ticker: '', about: '' });
      this.message = '';
      this.hooks.lcd(`$${d.ticker}`, 'ON THE WALL');
      this.hooks.launched();
    } catch (e) {
      const m = (e as Error).message || 'something went wrong.';
      this.message = /reject|denied|cancel/i.test(m) ? 'you cancelled it in your wallet. nothing was sent.' : m;
      this.error = true;
      this.hooks.lcd('NOT SENT', 'TRY AGAIN');
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async firstBuy(sol: number) {
    if (!this.lp || !connected || !this.done || this.busy) return;
    if (!(sol > 0) || sol > 50) { this.say('between 0 and 50 SOL.', true); return; }
    this.busy = true;
    try {
      this.say('preparing the buy…');
      const b = await this.lp.buy(connected.address, this.done.mint, sol);
      this.say(`approve it in ${connected.name}.`);
      const signed = await signAll(connected, b.txs.map(b64ToBytes));
      this.say('buying…');
      await this.lp.submitBuy(signed.map(bytesToB64));
      this.say(`bought. your wallet holds $${this.done.ticker.toLowerCase()} now.`);
    } catch (e) {
      const m = (e as Error).message || 'the buy didn’t go through.';
      this.say(/reject|denied|cancel/i.test(m) ? 'you cancelled it in your wallet.' : m, true);
    } finally { this.busy = false; }
  }
}

export class CoinSheet {
  readonly root = document.createElement('section');
  private current?: string;

  constructor(private lp: Launchpad | undefined, private hooks: { launch: () => void; close: () => void }) {
    this.root.className = 'sheet coin';
    this.root.setAttribute('aria-label', 'A coin');
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(this.root);
  }

  hide() { this.root.hidden = true; this.current = undefined; }

  /** Nobody has launched yet: the wall's blank diskettes, and the way to the duplicator. */
  empty() {
    this.current = undefined;
    this.root.hidden = false;
    this.root.innerHTML = `
      <p class="sheet__eyebrow">EXPLORER</p>
      <p class="sheet__voice">&gt; the wall is blank. every coin launched through me gets one of these disks, with its picture on the label.</p>
      <div class="sheet__actions"><button class="sheet__btn sheet__btn--primary" data-launch type="button">launch one →</button></div>`;
    this.root.querySelector('[data-launch]')!.addEventListener('click', () => this.hooks.launch());
  }

  async open(mint: string) {
    if (!this.lp) return;
    this.current = mint;
    this.root.hidden = false;
    this.root.innerHTML = `<p class="sheet__eyebrow">READING DISK…</p>`;
    let c: LpCoin;
    try { c = await this.lp.coin(mint); } catch { if (this.current === mint) this.root.innerHTML = `<p class="sheet__voice">&gt; i can't find that coin on my wall.</p>`; return; }
    if (this.current !== mint) return;
    const list = c.snapshotList ?? [];
    this.root.innerHTML = `
      <button class="sheet__close" data-close type="button" aria-label="Close">×</button>
      <div class="coin__head">
        ${c.image ? `<img class="coin__img" alt="" src="${esc(c.image)}" width="72" height="72">` : '<span class="coin__img coin__img--none">$</span>'}
        <div><p class="coin__ticker">$${esc(c.ticker)}</p><p class="coin__name">${esc(c.name)}</p></div>
      </div>
      ${c.note ? `<p class="sheet__voice">&gt; ${esc(c.note)}</p>` : ''}
      ${c.description ? `<p class="coin__about">${esc(c.description)}</p>` : ''}
      <dl class="coin__facts">
        <div><dt>launched</dt><dd>${day(c.liveAt)}</dd></div>
        <div><dt>holders</dt><dd>${c.holders ?? '—'}</dd></div>
        <div><dt>snapshots</dt><dd>${c.snapshots}</dd></div>
      </dl>
      <p class="sheet__eyebrow">WHO HELD IT, SEALED</p>
      <ol class="coin__snaps">${list.map((s) => `
        <li><span class="coin__n">#${s.n}</span> <span>${new Date(s.at).toISOString().slice(0, 16).replace('T', ' ')}</span> <span>${s.holders} holders</span>
          <span class="coin__fp">sha256 ${s.fingerprint.slice(0, 10)}…</span>
          ${s.tx ? `<a href="https://explorer.solana.com/tx/${s.tx}" target="_blank" rel="noopener">sealed ↗</a>` : '<span class="coin__pending">seal pending</span>'}
          <button class="sheet__link" data-check="${s.n}" data-fp="${s.fingerprint}" type="button">check</button><span class="coin__match" data-match="${s.n}"></span></li>`).join('') || '<li>the first snapshot is being taken.</li>'}
      </ol>
      <div class="sheet__actions">
        <a class="sheet__btn sheet__btn--primary" href="${c.pump}" target="_blank" rel="noopener">pump.fun ↗</a>
        <button class="sheet__btn" data-share type="button">share</button>
      </div>`;
    this.root.querySelector('[data-close]')!.addEventListener('click', () => { this.hide(); this.hooks.close(); });
    this.root.querySelector('[data-share]')!.addEventListener('click', async (e) => {
      const url = `${window.location.origin}${window.location.pathname}#coin-${c.mint}`;
      try {
        if (navigator.share && touch()) await navigator.share({ title: `$${c.ticker} on the Overmind's wall`, url });
        else { await navigator.clipboard.writeText(url); (e.target as HTMLElement).textContent = 'link copied'; }
      } catch { /* dismissed */ }
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-check]').forEach((b) => b.addEventListener('click', async () => {
      const out = this.root.querySelector<HTMLElement>(`[data-match="${b.dataset.check}"]`)!;
      out.textContent = '…';
      try {
        const text = await this.lp!.record(c.mint, Number(b.dataset.check));
        const h = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
        out.textContent = h === b.dataset.fp ? 'MATCH' : 'MISMATCH';
        out.classList.toggle('is-bad', h !== b.dataset.fp);
      } catch { out.textContent = 'couldn’t read it'; }
    }));
  }
}
