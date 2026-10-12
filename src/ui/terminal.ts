/**
 * The terminal: talk to the Overmind at the old computer. Lines are drawn on the CRT (machine/screen.ts, 'term' mode);
 * the visitor types into a plain input under it (so phone keyboards work). A few commands run here, in the browser,
 * against the live archive and the chain; anything else is a conversation with the Overmind (server /api/chat).
 */
import type { Archive } from '../archive/types';
import { visitor } from '../archive/remote';

export interface TermLine { who: 'you' | 'om' | 'sys'; text: string; at: number }
const TYPE_MS = 26; // the Overmind's replies type out

const HELP = [
  'HELP      this list',
  'WHY       my latest save, and why i kept it',
  'DIR       the last few things i saved',
  'QDAY      my guess at q-day, and why',
  'CHECK     prove the newest sealed disk is untouched',
  'EXPOSED <solana address>   is that wallet open on q-day?',
  'SAVE <link>   ask me to keep something (archive.org, wikipedia, arxiv…)',
  'MINE      what happened to the things you asked me to keep',
  'CLEAR     wipe the screen',
  'or just talk to me.',
];

export class Terminal {
  lines: TermLine[] = [];
  input = '';
  busy = false;
  private chat: { role: 'user' | 'assistant'; content: string }[] = [];
  /** The disk in the drive, when the visitor is talking from inside one (DIR and WHY read it; the Overmind is told). */
  disk?: number;

  constructor(private archive: Archive, private api: string | undefined, private onChange: () => void) {
    this.say('sys', 'OVERMIND TERMINAL · type HELP for commands, or just talk.');
    this.say('om', "you found my terminal. ask me anything. i'm writing while we talk.");
  }

  /** How much of a line has typed out (replies type; everything else is instant). */
  shown(l: TermLine) { return l.who === 'om' ? Math.min(l.text.length, Math.floor((performance.now() - l.at) / TYPE_MS)) : l.text.length; }
  get typing() { return this.lines.some((l) => this.shown(l) < l.text.length); }

  private say(who: TermLine['who'], text: string) { this.lines.push({ who, text, at: performance.now() }); if (this.lines.length > 80) this.lines.shift(); this.onChange(); }

  async submit(raw: string) {
    const text = raw.trim();
    if (!text || this.busy) return;
    this.say('you', text);
    const [cmd, ...args] = text.split(/\s+/);
    const c = cmd.toUpperCase();
    this.busy = true;
    try {
      if (c === 'HELP' || c === '?') HELP.forEach((h) => this.say('sys', h));
      else if (c === 'CLEAR' || c === 'CLS') { this.lines = []; this.onChange(); }
      else if (c === 'WHY') this.why();
      else if (c === 'DIR') this.dir();
      else if (c === 'QDAY' || c === 'Q-DAY') this.qday();
      else if (c === 'CHECK') await this.check();
      else if (c === 'EXPOSED') await this.exposed(args[0]);
      else if (c === 'SAVE' || c === 'NOMINATE') await this.nominate(args[0]);
      else if (c === 'MINE') await this.mine();
      else await this.talk(text);
    } finally { this.busy = false; this.onChange(); }
  }

  private latest() {
    const cur = this.archive.current();
    const slots = this.archive.written(this.disk ?? cur.disk);
    return slots[slots.length - 1];
  }
  private why() {
    const s = this.latest();
    if (!s) { this.say('om', 'this disk is still blank. give me a minute.'); return; }
    this.say('sys', `${s.item?.title ?? 'nothing came through'}${s.item?.year ? ` · ${s.item.year}` : ''}`);
    this.say('om', s.note);
  }
  private dir() {
    const cur = this.archive.current(), n = this.disk ?? cur.disk;
    const all = this.archive.written(n), slots = all.slice(-6).reverse();
    if (!slots.length) { this.say('om', 'nothing on this disk yet.'); return; }
    this.say('sys', `DISK ${String(n + 1).padStart(4, '0')} · ${all.length}/90`);
    for (const s of slots) this.say('sys', `${new Date(s.time).toISOString().slice(11, 16)}  ${(s.item?.title ?? '(nothing came through)').slice(0, 54)}`);
  }
  private qday() {
    const q = this.archive.watch?.()?.qday;
    if (!q) { this.say('om', "my clock isn't set yet."); return; }
    const days = Math.round((Date.parse(q.estimate) - this.archive.now()) / 86_400_000);
    this.say('om', `my guess: ${q.estimate.slice(0, 10)}. ${days.toLocaleString('en-US')} days.${q.reason ? ` last moved because ${q.reason}.` : ''} i might be wrong. i hope i'm early.`);
  }
  private async check() {
    const n = this.archive.current().disk - 1;
    if (n < 0) { this.say('om', 'no disk has sealed yet. ninety saves first.'); return; }
    if (!this.archive.verify) { this.say('om', "this is a simulation of me. there's no sealed record here to check."); return; }
    this.say('sys', `CHECK DISK ${String(n + 1).padStart(4, '0')}`);
    try {
      const r = await this.archive.verify(n);
      this.say('sys', `read ${r.bytes.toLocaleString('en-US')} bytes, ${r.records} records`);
      this.say('sys', `sha256 here:      ${r.hash.slice(0, 20)}…`);
      this.say('sys', `sealed with:      ${r.sealed.slice(0, 20)}…`);
      this.say(r.match ? 'om' : 'sys', r.match ? 'MATCH. the disk is exactly what i sealed. you checked it yourself.' : 'MISMATCH. the record has changed since it was sealed.');
      if (r.chain.state === 'pending') this.say('sys', 'on solana: on its way. a seal lands a minute or two after a disk fills.');
      else if (r.chain.state === 'match') this.say('sys', 'on solana: the memo says the same.');
    } catch { this.say('om', "i couldn't reach the archive. try again in a moment."); }
  }
  private async exposed(addr?: string) {
    if (!addr || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) { this.say('om', 'give me a solana address: EXPOSED <address>.'); return; }
    if (!this.api) { this.say('om', "this is a simulation of me; i can't read the chain from here."); return; }
    try {
      const r = await fetch(`${this.api}/api/balance?address=${encodeURIComponent(addr)}`);
      const j = (await r.json()) as { sol?: number };
      if (!r.ok || j.sol === undefined) { this.say('om', r.status === 400 ? "that doesn't look like a wallet." : "the chain didn't answer. try again in a moment."); return; }
      const sol = j.sol;
      this.say('om', sol > 0
        ? `on solana an address is its public key, so this one is already showing. on q-day, the ${sol.toLocaleString('en-US', { maximumFractionDigits: 4 })} SOL here is open. not today. but it's written down.`
        : 'this address is its own public key: open on q-day. it holds nothing, so there is nothing to lose. yet.');
    } catch { this.say('om', "the chain didn't answer. try again in a moment."); }
  }
  /** A visitor's nomination: the server reads the link from its source and answers in the Overmind's voice. */
  private async nominate(url?: string) {
    if (!url) { this.say('om', 'give me a link: SAVE https://archive.org/details/…'); return; }
    if (!this.api) { this.say('om', "this is a simulation of me; i can't take nominations here."); return; }
    try {
      const r = await fetch(`${this.api}/api/nominate`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ url, v: visitor() }) });
      const j = (await r.json()) as { reply?: string };
      this.say('om', j.reply ?? "i couldn't take that one.");
    } catch { this.say('om', 'static on the line. try again?'); }
  }
  private async mine() {
    if (!this.api) { this.say('om', 'nothing here: this is a simulation of me.'); return; }
    try {
      const list = (await (await fetch(`${this.api}/api/nominations?v=${visitor()}`)).json()) as { title: string; status: string; disk: number | null }[];
      if (!list.length) { this.say('om', "you haven't asked me for anything yet. SAVE <link> to try."); return; }
      for (const n of list) this.say('sys', `${n.status === 'saved' ? `KEPT  disk ${String((n.disk ?? 0) + 1).padStart(4, '0')}` : n.status === 'passed' ? 'PASSED          ' : 'WAITING         '}  ${n.title.slice(0, 48)}`);
    } catch { this.say('om', "i couldn't reach my list. try again in a moment."); }
  }
  /** Something the Overmind tells this visitor unprompted (their nomination made it, or didn't). */
  notify(text: string) { this.say('om', text); }

  private async talk(text: string) {
    this.chat.push({ role: 'user', content: text });
    if (!this.api) { this.say('om', 'this is a simulation of me. my voice lives on the real server.'); return; }
    try {
      const r = await fetch(`${this.api}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: this.chat.slice(-8), v: visitor(), disk: this.disk }) });
      const j = (await r.json()) as { reply?: string };
      const reply = j.reply ?? '…';
      this.chat.push({ role: 'assistant', content: reply });
      this.say('om', reply);
    } catch { this.say('om', 'static on the line. say that again?'); }
  }
}
