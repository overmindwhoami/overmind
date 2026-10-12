/**
 * The books, at the $OMD board: every wallet the Overmind uses, its balance, what came in and what went out, its
 * latest moves (each a link to the chain), and whether it all adds up. Read from the live service (/api/books).
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const sol = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 6 })} SOL`;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
interface Wallet { name: string; role: string; address: string; balance: number | null; in: number; out: number; moves: number; addsUp: boolean | null;
  recent: { sig: string; at: number | null; sol: number; what: string }[] }

export class BooksSheet {
  readonly root = document.createElement('section');
  constructor(private api: string | undefined, private coinLine: () => string) {
    this.root.className = 'sheet books';
    this.root.setAttribute('aria-label', 'The books');
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(this.root);
  }
  hide() { this.root.hidden = true; }
  async show() {
    this.root.hidden = false;
    const head = `<p class="sheet__eyebrow">THE BOOKS</p><p class="sheet__voice">&gt; ${esc(this.coinLine())}</p>
      <p class="sheet__voice">&gt; every wallet i use, what came in and what went out, read from the chain. it adds up, or i say it doesn't.</p>`;
    if (!this.api) { this.root.innerHTML = `${head}<p class="sheet__fine">the books live on the real server.</p>`; return; }
    this.root.innerHTML = `${head}<p class="sheet__fine">reading the chain…</p>`;
    let ws: Wallet[];
    try { ws = ((await (await fetch(`${this.api}/api/books`)).json()) as { wallets: Wallet[] }).wallets; } catch { this.root.innerHTML = `${head}<p class="sheet__fine">the chain didn't answer. try again in a moment.</p>`; return; }
    if (this.root.hidden) return;
    this.root.innerHTML = head + ws.map((w) => `
      <div class="books__wallet">
        <p class="books__name">${esc(w.name)} <a href="https://explorer.solana.com/address/${w.address}" target="_blank" rel="noopener">${short(w.address)} ↗</a></p>
        ${w.role ? `<p class="sheet__fine">${esc(w.role)}</p>` : ''}
        <dl class="coin__facts"><div><dt>balance</dt><dd>${w.balance === null ? '—' : sol(w.balance)}</dd></div><div><dt>came in</dt><dd>${sol(w.in)}</dd></div><div><dt>went out</dt><dd>${sol(w.out)}</dd></div></dl>
        <p class="books__check ${w.addsUp ? 'is-ok' : ''}">${w.moves === 0 ? 'nothing in or out yet.' : w.addsUp ? `adds up: ${w.moves} moves, in minus out is the balance.` : w.addsUp === false ? 'doesn’t add up yet: still reading its history.' : 'the chain didn’t answer for its balance.'}</p>
        ${w.recent.length ? `<ol class="coin__snaps">${w.recent.map((m) => `<li><span class="coin__n">${m.at ? new Date(m.at).toISOString().slice(0, 16).replace('T', ' ') : '—'}</span> <span>${esc(m.what)}</span> <span class="${m.sol >= 0 ? 'books__in' : ''}">${m.sol >= 0 ? '+' : '−'}${sol(Math.abs(m.sol))}</span> <a href="https://explorer.solana.com/tx/${m.sig}" target="_blank" rel="noopener">tx ↗</a></li>`).join('')}</ol>` : ''}
      </div>`).join('') + `<p class="sheet__fine">nothing here is financial advice.</p>`;
  }
}
