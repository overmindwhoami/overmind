/**
 * The vending machine, until lifeboat tickets are ready: what they are and that they're coming. Nothing to connect,
 * print, download or load here (the working sheet, src/ui/mint.ts, runs only in local development with ?lifeboat).
 */
export class LifeboatSoon {
  readonly root = document.createElement('section');

  constructor() {
    this.root.className = 'sheet mint';
    this.root.setAttribute('aria-label', 'Lifeboat tickets, coming soon');
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.innerHTML = `
      <p class="sheet__eyebrow">LIFEBOAT TICKETS · COMING SOON</p>
      <p class="sheet__voice">&gt; this machine will print lifeboat tickets: keys a quantum computer can't forge.</p>
      <ul class="sheet__list">
        <li>a ticket is a one-time key, made in your own browser and kept by you as a floppy disk image. nobody else ever has it.</li>
        <li>what you put in its vault comes out only with that ticket. it signs with hashes (winternitz signatures), the kind that hold up after q-day.</li>
        <li>it signs once: take some out, and the rest moves to a fresh ticket.</li>
      </ul>
      <p class="sheet__fine">it's being tested now. it opens here when it's ready; until then there's nothing to connect, print or save.</p>`;
    document.body.appendChild(this.root);
  }
  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }
}
