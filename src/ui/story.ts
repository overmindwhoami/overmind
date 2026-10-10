/**
 * The story in the corner (docs/concept/05-landing-layers.md): a few lines that say what is on screen, one at a time.
 * Plain lines rise in; the Overmind's own lines type out like its notes; the last line can carry the "check a disk" link.
 */
export interface Line { text: string; kind?: 'plain' | 'voice' | 'hint'; check?: boolean; tour?: boolean }

export class Story {
  private lines: { el: HTMLElement; line: Line }[] = [];
  private typing?: { el: HTMLElement; text: string; at: number };
  private key = '';

  constructor(private root: HTMLElement, private onCheck: () => void, private reduced: () => boolean, private onTour?: () => void) {}

  /** Replaces everything with `lines` at once (a settled state), unless it already shows them. */
  set(key: string, lines: Line[]) {
    if (key === this.key) return;
    this.root.textContent = '';
    this.lines = [];
    this.typing = undefined;
    for (const l of lines) this.add(l, false);
    this.key = key;
  }

  /** Names what is showing now, without changing it (so a later `set` with the same key leaves it alone). */
  mark(key: string) { this.key = key; }

  /** Adds a line under the others; `animate` makes it rise in (or type out, for the Overmind's voice). */
  add(line: Line, animate = true) {
    this.key = '';
    const el = document.createElement('p');
    el.className = `story__line story__line--${line.kind ?? 'plain'}`;
    if (line.kind === 'voice' && animate && !this.reduced()) {
      el.classList.add('is-typing');
      this.typing = { el, text: line.text, at: performance.now() };
    } else el.textContent = line.text;
    if (line.check) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'story__check link';
      b.textContent = 'check a disk →';
      b.addEventListener('click', () => this.onCheck());
      el.append(' ', b);
    }
    if (line.tour && this.onTour) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'story__check story__tour link';
      b.textContent = 'how it works ↺';
      b.addEventListener('click', () => this.onTour?.());
      el.append(document.createElement('br'), b);
    }
    if (animate) el.classList.add('is-new');
    this.root.appendChild(el);
    this.lines.push({ el, line });
  }

  /** Drops the first line (it fades as the next one arrives). */
  shift() {
    const first = this.lines.shift();
    if (!first) return;
    first.el.classList.add('is-leaving');
    setTimeout(() => first.el.remove(), 600);
  }

  /** Types the voice line out, at the pace of the Overmind's notes. */
  update() {
    const t = this.typing;
    if (!t) return;
    const n = Math.min(t.text.length, Math.floor((performance.now() - t.at) / 55));
    if (t.el.textContent !== t.text.slice(0, n)) t.el.textContent = t.text.slice(0, n);
    if (n >= t.text.length) { t.el.classList.remove('is-typing'); this.typing = undefined; }
  }
}
