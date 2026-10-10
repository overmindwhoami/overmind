/**
 * The walkthrough: the Overmind shows a first-time visitor what they're looking at, one part at a time, in its own
 * voice. Each stop locks an instrument frame onto a part of the scene (the hover instrument's corner brackets, its
 * 20 Hz strobe pop and its size readout, design-system/motion.ts HUD), dims everything else with the spotlight token,
 * and types one line beside it with a leader running from the frame to the words. Short by design: a line, a beat,
 * the next part. A click, Enter or → moves on; Esc or "skip" ends it.
 */
import { HUD } from '../../design-system/motion';

export interface Rect { left: number; top: number; width: number; height: number }
export interface TourStop { title: string; line: string }

const PAD = 14; // air between the part and the frame
const GAP = 40; // frame to words
const TYPE_MS = 30; // per character: quicker than the notes, the line has to land in a glance

export class Walkthrough {
  readonly root: HTMLElement;
  private frame: HTMLElement;
  private tag: HTMLElement;
  private size: HTMLElement;
  private card: HTMLElement;
  private step: HTMLElement;
  private text: HTMLElement;
  private ticks: HTMLElement;
  private leader: SVGLineElement;
  private leaderUnder: SVGLineElement;
  private shown?: Rect;
  private typedAt = 0;
  private line = '';
  private total = 0;
  active = false;

  constructor(private on: { next: () => void; skip: () => void }, private reduced: () => boolean) {
    this.root = document.createElement('div');
    this.root.className = 'tour';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'How Overmind works');
    this.root.innerHTML = `
      <svg class="tour__lines" aria-hidden="true"><line class="tour__under" pathLength="1" /><line class="tour__leader" pathLength="1" /></svg>
      <div class="tour__frame" aria-hidden="true">
        <span class="tour__corner tour__corner--tl"></span><span class="tour__corner tour__corner--tr"></span>
        <span class="tour__corner tour__corner--bl"></span><span class="tour__corner tour__corner--br"></span>
        <span class="tour__tag"></span><span class="tour__size"></span>
      </div>
      <div class="tour__card">
        <p class="tour__step"></p>
        <p class="tour__line" aria-live="polite"></p>
        <div class="tour__foot">
          <span class="tour__ticks" aria-hidden="true"></span>
          <button class="tour__btn tour__btn--next" type="button">next <span aria-hidden="true">⏎</span></button>
          <button class="tour__btn tour__btn--skip" type="button">skip <span aria-hidden="true">esc</span></button>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    const q = <T extends Element>(s: string) => this.root.querySelector(s) as T;
    this.frame = q('.tour__frame'); this.tag = q('.tour__tag'); this.size = q('.tour__size');
    this.card = q('.tour__card'); this.step = q('.tour__step'); this.text = q('.tour__line'); this.ticks = q('.tour__ticks');
    this.leader = q('.tour__leader'); this.leaderUnder = q('.tour__under');
    q('.tour__btn--next').addEventListener('click', (e) => { e.stopPropagation(); this.on.next(); });
    q('.tour__btn--skip').addEventListener('click', (e) => { e.stopPropagation(); this.on.skip(); });
    this.card.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  start(total: number) {
    this.total = total;
    this.active = true;
    this.shown = undefined;
    this.ticks.innerHTML = Array.from({ length: total }, () => '<i></i>').join('');
    document.documentElement.dataset.tour = 'on';
  }
  end() {
    this.active = false;
    delete document.documentElement.dataset.tour;
  }

  /** Shows stop `i`: the frame locks on afresh (the pop and strobe), the line starts typing. */
  show(i: number, stop: TourStop) {
    this.step.textContent = `${String(i + 1).padStart(2, '0')} / ${String(this.total).padStart(2, '0')}`;
    this.tag.textContent = stop.title.toUpperCase();
    this.line = stop.line;
    this.typedAt = performance.now();
    this.text.textContent = '';
    this.text.classList.add('is-typing');
    [...this.ticks.children].forEach((t, k) => t.classList.toggle('is-done', k <= i));
    for (const el of [this.frame, this.card]) { el.classList.remove('is-locking'); void (el as HTMLElement).offsetWidth; el.classList.add('is-locking'); }
    this.leader.classList.remove('is-drawn'); this.leaderUnder.classList.remove('is-drawn');
    void this.leader.getBoundingClientRect();
    this.leader.classList.add('is-drawn'); this.leaderUnder.classList.add('is-drawn');
  }

  /** Seconds until the line has typed out (0 once it has). */
  get typingLeft() { return Math.max(0, (this.line.length * TYPE_MS - (performance.now() - this.typedAt)) / 1000); }
  get lineLength() { return this.line.length; }

  /** Per frame: follow the part on screen (it moves with the camera), type, keep the words and the leader beside it. */
  update(rect: Rect | undefined, dt: number) {
    if (!this.active) return;
    // type
    const n = this.reduced() ? this.line.length : Math.min(this.line.length, Math.floor((performance.now() - this.typedAt) / TYPE_MS));
    const shownText = `> ${this.line.slice(0, n)}`;
    if (this.text.textContent !== shownText) this.text.textContent = shownText;
    if (n >= this.line.length) this.text.classList.remove('is-typing');
    if (!rect) { this.root.classList.add('is-lost'); return; }
    this.root.classList.remove('is-lost');
    // the frame: the part's box with air round it, kept on screen, eased toward it (the camera may still be moving)
    const W = window.innerWidth, H = window.innerHeight, m = 8;
    const left = Math.max(m, rect.left - PAD), top = Math.max(m, rect.top - PAD);
    const t: Rect = { left, top, width: Math.min(W - m, rect.left + rect.width + PAD) - left, height: Math.min(H - m, rect.top + rect.height + PAD) - top };
    const k = this.shown ? 1 - Math.exp(-dt * 14) : 1;
    const s = (this.shown ??= { ...t });
    s.left += (t.left - s.left) * k; s.top += (t.top - s.top) * k; s.width += (t.width - s.width) * k; s.height += (t.height - s.height) * k;
    Object.assign(this.frame.style, { transform: `translate(${s.left}px, ${s.top}px)`, width: `${s.width}px`, height: `${s.height}px` });
    this.size.textContent = `w ${Math.round(rect.width)}  h ${Math.round(rect.height)}`;
    this.place(s);
  }

  /**
   * The words go where they stay in the dimmed part of the screen: right of the frame, else left, under, above; a frame
   * too big for any of those (the lineage) keeps them in the bottom corner. Phones: always the bottom, no leader.
   */
  private place(f: Rect) {
    const W = window.innerWidth, H = window.innerHeight, phone = W <= 640, gutter = phone ? 16 : 24, top = 84, bottom = phone ? 92 : 56;
    const cw = this.card.offsetWidth, ch = this.card.offsetHeight;
    const fits = (x: number, y: number) => x >= gutter && x + cw <= W - gutter && y >= top && y + ch <= H - bottom;
    const clampY = (y: number) => Math.min(Math.max(y, top), H - bottom - ch);
    const clampX = (x: number) => Math.min(Math.max(x, gutter), W - gutter - cw);
    const options: [number, number, number, number][] = phone ? [] : [
      [f.left + f.width + GAP, clampY(f.top + f.height / 2 - ch / 2), -8, 22], // right
      [f.left - GAP - cw, clampY(f.top + f.height / 2 - ch / 2), cw + 8, 22], // left
      [clampX(f.left), f.top + f.height + GAP, 10, -8], // under
      [clampX(f.left), f.top - GAP - ch, 10, ch + 8], // above
    ];
    const pick = options.find(([x, y]) => fits(x, y));
    let x: number, y: number, ax: number, ay: number, leader = !!pick;
    if (pick) { [x, y] = pick; ax = x + pick[2]; ay = y + pick[3]; }
    else { x = gutter; y = H - bottom - ch; ax = x + 10; ay = y - 8; leader = false; }
    this.root.classList.toggle('no-leader', !leader);
    this.card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    // the leader leaves the frame from the corner nearest the words
    const fx = ax < f.left ? f.left : ax > f.left + f.width ? f.left + f.width : ax;
    const fy = ay < f.top ? f.top : ay > f.top + f.height ? f.top + f.height : ay;
    for (const l of [this.leader, this.leaderUnder]) {
      l.setAttribute('x1', String(fx)); l.setAttribute('y1', String(fy)); l.setAttribute('x2', String(ax)); l.setAttribute('y2', String(ay));
    }
    this.root.classList.toggle('is-phone', phone);
  }
}

/** The lock-on timing, from the instrument's tokens (CSS reads them as custom properties). */
export const TOUR_TIMING = { flash: HUD.flash, pop: HUD.pop, popScaleFrom: HUD.popScaleFrom, strobeHz: HUD.strobeHz };
