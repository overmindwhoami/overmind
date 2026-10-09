import GUI from 'lil-gui';
import type { App } from './engine/app';
import { settings } from './engine/settings';

/** #debug panel: the same knobs the reference exposes, bound to Overmind's live settings. */
export function mountDebug(app: App) {
  const gui = new GUI({ title: 'Overmind' });
  const stats = { calls: 0, ratio: 0 };
  gui.add(stats, 'calls').name('draw calls').disable().listen();
  gui.add(stats, 'ratio').name('pixel ratio').disable().listen();
  gui.add(settings, 'adaptiveResolution').onChange(app.resize);
  gui.add(settings, 'frameRate', 30, 240, 1);
  const motion = gui.addFolder('Motion');
  motion.add(settings, 'spin', -2, 2, 0.01); motion.add(settings, 'parallax', 0, 3, 0.01); motion.add(settings, 'volume', 0, 1.5, 0.01);
  const glass = gui.addFolder('Glass');
  glass.add(settings, 'roughness', 0, 0.6, 0.001); glass.add(settings, 'glassOpacity', 0, 1, 0.01); glass.add(settings, 'edgeGlow', 0, 10, 0.01);
  const lights = gui.addFolder('Lights');
  lights.add(settings, 'keyIntensity', 0, 10, 0.01); lights.add(settings, 'rimIntensity', 0, 30, 0.01); lights.add(settings, 'coreIntensity', 0, 30, 0.01); lights.add(settings, 'environmentIntensity', 0, 4, 0.01);
  const lens = gui.addFolder('Lens');
  lens.add(settings, 'focus', -2, 2, 0.01); lens.add(settings, 'aperture', 0, 0.06, 0.0005); lens.add(settings, 'lensMaximum', 0, 40, 1); lens.add(settings, 'shutter', 0, 12, 0.01);
  const post = gui.addFolder('Post');
  for (const [k, a, b, s] of [['bloom', 0, 3, 0.01], ['bloomRadius', 0.5, 3, 0.01], ['threshold', 0, 4, 0.01], ['exposure', 0, 5, 0.01], ['contrast', 0.5, 2, 0.01], ['saturation', 0, 2, 0.01], ['aberration', 0, 0.1, 0.001], ['vignette', 0, 1.5, 0.01], ['grain', 0, 0.3, 0.001]] as const) post.add(settings, k, a, b, s);
  setInterval(() => { stats.calls = app.renderer.info.render.calls; stats.ratio = app.renderer.getPixelRatio(); }, 250);
}
