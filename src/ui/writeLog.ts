/**
 * The write log: what the Overmind is doing right now, in words. It sits beside the live disk at the top of the
 * lineage: which disk is being written, how far along it is (the same 90 ticks as the disk's label), when the next
 * save lands, and the last few saves with the newest note typing on. When a disk seals, the log says so and starts
 * the next one. It fades away as you scroll down the lineage, where the hover instrument takes over.
 * Above it, when the archive keeps one (the live service), the Q-Day watch: the Overmind's own guess at Q-Day with a
 * countdown and its last move, and what it keeps an eye on (Bitcoin keys shown, Solana activity, the sun).
 */
import { SLOTS, type Slot, type Watch } from '../archive/types';
import { fmtDisk, fmtTime, type Archive } from '../archive/sim';
import { clientOf } from '../hud/source';

const SHOWN = 5; // entries in the list (the newest with its note)
const TYPE_RATE = 46; // characters per second for the newest note
const SEAL_HOLD = 7; // seconds the header says "sealed" before the next disk starts

/** 0:42 under an hour; 14h 05m under a day; then days. */
const wait = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h < 24 ? `${h}h ${String(m).padStart(2, '0')}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
/** "on Oct 10 at 17:00 UTC" */
const wakeTime = (t: number) => {
  const d = new Date(t);
  return `on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} at ${d.toISOString().slice(11, 16)} UTC`;
};

type Entry = { key: string; el: HTMLLIElement; note?: HTMLElement; text?: string; seal?: number; chain?: HTMLAnchorElement };

export class WriteLog {
  private head: HTMLElement;
  private state: HTMLElement;
  private disk: HTMLElement;
  private fill: HTMLElement;
  private count: HTMLElement;
  private next: HTMLElement;
  private list: HTMLOListElement;
  private entries: Entry[] = [];
  private lastDisk = -1;
  private lastWritten = -1;
  private sealUntil = 0;
  private sealedDisk = -1;
  private typed = 0;
  private clock = 0;
  private lastCountdown = '';
  private lastWatch = '';

  constructor(private root: HTMLElement, private archive: Archive, private reduced: () => boolean) {
    const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    this.head = q('[data-log-head]');
    this.state = q('[data-log-state]');
    this.disk = q('[data-log-disk]');
    this.fill = q('[data-log-fill]');
    this.count = q('[data-log-count]');
    this.next = q('[data-log-next]');
    this.list = q<HTMLOListElement>('[data-log-list]');
  }

  update(dt: number) {
    this.clock += dt;
    const cur = this.archive.current();
    if (this.lastDisk < 0) {
      // first frame: fill the list with what is already on the live disk (and the seal of the one before it)
      this.lastDisk = cur.disk;
      this.lastWritten = cur.written;
      if (cur.written === 0 && cur.disk > 0) this.add(this.sealEntry(cur.disk - 1));
      for (const s of this.archive.written(cur.disk).slice(-SHOWN)) this.add(this.slotEntry(s));
      this.typed = Infinity;
    } else if (cur.disk !== this.lastDisk) {
      // a seal: the rest of the old disk's slots (if the tab slept), the seal line, then the new disk's
      for (let k = this.lastWritten; k < SLOTS; k++) this.add(this.slotEntry(this.archive.slot(this.lastDisk, k)));
      this.add(this.sealEntry(this.lastDisk));
      for (const s of this.archive.written(cur.disk)) this.add(this.slotEntry(s));
      this.sealedDisk = this.lastDisk;
      this.sealUntil = this.clock + SEAL_HOLD;
      this.lastDisk = cur.disk;
      this.lastWritten = cur.written;
      this.typed = 0;
    } else if (cur.written !== this.lastWritten) {
      for (let k = this.lastWritten; k < cur.written; k++) this.add(this.slotEntry(this.archive.slot(cur.disk, k)));
      this.lastWritten = cur.written;
      this.typed = 0;
      this.root.classList.remove('is-saving');
      void this.root.offsetWidth; // restart the save flash
      this.root.classList.add('is-saving');
    }

    // header: writing, or sealed for a moment after a seal
    const sealing = this.clock < this.sealUntil;
    const n = sealing ? this.sealedDisk : cur.disk;
    const written = sealing ? SLOTS : cur.written;
    const sleeping = !sealing && cur.written === 0 && cur.msToNext > 120_000; // before launch
    this.root.classList.toggle('is-sealed', sealing || sleeping);
    this.state.textContent = sealing ? 'Sealed' : sleeping ? 'Asleep' : 'Writing';
    this.disk.textContent = fmtDisk(n);
    this.fill.style.width = `${(written / SLOTS) * 100}%`;
    this.count.textContent = `${written} / ${SLOTS}`;
    const asleep = cur.written === 0 && cur.msToNext > 120_000; // before launch: the Overmind hasn't woken yet
    const countdown = sealing ? 'write-protect on' : asleep ? `asleep · wakes in ${wait(cur.msToNext)}` : cur.written === 0 ? `blank · first save in ${wait(cur.msToNext)}` : `next save in ${wait(Math.min(cur.msToNext, 59_000))}`;
    if (countdown !== this.lastCountdown) { this.next.textContent = countdown; this.lastCountdown = countdown; }
    this.head.setAttribute('aria-label', `${this.state.textContent} ${fmtDisk(n)}, ${written} of ${SLOTS} saved`);

    this.renderWatch(this.archive.watch?.());

    // before the first save of a disk: say it's blank (at launch, that's the genesis disk)
    if (!this.entries.length && !this.list.querySelector('.log__empty')) {
      const li = document.createElement('li');
      li.className = 'log__entry log__empty';
      this.list.append(li);
    }
    const empty = this.list.querySelector<HTMLElement>('.log__empty');
    if (empty) {
      const text = cur.written === 0 && cur.msToNext > 120_000
        ? `Genesis. The Overmind is asleep. It wakes ${wakeTime(this.archive.now() + cur.msToNext)}, and the first thing lands that minute.`
        : cur.disk === 0 ? 'Genesis. Nothing saved yet: the first thing lands at the top of the minute.' : 'Blank. The first thing lands at the top of the minute.';
      if (empty.textContent !== text) empty.textContent = text;
    }

    // a seal's on-chain link appears once its transaction confirms (live archive only)
    for (const e of this.entries) {
      if (e.seal === undefined || e.chain?.href) continue;
      const url = this.archive.disk(e.seal).chain?.url;
      if (!url) continue;
      e.chain ??= Object.assign(document.createElement('a'), { className: 'log__chain link', target: '_blank', rel: 'noopener' });
      e.chain.href = url;
      e.chain.textContent = 'on chain ↗';
      e.el.querySelector('.log__meta')!.append(' · ', e.chain);
    }

    // the newest note types on
    const top = this.entries[0];
    if (top?.note && top.text) {
      if (this.typed < top.text.length) this.typed = this.reduced() ? Infinity : this.typed + dt * TYPE_RATE;
      const shown = Math.min(top.text.length, Math.floor(this.typed));
      if (top.note.textContent!.length !== shown) top.note.textContent = top.text.slice(0, shown);
      top.note.classList.toggle('is-typing', shown < top.text.length);
    }
  }

  private renderWatch(w: Watch | undefined) {
    const day = new Date().toISOString().slice(0, 10);
    const key = JSON.stringify([w, day]);
    if (key === this.lastWatch) return;
    this.lastWatch = key;
    const root = this.root.querySelector<HTMLElement>('[data-watch]')!;
    root.hidden = !w?.qday;
    if (!w?.qday) return;
    const q = w.qday, n = (v: number) => v.toLocaleString('en-US');
    const days = Math.round((Date.parse(q.estimate) - Date.parse(day)) / 86400_000);
    root.querySelector('[data-qday]')!.textContent = q.estimate;
    root.querySelector('[data-qday-left]')!.textContent = days > 0 ? `T−${n(days)} days` : 'today, by its count';
    const move = root.querySelector<HTMLElement>('[data-qday-move]')!;
    move.hidden = !q.shift;
    if (q.shift) move.textContent = `${q.shift < 0 ? '▲' : '▼'} ${n(Math.abs(q.shift))} day${Math.abs(q.shift) === 1 ? '' : 's'} ${q.shift < 0 ? 'closer' : 'further'}${q.reason ? `: ${q.reason}` : ''}`;
    const stat = (k: string, v: string | undefined) => {
      const row = root.querySelector<HTMLElement>(`[data-stat="${k}"]`)!;
      row.hidden = !v;
      if (v) row.querySelector('dd')!.textContent = v;
    };
    stat('bitcoin', w.bitcoin ? n(w.bitcoin.spentHour) : undefined);
    stat('solana', w.solana ? n(w.solana.txMinute) : undefined);
    stat('space', w.space ? (w.space.storm ? `${w.space.storm} storm · Kp ${w.space.kp}` : w.space.forecast ? `quiet · ${w.space.forecast} storm watch` : `quiet · Kp ${w.space.kp}`) : undefined);
  }

  private slotEntry(s: Slot): Entry {
    const el = document.createElement('li');
    el.className = 'log__entry';
    const item = s.item;
    const meta = item ? [clientOf(item), item.year].filter(Boolean).join(' · ') : 'a gap, kept honest';
    el.innerHTML = '<time></time><span class="log__title"></span><span class="log__meta"></span><q class="log__note"></q>';
    el.querySelector('time')!.textContent = fmtTime(s.time);
    el.querySelector('.log__title')!.textContent = item?.title ?? 'Nothing came through';
    el.querySelector('.log__meta')!.textContent = meta;
    return { key: `${s.disk}:${s.index}`, el, note: el.querySelector<HTMLElement>('.log__note')!, text: s.note };
  }

  private sealEntry(n: number): Entry {
    const d = this.archive.disk(n);
    const el = document.createElement('li');
    el.className = 'log__entry log__entry--seal';
    el.innerHTML = '<time></time><span class="log__title"></span><span class="log__meta"></span>';
    el.querySelector('time')!.textContent = fmtTime(d.sealedAt);
    el.querySelector('.log__title')!.textContent = `${fmtDisk(n)} sealed`;
    el.querySelector('.log__meta')!.textContent = `90 saved · liked ${d.fascination} · 0x${d.fingerprint.slice(0, 8)}`;
    return { key: `seal:${n}`, el, seal: n };
  }

  private add(e: Entry) {
    if (this.entries.some((x) => x.key === e.key)) return;
    const prev = this.entries[0];
    if (prev?.note && prev.text) { prev.note.textContent = prev.text; prev.note.classList.remove('is-typing'); }
    this.list.querySelector('.log__empty')?.remove();
    this.entries.unshift(e);
    this.list.prepend(e.el);
    while (this.entries.length > SHOWN) this.entries.pop()!.el.remove();
    this.entries.forEach((x, i) => x.el.style.setProperty('--age', String(i)));
  }
}
