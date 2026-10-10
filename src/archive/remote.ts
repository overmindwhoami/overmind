/**
 * The live Overmind (phase 2): the lineage as the service on Railway writes it (server/). The frame loop asks
 * synchronously, so this answers from a cache: the top of the lineage and the live disk's slots are fetched before the
 * page starts; anything older is fetched the first time it is asked for. Server-sent events keep the live disk current
 * (a slot every minute, its media a little later, the seal, the next disk).
 */
import { lookOf, pseudoFingerprint } from './sim';
import { SLOTS, type Archive, type Disk, type Item, type Slot, type Verification, type Watch } from './types';

type DiskJson = {
  n: number; seed: number; fascination: string; written: number; sealed: boolean; fingerprint: string | null; startedAt: number; sealedAt: number | null;
  chain: { url?: string; pending?: boolean; tx?: string; cluster?: string } | null;
};
const RPC: Record<string, string> = { 'mainnet-beta': 'https://api.mainnet-beta.solana.com', devnet: 'https://api.devnet.solana.com', testnet: 'https://api.testnet.solana.com' };
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
type SlotJson = { disk: number; index: number; time: number; item?: Item; note: string; file: string; model: string; every?: number };
const RANGE = 120; // disks fetched per request around the one asked for

export class RemoteArchive implements Archive {
  private base: string;
  private disks = new Map<number, Disk>();
  private slots = new Map<number, Slot[]>();
  private pending = new Set<string>();
  private fetchedAt = new Map<string, number>(); // what was asked recently (a disk that doesn't exist yet isn't asked for every frame)
  private cur = { disk: 0, written: 0 };
  private nextAt = 0;
  private offset = 0;
  private stale = false;
  private watched?: Watch;
  private every = 60_000;

  constructor(base: string) { this.base = base.replace(/\/+$/, ''); }

  /** Never fails the page: if the service can't be reached, it keeps trying (the event stream reconnects and resyncs). */
  async load() {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await this.sync(); break; } catch (e) {
        console.warn('Overmind unreachable, retrying', e);
        this.stale = true;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    this.listen();
  }

  now() { return Date.now() + this.offset; }
  current() { return { disk: this.cur.disk, written: Math.min(this.cur.written, SLOTS), msToNext: Math.max(0, this.nextAt - Date.now()) }; }
  sealedCount() { return this.cur.disk; }
  watch() { return this.watched; }

  disk(n: number): Disk {
    const d = this.disks.get(n);
    if (d) return d;
    const from = Math.max(0, n - RANGE + 1);
    void this.fetch(`disks:${from}`, `/api/disks?from=${from}&to=${n}`, (list: DiskJson[]) => list.forEach((x) => this.putDisk(x)));
    // until it arrives: a sealed disk with its look (the label and HUD fill in when the record lands)
    const sealed = n < this.cur.disk;
    return { n, seed: 0, startedAt: 0, sealedAt: 0, sealed, written: sealed ? SLOTS : 0, fingerprint: pseudoFingerprint(n, n), fascination: '', look: lookOf(n).look };
  }

  written(n: number): Slot[] {
    const s = this.slots.get(n);
    if (s) return s;
    void this.fetchSlots(n);
    return [];
  }
  slot(n: number, k: number): Slot {
    return this.written(n)[k] ?? { disk: n, index: k, time: 0, note: '', file: '' };
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.base + path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json() as Promise<T>;
  }
  private async fetch<T>(key: string, path: string, apply: (data: T) => void) {
    if (this.pending.has(key) || Date.now() - (this.fetchedAt.get(key) ?? 0) < 10_000) return;
    this.pending.add(key);
    try { apply(await this.get<T>(path)); } catch (e) { console.warn('archive', path, e); }
    this.fetchedAt.set(key, Date.now());
    this.pending.delete(key);
  }
  private fetchSlots(n: number) {
    return this.fetch(`slots:${n}`, `/api/disks/${n}`, (r: { disk: DiskJson; slots: SlotJson[] }) => {
      this.putDisk(r.disk);
      this.slots.set(n, r.slots.map((s) => this.toSlot(s)));
    });
  }

  /** The state, the top of the lineage and the live disk's slots (on start, and after the event stream drops). */
  private async sync() {
    const st = await this.get<{ now: number; disk: DiskJson | null; msToNext: number; every?: number; watch?: Watch }>('/api/state');
    if (st.every) this.every = st.every;
    this.watched = st.watch;
    this.offset = st.now - Date.now();
    this.nextAt = Date.now() + st.msToNext;
    const known = st.disk ? this.disks.get(st.disk.n) : undefined;
    if (st.disk && (st.disk.n < this.cur.disk || (known?.startedAt && Math.abs(known.startedAt - st.disk.startedAt) > 1000))) return this.restarted();
    if (st.disk) { this.putDisk(st.disk); this.cur = { disk: st.disk.n, written: st.disk.written }; }
    this.pending.clear();
    this.fetchedAt.clear();
    const from = Math.max(0, this.cur.disk - RANGE + 1);
    await Promise.all([
      this.fetch(`disks:${from}`, `/api/disks?from=${from}&to=${this.cur.disk}`, (list: DiskJson[]) => list.forEach((x) => this.putDisk(x))),
      this.fetchSlots(this.cur.disk),
    ]);
  }

  private listen() {
    const es = new EventSource(`${this.base}/api/events`);
    es.addEventListener('slot', (e) => {
      const raw = JSON.parse((e as MessageEvent).data) as SlotJson;
      if (raw.every) this.every = raw.every;
      const s = this.toSlot(raw);
      if (s.disk < this.cur.disk) return this.restarted();
      // the same slot again, written at a different time: the lineage was reset and is writing over its old numbers
      const same = this.slots.get(s.disk)?.find((x) => x.index === s.index);
      if (same && same.time && Math.abs(same.time - s.time) > 1000) return this.restarted();
      const list = this.slots.get(s.disk) ?? [];
      if (!list.some((x) => x.index === s.index)) list.push(s);
      this.slots.set(s.disk, list);
      const d = this.disks.get(s.disk);
      if (d) d.written = Math.max(d.written, s.index + 1);
      if (s.disk === this.cur.disk) this.cur.written = Math.max(this.cur.written, s.index + 1);
      this.nextAt = s.time + this.every + 400 - this.offset; // the server's pace (fast while it writes its backlog)
    });
    es.addEventListener('media', (e) => {
      const m = JSON.parse((e as MessageEvent).data) as { disk: number; k: number; media?: string; clip?: string };
      const item = this.slots.get(m.disk)?.find((s) => s.index === m.k)?.item;
      if (item) Object.assign(item, this.absolute({ media: m.media, clip: m.clip }));
    });
    es.addEventListener('seal', (e) => {
      const { n, fingerprint } = JSON.parse((e as MessageEvent).data) as { n: number; fingerprint: string };
      const d = this.disks.get(n);
      if (d) Object.assign(d, { sealed: true, fingerprint, written: SLOTS, sealedAt: this.now(), chain: d.chain?.url ? d.chain : { pending: true } });
    });
    es.addEventListener('chain', (e) => {
      const { n, url } = JSON.parse((e as MessageEvent).data) as { n: number; url: string };
      const d = this.disks.get(n);
      if (d) d.chain = { url };
    });
    es.addEventListener('disk', (e) => {
      const d = JSON.parse((e as MessageEvent).data) as DiskJson;
      // a disk that starts again (earlier number, or the same number with a new start time) means the lineage was reset
      const known = this.disks.get(d.n);
      if (d.n < this.cur.disk || (known && known.startedAt && Math.abs(known.startedAt - d.startedAt) > 1000)) return this.restarted();
      this.putDisk(d);
      if (!this.slots.has(d.n)) this.slots.set(d.n, []);
      if (d.n > this.cur.disk) this.cur = { disk: d.n, written: d.written };
    });
    es.addEventListener('watch', (e) => { this.watched = JSON.parse((e as MessageEvent).data) as Watch; });
    es.onerror = () => { this.stale = true; };
    es.onopen = () => { if (this.stale) { this.stale = false; void this.sync(); } };
  }

  /**
   * CHECK, done here and not on trust: fetch the disk's record (the exact text that was hashed when it sealed),
   * SHA-256 it in this browser, compare with the fingerprint the lineage gave for it; then ask Solana itself for the
   * seal's memo and compare that too.
   */
  async verify(n: number): Promise<Verification> {
    const res = await fetch(`${this.base}/api/disks/${n}/record`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} record`);
    const text = await res.text();
    const bytes = new TextEncoder().encode(text);
    const hash = hex(await crypto.subtle.digest('SHA-256', bytes));
    const d = this.disks.get(n);
    const sealed = d?.fingerprint ?? '';
    let records = 0;
    try { records = (JSON.parse(text) as unknown[]).length; } catch { /* counted as 0 */ }
    const chain: Verification['chain'] = { state: d?.chain?.tx ? 'unreachable' : d?.chain?.pending ? 'pending' : 'none', tx: d?.chain?.tx, url: d?.chain?.url };
    if (d?.chain?.tx) {
      try {
        const rpc = RPC[d.chain.cluster ?? 'mainnet-beta'] ?? RPC['mainnet-beta'];
        const r = await fetch(rpc, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [d.chain.tx, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }] }),
        });
        const tx = (await r.json()) as { result?: { meta?: { logMessages?: string[] } } };
        const memo = tx.result?.meta?.logMessages?.find((l) => l.includes('Memo'));
        if (memo) chain.state = memo.includes(`sha256:${hash}`) ? 'match' : 'mismatch';
      } catch { /* stays unreachable */ }
    }
    return { bytes: bytes.length, records, hash, sealed, match: hash === sealed, chain };
  }

  /** The sealing wallet, as the service reports it (address and balance in SOL; null while unknown). */
  async wallet(): Promise<{ address: string; balance: number | null } | undefined> {
    try { return (await this.get<{ wallet?: { address: string; balance: number | null } }>('/health')).wallet; } catch { return undefined; }
  }

  /** The lineage went backwards: it was reset (at launch). Everything on the page belongs to the old one, so start over. */
  private restarted() {
    if (this.reloading) return;
    this.reloading = true;
    window.location.reload();
  }
  private reloading = false;

  private putDisk(x: DiskJson) {
    const prev = this.disks.get(x.n);
    const d: Disk = {
      n: x.n, seed: x.seed, startedAt: x.startedAt, sealedAt: x.sealedAt ?? x.startedAt + SLOTS * 60_000, sealed: x.sealed, written: x.written,
      fingerprint: x.fingerprint ?? pseudoFingerprint(x.seed, x.n), fascination: x.fascination, look: lookOf(x.n).look,
      chain: x.chain ?? undefined,
    };
    // keep the object identity (callers hold on to it) and never move a disk backwards
    if (prev) Object.assign(prev, d, { written: Math.max(prev.written, d.written), sealed: prev.sealed || d.sealed });
    else this.disks.set(x.n, d);
  }
  private absolute<T extends { media?: string; clip?: string }>(m: T): T {
    const abs = (p?: string) => (p && p.startsWith('/') ? this.base + p : p);
    return { ...m, media: abs(m.media), clip: abs(m.clip) };
  }
  private toSlot(s: SlotJson): Slot {
    return { disk: s.disk, index: s.index, time: s.time, item: s.item ? this.absolute(s.item) : undefined, note: s.note, file: s.file };
  }
}
