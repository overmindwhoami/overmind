/**
 * Overmind scene tokens: camera, lighting, environment, materials and post chain.
 * Values measured from projects.bizar.ro (docs/reference-bizarro/04-3d.md). World units = mm × 0.01.
 */

export const MM = 0.01;

export const RENDERER = {
  antialias: false,
  stencil: false,
  powerPreference: 'high-performance',
  requires: ['webgl2', 'EXT_color_buffer_float'],
  sceneTarget: { type: 'HalfFloat', samples: 2, depthTexture: true },
  toneMappingInRenderer: 'none', // tone mapping and sRGB encode happen in the final pass
  // detail before frame rate: start at 1.5×, never below 1×, and hold 60 fps (a 120 Hz screen no longer halves the resolution)
  pixelRatio: { start: 1.5, min: 1, step: 0.25, maxCap: 2, liteCap: 1.5, targetFps: 60 },
} as const;

export const CAMERA = {
  fov: 34, // vertical, degrees
  /** Portrait screens widen the vertical FOV until at least this much shows horizontally (desktop is unaffected). */
  minHorizontalFov: 30,
  near: 0.1,
  far: 30,
  distance: 2.85, // pulled back a little: the room is round it now
  heightOffset: 0.12, // camera sits above the scroll height
  lookOffset: 0.02, // and looks slightly down
  lookX: -0.06,
  roll: -0.09, // radians, constant Dutch angle
} as const;

export const COLOR = {
  background: '#000000',
  glow: '#ffffff',
  key: '#ffffff',
  rim: '#f4f4f4',
  halation: '#ffffff',
  tape: '#1a1a1a',
} as const;

export const LIGHTS = {
  key: { type: 'directional', color: COLOR.key, intensity: 2.5, position: [-1.6, 2.6, 2.2] },
  rim: { type: 'directional', color: COLOR.rim, intensity: 0.8, position: [2.4, -0.8, -2.6] },
  rimFill: { type: 'directional', color: COLOR.glow, intensityOfRim: 0.45, position: [-2.6, -1.4, -1.2] },
  core: { type: 'point', count: 3, color: COLOR.glow, intensity: 0.45, distance: 1.8, decay: 2, radius: 0.16, angleStep: 2.4, verticalSpacing: 0.8 },
} as const;

/** Emissive cards baked into a PMREM environment (sigma 0.02). They light reflections, not surfaces. */
export const ENVIRONMENT = {
  sigma: 0.02,
  intensity: 0.9,
  cards: [
    { color: COLOR.rim, width: 3.4, height: 2.4, intensity: 7, position: [2.6, -0.4, -2.4] },
    { color: COLOR.rim, width: 2.4, height: 0.3, intensity: 10, position: [-3, -1.6, -0.8] },
    { color: COLOR.glow, width: 0.6, height: 1.6, intensity: 4, position: [-2.2, 0.4, -2.8] },
    { color: COLOR.key, width: 3.4, height: 0.35, intensity: 6, position: [-1.4, 3, 1.4] },
    { color: COLOR.key, width: 0.5, height: 1.2, intensity: 1.6, position: [2.6, 1.2, 2.2] },
  ],
} as const;

/** Patched-standard "smoked glass": no diffuse, no direct light, edge emissive, alpha from tint and angle, premultiplied blend. */
export const GLASS = {
  roughness: 0.06,
  metalness: 0,
  edgeGlow: 0.25, // emissive = white × tint × (pow(1 - |n·v|, 4) + 0.015) × edgeGlow
  opacity: 0.3, // alpha = clamp(opacity + pow(1 - |n·v|, 5) × 0.5 + (1 - avg(tint)) × 0.75)
  blending: { src: 'One', dst: 'OneMinusSrcAlpha' },
  tintDistribution: [
    { share: 0.55, range: [0.9, 1.0], reads: 'clear' },
    { share: 0.3, range: [0.25, 0.4], reads: 'grey translucent' },
    { share: 0.15, range: [0.12, 0.12], reads: 'black opaque' },
  ],
} as const;

export const MATERIALS = {
  plastic: { color: '#ffffff', roughness: 0.38, metalness: 0 },
  metal: { color: '#cfcfcf', roughness: 0.26, metalness: 1 },
  tape: { color: COLOR.tape, roughness: 0.5, metalness: 0.2, bumpScale: 0.6 },
  felt: { color: '#555555', roughness: 1, metalness: 0 },
  tapePath: { color: COLOR.tape, roughness: 0.35, metalness: 0.3 },
  label: { color: '#ffffff', roughness: 0.55, metalness: 0.1, alphaTest: 0.5 },
  glint: { unlit: true, intensity: 1.2 },
} as const;

export const POST = {
  motionBlur: { samples: 12, shutter: 1.6, capFraction: 0.035 },
  depthOfField: { aperture: 0.007, focusBase: 2.23, maxRadiusPx: 8, spiralStep: 1.25, maxTaps: 160 },
  bloom: { threshold: 1.4, knee: 0.5, levels: 6, radius: 1, strength: 0.4, halationMix: 0.35 },
  final: {
    aberration: 0.006,
    vignette: { amount: 0.75, inner: 0.25, outer: 0.85 },
    toneMap: 'ACES (Narkowicz fit)',
    exposure: 1,
    saturation: 0,
    contrast: 1.2,
    grain: 0.04,
  },
} as const;

/** Tower layout (reference). */
export const TOWER = {
  radius: [0.42, 0.62],
  azimuthStep: 'golden angle ± 0.35 rad',
  tilt: { longAxis: 0.45, shortAxis: 0.3, vertical: 0.3 },
  flipShare: 0.5,
  candidates: 4,
  dropStep: 0.01,
  bisectSteps: 8,
  hiddenBase: 12,
  cullHalfHeight: 'tan(fov/2) × 3.3 + 0.7', // 1.709 u at fov 34
} as const;
