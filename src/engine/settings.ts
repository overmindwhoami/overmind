import { ENVIRONMENT, GLASS, LIGHTS, POST, RENDERER } from '../../design-system/scene';
import { SPIN } from '../../design-system/motion';

const params = new URLSearchParams(window.location.search);
/** Phones (touch-first, small screen) get the full kit and a higher resolution ceiling; ?quality=low is the lite profile for weak devices. */
export const PHONE = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
export const QUALITY: 'low' | 'high' = params.get('quality') === 'low' ? 'low' : 'high';
/** A phone's resolution ceiling: 2.5× (a 3× screen reads soft at 2×; the adaptive steps climb there when frames allow). */
export const PHONE_MAX_RATIO = 2.5;
export const VERIFY = params.has('verify');
/** Parity tests drive the camera freely, without the lineage's soft stops. */
export const FREE = params.has('free');

/** Live-tunable runtime settings (exposed in the #debug panel). Defaults come from design-system tokens. */
export const settings = {
  adaptiveResolution: !VERIFY,
  frameRate: RENDERER.pixelRatio.targetFps,
  // phones render at up to 2.5× (a 2× canvas on a 3× screen reads soft); elsewhere the cap, lower on the lite profile
  pixelRatio: Math.min(window.devicePixelRatio || 1, PHONE ? PHONE_MAX_RATIO : QUALITY === 'low' ? RENDERER.pixelRatio.liteCap : RENDERER.pixelRatio.maxCap),
  spin: SPIN.idle,
  parallax: 1,
  volume: 0.8,
  roughness: GLASS.roughness,
  glassOpacity: GLASS.opacity,
  edgeGlow: GLASS.edgeGlow,
  keyIntensity: LIGHTS.key.intensity,
  rimIntensity: LIGHTS.rim.intensity,
  coreIntensity: LIGHTS.core.intensity,
  environmentIntensity: ENVIRONMENT.intensity,
  focus: 0,
  aperture: POST.depthOfField.aperture * (PHONE ? 0.55 : 1), // a small screen reads background blur as low resolution
  lensMaximum: POST.depthOfField.maxRadiusPx,
  shutter: POST.motionBlur.shutter,
  blurCap: POST.motionBlur.capFraction,
  bloom: POST.bloom.strength,
  bloomRadius: POST.bloom.radius,
  threshold: POST.bloom.threshold,
  exposure: POST.final.exposure,
  contrast: POST.final.contrast,
  saturation: POST.final.saturation,
  aberration: POST.final.aberration,
  vignette: POST.final.vignette.amount,
  grain: POST.final.grain * (PHONE ? 0.5 : 1),
};
export type Settings = typeof settings;
