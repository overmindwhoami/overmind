import type { Archive } from '../archive/sim';
import { fmtDate, fmtDisk, fmtTime } from '../archive/sim';
import { SLOTS } from '../archive/types';

export const FOCUS_EVENT = 'diskfocus';
export const BLUR_EVENT = 'diskblur';
export const READ_EVENT = 'diskread';
const SHOWN = 120; // most recent disks listed (the tower itself reaches further back)

/**
 * Visually hidden disk index that appears on keyboard focus (reference: the hidden project list). Newest first:
 * focusing a disk flies the camera to it; Enter or a click reads it in the machine. Refreshes when a disk seals.
 */
export class IndexNav {
  readonly element = document.createElement('nav');
  private list = document.createElement('ul');
  private links: HTMLAnchorElement[] = [];
  private built = -1;

  constructor(after: Element | null, private archive: Archive) {
    this.element.className = 'index';
    this.element.setAttribute('aria-label', 'Disks');
    this.element.appendChild(this.list);
    if (after?.parentElement) after.after(this.element); else document.body.appendChild(this.element);
    this.element.addEventListener('focusin', this.onFocusIn);
    this.element.addEventListener('focusout', this.onFocusOut);
    this.element.addEventListener('keydown', this.onKeyDown);
    this.refresh();
    window.setInterval(() => this.refresh(), 5000);
  }

  /** Rebuild when the live disk has changed (a disk sealed), unless someone is moving through the list. */
  refresh() {
    const live = this.archive.current().disk;
    if (live === this.built || this.element.contains(document.activeElement)) return;
    this.built = live;
    this.list.replaceChildren();
    this.links = [];
    for (let n = live, i = 0; n >= 0 && i < SHOWN; n--, i++) {
      const d = this.archive.disk(n);
      const li = document.createElement('li');
      const a = document.createElement('a');
      const name = document.createElement('span');
      const details = document.createElement('span');
      name.className = 'index__name';
      name.textContent = fmtDisk(n);
      details.className = 'index__details';
      details.textContent = d.sealed ? `, sealed ${fmtDate(d.sealedAt)} ${fmtTime(d.sealedAt)}, ${SLOTS} files` : `, writing now, ${d.written} of ${SLOTS}`;
      a.append(name, details);
      a.href = `#disk-${n + 1}`;
      a.dataset.position = String(i);
      a.dataset.disk = String(n);
      a.addEventListener('click', (e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent(READ_EVENT, { detail: n })); });
      li.appendChild(a);
      this.list.appendChild(li);
      this.links.push(a);
    }
  }

  private highlight(position: number) {
    this.element.style.setProperty('--active', String(position));
    this.links.forEach((a, i) => {
      a.parentElement?.style.setProperty('--distance', String(Math.min(Math.abs(i - position), 6)));
      a.parentElement?.classList.toggle('is-active', i === position);
    });
  }

  private onFocusIn = (e: FocusEvent) => {
    const a = e.target as HTMLElement | null;
    const position = Number(a?.dataset.position);
    if (Number.isNaN(position)) return;
    this.highlight(position);
    window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: Number(a?.dataset.disk) }));
  };

  private onFocusOut = (e: FocusEvent) => {
    if (e.relatedTarget instanceof Node && this.element.contains(e.relatedTarget)) return;
    window.dispatchEvent(new CustomEvent(BLUR_EVENT));
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const i = this.links.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === 'Escape') { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); return; }
    const step = ({ ArrowDown: 1, ArrowRight: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
    if (step === undefined || i === -1) return;
    e.preventDefault();
    e.stopPropagation();
    this.links[(i + step + this.links.length) % this.links.length]?.focus();
  };
}
