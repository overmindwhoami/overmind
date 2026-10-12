/**
 * The vending machine: lifeboat tickets, on the test network. A ticket is a Winternitz key (hash-based: quantum
 * computers can't forge it) made in this browser; SOL put in its vault comes out only with that key's signature
 * (programs/lifeboat). A key signs once, so taking some out moves the rest to a new ticket. Loaded on demand (the
 * Solana library stays out of the main page).
 */
import { ComputeBudgetProgram, Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import { closeIx, closeMessage, openIx, PROGRAM_ID, splitIx, splitMessage, vaultOf } from '../lifeboat/vault';
import { generateKey, sign } from '../lifeboat/wots';
import { readTicket, ticketImage, ticketOf, type Ticket } from '../lifeboat/ticket';
import { connect, onWallets, session, short, signAll, walletBrowserLinks, wallets } from './wallet';

const params = new URLSearchParams(window.location.search);
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const RPC = params.get('lifeboat') ?? env.VITE_LIFEBOAT_RPC ?? 'https://api.devnet.solana.com';
const NETWORK = RPC.includes('devnet') ? 'devnet' : RPC.includes('testnet') ? 'testnet' : RPC.includes('127.0.0.1') || RPC.includes('localhost') ? 'localnet' : 'mainnet';
const CHAIN = NETWORK === 'testnet' ? 'solana:testnet' : 'solana:devnet';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const sol = (lamports: number) => `${(lamports / LAMPORTS_PER_SOL).toLocaleString('en-US', { maximumFractionDigits: 6 })} SOL`;
const touch = () => window.matchMedia('(pointer: coarse)').matches;

export class MintSheet {
  readonly root = document.createElement('section');
  private conn = new Connection(RPC, 'confirmed');
  private ticket?: Ticket;
  private balance?: number; // lamports in the ticket's vault (undefined: not opened yet)
  private busy = false;
  private message = '';
  private error = false;
  private live?: boolean; // the lifeboat program is on this network (undefined: still asking)

  constructor(private hooks: { lcd?: (a: string, b: string) => void } = {}) {
    this.root.className = 'sheet mint';
    this.root.setAttribute('aria-label', 'Lifeboat tickets');
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(this.root);
    onWallets(() => { if (!this.root.hidden) this.render(); });
  }
  show() { this.root.hidden = false; this.render(); void this.check(); void this.refresh(); }
  /** Is the program on this network yet? Until it is, tickets can be printed and saved but nothing goes in. */
  private async check() {
    if (this.live !== undefined) return;
    const info = await this.conn.getAccountInfo(PROGRAM_ID).catch(() => null);
    this.live = !!info?.executable;
    this.render();
  }
  hide() { this.root.hidden = true; }

  private get vault() { return this.ticket ? vaultOf(this.ticket.root)[0] : undefined; }
  private say(text: string, error = false) { this.message = text; this.error = error; const el = this.root.querySelector('[data-say]'); if (el) { el.textContent = text; el.classList.toggle('is-error', error); } }

  private async refresh() {
    const v = this.vault;
    if (!v) return;
    const info = await this.conn.getAccountInfo(v).catch(() => null);
    this.balance = info && info.owner.equals(PROGRAM_ID) ? info.lamports : undefined;
    this.render();
  }

  private download(t: Ticket) {
    const v = vaultOf(t.root)[0].toBase58();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(ticketImage(t, v, PROGRAM_ID.toBase58(), NETWORK));
    a.download = `lifeboat-ticket-${v.slice(0, 6)}.img`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  private render() {
    const ws = wallets(), t = this.ticket, v = this.vault;
    const walletRow = session.wallet
      ? `<p class="lp__wallet"><span class="lp__dot" aria-hidden="true"></span>${esc(session.wallet.name)} · ${short(session.wallet.address)} <span class="sheet__fine">(set it to ${NETWORK})</span></p>`
      : ws.length
        ? `<div class="lp__wallets">${ws.map((w, i) => `<button class="sheet__btn" data-wallet="${i}" type="button"><img alt="" src="${esc(w.icon)}" width="18" height="18">${esc(w.name)}</button>`).join('')}</div>`
        : touch()
          ? `<div class="lp__wallets">${walletBrowserLinks().map((l) => `<a class="sheet__btn" href="${l.href}">${l.name} ↗</a>`).join('')}</div>`
          : `<p class="sheet__fine">no solana wallet in this browser: install <a href="https://phantom.com" target="_blank" rel="noopener">phantom</a> or <a href="https://solflare.com" target="_blank" rel="noopener">solflare</a>.</p>`;
    const ticketBlock = t && v
      ? `<div class="mint__ticket">
          <p class="books__name">your ticket <a href="https://explorer.solana.com/address/${v.toBase58()}?cluster=${NETWORK === 'localnet' ? 'custom&customUrl=' + encodeURIComponent(RPC) : NETWORK}" target="_blank" rel="noopener">vault ${short(v.toBase58())} ↗</a></p>
          <dl class="coin__facts"><div><dt>in the vault</dt><dd>${this.balance === undefined ? 'not opened' : sol(this.balance)}</dd></div><div><dt>network</dt><dd>${NETWORK}</dd></div><div><dt>made</dt><dd>${t.made.slice(0, 10)}</dd></div></dl>
          <form class="lp__buy" data-in><label>put in <input name="sol" inputmode="decimal" value="0.1" aria-label="SOL to put in"> SOL</label><button class="sheet__btn" type="submit" ${session.wallet && !this.busy && this.live ? '' : 'disabled'}>put in</button></form>
          ${this.balance ? `<form class="lp__buy" data-out><label>take out <input name="sol" inputmode="decimal" value="${Math.min(0.05, this.balance / LAMPORTS_PER_SOL).toFixed(3)}" aria-label="SOL to take out"> SOL</label><button class="sheet__btn" type="submit" ${session.wallet && !this.busy ? '' : 'disabled'}>take out</button></form>
          <div class="sheet__actions"><button class="sheet__btn" data-all type="button" ${session.wallet && !this.busy ? '' : 'disabled'}>take everything out</button><button class="sheet__link" data-save type="button">save the ticket again</button></div>` : `<div class="sheet__actions"><button class="sheet__link" data-save type="button">save the ticket again</button></div>`}
        </div>`
      : `<div class="sheet__actions"><button class="sheet__btn sheet__btn--primary" data-print type="button">print a ticket</button>
          <label class="sheet__btn mint__load">load a ticket<input type="file" accept=".img,.txt,application/octet-stream,text/plain" data-load></label></div>`;
    this.root.innerHTML = `
      <p class="sheet__eyebrow">LIFEBOAT TICKETS · ${NETWORK.toUpperCase()}</p>
      <p class="sheet__voice">&gt; a lifeboat ticket is a key quantum computers can't forge. what you put in its vault comes out only with that key.</p>
      <ul class="sheet__list">
        <li>your key is made in this browser, and saved by you as a floppy disk image. nobody else ever has it.</li>
        <li>it signs once: when you take some out, the rest moves to a new ticket. save each new one.</li>
        <li>lose the ticket, lose what's in the vault. there's no reset.</li>
      </ul>
      ${this.live === false ? `<p class="sheet__fine is-error">the lifeboat program isn't on ${NETWORK} yet. you can print and save a ticket now; putting SOL in opens when it lands.</p>` : ''}
      ${ticketBlock}
      ${walletRow}
      <p class="sheet__say${this.error ? ' is-error' : ''}" data-say aria-live="polite">${esc(this.message)}</p>
      <p class="sheet__fine">test network only: play money. need some? <a href="https://faucet.solana.com" target="_blank" rel="noopener">faucet.solana.com ↗</a> (choose ${NETWORK}). unaudited · nothing here is financial advice.</p>`;
    this.root.querySelector('[data-print]')?.addEventListener('click', () => this.print());
    this.root.querySelector<HTMLInputElement>('[data-load]')?.addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      try { this.ticket = readTicket(new Uint8Array(await f.arrayBuffer())); this.say('ticket loaded.'); this.hooks.lcd?.('TICKET', 'LOADED'); await this.refresh(); } catch (err) { this.say((err as Error).message, true); }
    });
    this.root.querySelector('[data-save]')?.addEventListener('click', () => { if (this.ticket) this.download(this.ticket); });
    this.root.querySelectorAll<HTMLButtonElement>('[data-wallet]').forEach((b) => b.addEventListener('click', async () => {
      try { session.wallet = await connect(ws[Number(b.dataset.wallet)]); this.say(`connected. make sure ${session.wallet.name} is on ${NETWORK}.`); this.render(); } catch (err) { this.say((err as Error).message || 'the wallet didn’t connect.', true); }
    }));
    this.root.querySelector<HTMLFormElement>('[data-in]')?.addEventListener('submit', (e) => { e.preventDefault(); void this.putIn(Number(new FormData(e.target as HTMLFormElement).get('sol'))); });
    this.root.querySelector<HTMLFormElement>('[data-out]')?.addEventListener('submit', (e) => { e.preventDefault(); void this.takeOut(Number(new FormData(e.target as HTMLFormElement).get('sol'))); });
    this.root.querySelector('[data-all]')?.addEventListener('click', () => void this.takeAll());
  }

  /** A new ticket: the key is made here, the floppy image downloads at once (it's the only copy). */
  private print() {
    this.ticket = ticketOf(generateKey());
    this.balance = undefined;
    this.download(this.ticket);
    this.say('printed. your ticket downloaded as a floppy image: keep it somewhere safe.');
    this.hooks.lcd?.('TICKET', 'PRINTED');
    this.render();
  }

  private async sendAll(groups: TransactionInstruction[][]): Promise<void> {
    const w = session.wallet!, payer = new PublicKey(w.address);
    const { blockhash } = await this.conn.getLatestBlockhash('confirmed');
    const txs = groups.map((ixs) => new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message()));
    this.say(`approve it in ${w.name}.`);
    const signed = await signAll(w, txs.map((t) => t.serialize()), CHAIN);
    for (const raw of signed) { // in order: a later one depends on an earlier one landing
      this.say('sending…');
      const sig = await this.conn.sendRawTransaction(raw, { skipPreflight: false });
      const r = await this.conn.confirmTransaction(sig, 'confirmed');
      if (r.value.err) throw new Error('the network refused it.');
    }
  }
  private async run(what: () => Promise<void>, done: string) {
    if (this.busy || !session.wallet) return;
    this.busy = true; this.render();
    try { await what(); this.message = done; this.error = false; }
    catch (e) { const m = (e as Error).message || 'something went wrong.'; this.message = /reject|denied|cancel/i.test(m) ? 'you cancelled it in your wallet.' : /insufficient|0x1\b|debit/i.test(m) ? `not enough SOL on ${NETWORK} in your wallet.` : m; this.error = true; }
    finally { this.busy = false; await this.refresh(); }
  }

  private putIn(amount: number) {
    const t = this.ticket!, v = this.vault!;
    if (!(amount > 0)) { this.say('how much?', true); return; }
    return this.run(async () => {
      const payer = new PublicKey(session.wallet!.address);
      const open = this.balance === undefined ? [openIx(payer, t.root)] : [];
      await this.sendAll([[...open, SystemProgram.transfer({ fromPubkey: payer, toPubkey: v, lamports: Math.round(amount * LAMPORTS_PER_SOL) })]]);
      this.hooks.lcd?.('IN THE VAULT', `${amount} SOL`);
    }, `${amount} SOL is in the vault. only this ticket can take it out.`);
  }

  /** Some out to the wallet; the rest to a fresh vault with a fresh ticket (downloaded before anything is signed). */
  private takeOut(amount: number) {
    const t = this.ticket!, v = this.vault!, lamports = BigInt(Math.round(amount * LAMPORTS_PER_SOL));
    if (!(amount > 0) || this.balance === undefined || Number(lamports) >= this.balance) { this.say(`between 0 and ${sol(this.balance ?? 0)} (or take everything out).`, true); return; }
    return this.run(async () => {
      const wallet = new PublicKey(session.wallet!.address);
      const next = ticketOf(generateKey()), [nextVault] = vaultOf(next.root);
      this.download(next); // the new ticket is the only key to what stays: it's saved before anything moves
      const signature = sign(t.key, splitMessage(lamports, wallet, nextVault, v));
      await this.sendAll([[openIx(wallet, next.root)], [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), splitIx(signature, lamports, t.root, wallet, nextVault)]]);
      this.ticket = next;
      this.hooks.lcd?.('TICKET', 'RENEWED');
    }, `${amount} SOL is in your wallet. the rest moved to your new ticket (it just downloaded: the old one is spent).`);
  }

  private takeAll() {
    const t = this.ticket!, v = this.vault!;
    return this.run(async () => {
      const wallet = new PublicKey(session.wallet!.address);
      await this.sendAll([[ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), closeIx(sign(t.key, closeMessage(wallet, v)), t.root, wallet)]]);
      this.ticket = undefined;
      this.hooks.lcd?.('VAULT', 'EMPTY');
    }, 'everything is in your wallet. that ticket is spent.');
  }
}
