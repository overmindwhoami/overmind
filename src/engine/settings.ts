import { ENVIRONMENT, GLASS, LIGHTS, POST, RENDERER } from '../../design-system/scene';
import { SPIN } from '../../design-system/motion';

const params = new URLSearchParams(window.location.search);
/** Phones (touch-first, small screen) get the lite profile automatically; ?quality=low|high overrides. */
export const PHONE = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
export const QUALITY: 'low' | 'high' = params.get('quality') === 'low' || (PHONE && params.get('quality') !== 'high') ? 'low' : 'high';
export const VERIFY = params.has('verify');

/** Live-tunable runtime settings (exposed in the #debug panel). Defaults come from design-system tokens. */
export const settings = {
  adaptiveResolution: !VERIFY,
  frameRate: RENDERER.pixelRatio.targetFps,
  pixelRatio: Math.min(window.devicePixelRatio || 1, QUALITY === 'low' ? RENDERER.pixelRatio.liteCap : RENDERER.pixelRatio.maxCap),
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
  aperture: POST.depthOfField.aperture,
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
  grain: POST.final.grain,
};
export type Settings = typeof settings;
