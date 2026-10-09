import './styles.css';
import { IndexNav } from './ui/indexNav';
import { App } from './engine/app';
import { SimArchive } from './archive/sim';
import { RemoteArchive } from './archive/remote';

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
  app.load().catch(unsupported);
  if (window.location.hash === '#debug') void import('./debug').then((m) => m.mountDebug(app));
} catch (error) {
  unsupported(error);
}
