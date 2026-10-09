import './styles.css';
import { IndexNav } from './ui/indexNav';
import { App } from './engine/app';

function unsupported(error: unknown) {
  document.documentElement.classList.add('is-unsupported');
  console.error(error);
}

new IndexNav(document.querySelector('.logo'));
try {
  const app = new App();
  app.load().catch(unsupported);
  if (window.location.hash === '#debug') void import('./debug').then((m) => m.mountDebug(app));
} catch (error) {
  unsupported(error);
}
