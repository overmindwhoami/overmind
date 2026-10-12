import './styles.css';
import { IndexNav } from './ui/indexNav';
import { App } from './engine/app';
import { SimArchive } from './archive/sim';
import { RemoteArchive } from './archive/remote';

const PLACE_NAMES = ['room', 'docs', 'omd', 'terminal', 'launch', 'explorer', 'mint'] as const;
type Place = (typeof PLACE_NAMES)[number] | 'tower';
/** The page opens on the tower; a hash names a place (#room, #omd, …) or a disk to read (#disk-15). */
const placeOf = (hash: string): Place => (PLACE_NAMES as readonly string[]).includes(hash.slice(1)) ? (hash.slice(1) as Place) : 'tower';
const coinOf = (hash: string) => /^#coin-([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(hash)?.[1];
const diskOf = (hash: string) => { const m = /^#disk-(\d{1,6})$/.exec(hash); return m && +m[1] > 0 ? +m[1] - 1 : undefined; };

/** The menu: each item flies the camera to its place in the room; the back button, Esc and the logo return to the room. */
function wirePlaces(app: App) {
  const back = document.querySelector<HTMLButtonElement>('.back');
  const items = document.querySelectorAll<HTMLAnchorElement>('[data-go]');
  const mark = () => {
    for (const a of items) a.setAttribute('aria-current', String(a.dataset.go === app.place));
    if (back) back.hidden = app.place === 'room';
  };
  for (const el of document.querySelectorAll<HTMLElement>('[data-go]')) el.addEventListener('click', (e) => {
    e.preventDefault();
    app.go(el.dataset.go as Place);
    mark();
  });
  document.querySelector('.logo')?.addEventListener('click', (e) => { e.preventDefault(); app.go('tower'); mark(); }); // never a reload
  window.addEventListener('placechange', mark);
  window.addEventListener('wheel', () => queueMicrotask(mark), { passive: true });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') queueMicrotask(mark); });
  const route = () => { const d = diskOf(window.location.hash), c = coinOf(window.location.hash); if (c) app.openCoin(c); else if (d !== undefined) app.read(d); else app.go(placeOf(window.location.hash)); mark(); };
  window.addEventListener('hashchange', route);
  if (coinOf(window.location.hash) || diskOf(window.location.hash) !== undefined || placeOf(window.location.hash) !== 'tower') route();
  mark();
}

/** The loader follows the app's stages. */
const fill = document.querySelector<HTMLElement>('[data-loader-fill]'), stepEl = document.querySelector<HTMLElement>('[data-loader-step]'), loader = document.querySelector<HTMLElement>('[data-loader]');
window.addEventListener('overmind:progress', ((e: CustomEvent<{ p: number; step: string }>) => {
  fill?.style.setProperty('--p', String(e.detail.p));
  if (stepEl) stepEl.textContent = e.detail.step;
  loader?.setAttribute('aria-valuenow', String(Math.round(e.detail.p * 100)));
}) as EventListener);

function unsupported(error: unknown) {
  document.documentElement.classList.add('is-unsupported');
  console.error(error);
}

// ?api=URL (or VITE_ARCHIVE_API at build time) reads the live Overmind; without one, the phase 1 simulator runs
const api = new URLSearchParams(window.location.search).get('api') ?? import.meta.env.VITE_ARCHIVE_API;
const archive = api ? new RemoteArchive(api) : new SimArchive();
new IndexNav(document.querySelector('.logo'), archive);
try {
  const app = new App(archive);
  app.load().then(() => wirePlaces(app)).catch(unsupported);
  if (window.location.hash === '#debug') void import('./debug').then((m) => m.mountDebug(app));
} catch (error) {
  unsupported(error);
}
