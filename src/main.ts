import './styles.css';
import { IndexNav } from './ui/indexNav';
import { App } from './engine/app';
import { Archive } from './archive/sim';

function unsupported(error: unknown) {
  document.documentElement.classList.add('is-unsupported');
  console.error(error);
}

const archive = new Archive();
new IndexNav(document.querySelector('.logo'), archive);
try {
  const app = new App(archive);
  app.load().catch(unsupported);
  if (window.location.hash === '#debug') void import('./debug').then((m) => m.mountDebug(app));
} catch (error) {
  unsupported(error);
}
