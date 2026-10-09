import { STRAINS, genLabel, replicas } from '../engine/tower';

export const FOCUS_EVENT = 'replicafocus';
export const BLUR_EVENT = 'replicablur';

/** Visually hidden replica index that appears on keyboard focus (reference: the hidden project list). Newest first. */
export class IndexNav {
  readonly element = document.createElement('nav');
  private list = document.createElement('ul');
  private links: HTMLAnchorElement[] = [];
  private order = [...replicas].sort((a, b) => b.gen - a.gen);

  constructor(after: Element | null) {
    this.element.className = 'index';
    this.element.setAttribute('aria-label', 'Replicas');
    this.order.forEach((rep, i) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      const name = document.createElement('span');
      const details = document.createElement('span');
      name.className = 'index__name';
      name.textContent = `${genLabel(rep.gen)}`;
      details.className = 'index__details';
      details.textContent = `, ${STRAINS[rep.strain]}, ${rep.born}`;
      a.append(name, details);
      a.href = `#replica-${rep.gen}`;
      a.dataset.position = String(i);
      a.dataset.replica = String(rep.index);
      a.addEventListener('click', (e) => e.preventDefault());
      li.appendChild(a);
      this.list.appendChild(li);
      this.links.push(a);
    });
    this.element.appendChild(this.list);
    if (after?.parentElement) after.after(this.element); else document.body.appendChild(this.element);
    this.element.addEventListener('focusin', this.onFocusIn);
    this.element.addEventListener('focusout', this.onFocusOut);
    this.element.addEventListener('keydown', this.onKeyDown);
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
    window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: Number(a?.dataset.replica) }));
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
