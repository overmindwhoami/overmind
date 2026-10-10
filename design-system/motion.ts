/**
 * Overmind motion tokens and choreography, derived from projects.bizar.ro (docs/reference-bizarro/03-motion.md).
 *
 * One law moves the world: every animated value chases a target with frame-rate-independent
 * first-order damping. Input never sets a position; it moves a target.
 */

/** Fraction of the remaining distance covered this frame. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** Move `current` toward `target` at `rate` (per second) over `dt` seconds. */
export const approach = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * damp(rate, dt);

/** Exponential decay toward zero (inertia, boosts). */
export const decay = (value: number, rate: number, dt: number): number => value * Math.exp(-rate * dt);

/** Milliseconds for a damped value to cover `settle` of its travel. Use for CSS stand-ins. */
export const settleMs = (rate: number, settle = 0.99): number => (-Math.log(1 - settle) / rate) * 1000;

/** Frame delta clamp used by the loop (a dropped tab never produces a huge jump). */
export const MAX_DT = 0.1;

export const RATE = {
  /** Camera height, pointer, focus glide. Heavy, 95% in 1.0 s. */
  world: 3,
  /** Spin brake, turn-to-face, audio rate. 95% in 0.75 s. */
  mechanism: 4,
  /** Spotlight dim, pointer-speed meter. */
  overlay: 6,
  /** HUD element proximity focus. */
  proximity: 10,
  /** Cursor reticle state. 95% in 0.21 s. */
  instrument: 14,
} as const;

export const DECAY = {
  /** Spin boost after a flick or arrow key. Half-life 0.63 s. */
  inertia: 1.1,
  /** Drag velocity while the pointer is held still. */
  dragHold: 6,
  /** Pointer-speed meter when the pointer stops. */
  pointerIdle: 4,
} as const;

/** Input gearing (world units = millimetres × 0.01). */
export const SCROLL = {
  /** Camera height change per wheel pixel (deltaY / 100 × 0.062 × 2). */
  wheelUnitsPerPx: 0.00124,
  /** Camera height change for a full-viewport-height vertical drag. */
  dragUnitsPerViewport: 2.2,
  /** Tower turn for a full-viewport-width horizontal drag (radians). */
  dragTurnPerViewport: Math.PI * 1.2,
  /** Weight of each pointer event in the drag-velocity estimate. */
  dragVelocityBlend: 0.35,
  /** Arrow ↑/↓ step. */
  keyStep: 0.4,
  /** Pixels a press may travel and still count as a tap. */
  tapSlop: 6,
} as const;

export const SPIN = {
  /** Idle tower rotation (rad/s): one turn every 7.39 s. */
  idle: 0.85,
  /** Multiplier while something is hovered or focused ("attention brakes the world"). */
  attention: 0.18,
  /** Arrow ←/→ boost (rad/s). */
  keyBoost: 1.2,
} as const;

/** Ambient drift: incommensurate periods so nothing visibly loops. */
export const DRIFT = {
  heightAmp: 0.18, heightFreq: 0.13, // 48.3 s
  xAmp: 0.12, xFreq: 0.09, // 69.8 s
  zAmp: 0.1, zFreq: 0.07, // 89.8 s
  focusBase: 2.23, focusAmp: 0.12, focusFreq: 0.21, // 29.9 s
} as const;

export const PARALLAX = {
  cameraX: 0.35,
  cameraY: 0.22,
  keyLight: { x: 1.4, y: 0.8 },
  rimLight: { x: -0.8, y: -0.5 },
} as const;

/** Reference reduced-motion factor for spin, drift and parallax. Overmind goes further: see REDUCED. */
export const REDUCED_MOTION_SCALE = 0.35;

/** Overmind reduced-motion policy (stronger than the reference). */
export const REDUCED = {
  continuousScale: 0.35,
  motionBlur: false,
  focusBreathing: false,
  hudStagger: false,
  hudStrobe: false,
  cameraRate: RATE.mechanism,
} as const;

/** Instrument (2D HUD) timings in milliseconds. These are linear, digital and stepped, unlike the damped world. */
export const HUD = {
  flash: 90,
  pop: 140,
  popScaleFrom: 1.25,
  strobeHz: 20,
  boxDelayMax: 450,
  ringDelayMax: 350,
  ringDraw: 500,
  titleType: [150, 750],
  subline: [500, 800],
  scramble: 400,
  leave: 250,
  fillRefresh: [1200, 3600],
  proximityPx: 120,
  /** Measurement boxes are drawn at this share of the feature they measure (box 0, the case outline, stays 1). Reference: 1. */
  boxScale: 0.72,
  /** The instrument, pared back now that the room is the show (reference: all 20 regions, 4–9 rings). */
  boxes: 8,
  labels: 3, // coordinate readouts on the first few boxes only
  rings: [1, 3],
  /** Growth of a box near the cursor (reference 0.18). */
  proximityGrow: 0.06,
  /** Below this viewport width the instrument is compact: smaller and fewer boxes, fewer rings, two-line subline. */
  compactBelowPx: 768,
  compactBoxScale: 0.68,
  compactBoxes: 5,
  compactLabels: 2, // coordinate readouts only on the first few boxes
  compactRings: [1, 2],
  trackingPx: 240,
  travelBoostPer500PxPerSec: 1,
  travelBoostMax: 3,
} as const;

/** CSS stand-ins. */
export const CSS_EASE = {
  expoOut: 'cubic-bezier(0.19, 1, 0.22, 1)',
  damp: 'cubic-bezier(0.15, 0.68, 0.32, 1)',
  ease: 'ease',
} as const;

/** Named choreography patterns: reusable recipes with exact parameters. */
export const CHOREOGRAPHY = {
  sceneReveal: {
    description: 'Blurred poster under a transparent canvas; canvas fades in once the first frame is rendered, chrome follows.',
    canvas: { property: 'opacity', from: 0, to: 1, ms: 1200, ease: 'ease' },
    chrome: { property: 'opacity', from: 0, to: 1, ms: 1200, delay: 600, ease: 'ease' },
    poster: { blurPx: 18, scale: 1.06 },
  },
  worldTravel: {
    description: 'Wheel, drag, keys and index focus all move a camera-height target; the camera glides with k=3. Accumulates, never snaps, never overshoots.',
    rate: RATE.world,
  },
  attentionBrake: {
    description: 'Hover or focus slows the ambient spin to 18% (k=4); releasing restores it.',
    multiplier: SPIN.attention,
    rate: RATE.mechanism,
  },
  focusFly: {
    description: 'Index focus: camera height glides to the item (k=3) while the tower turns it to face camera (k=4) and a 78% spotlight dims the rest (k=6).',
    heightRate: RATE.world, turnRate: RATE.mechanism, dimRate: RATE.overlay, dim: 0.78,
  },
  flickInertia: {
    description: 'Releasing a horizontal drag hands its angular velocity to a boost that decays at e^(-1.1t).',
    decay: DECAY.inertia,
  },
  instrumentLock: {
    description: 'HUD lock-on: chime, 20 boxes staggered over 450 ms with 90 ms flash and 140 ms 1.25→1 pop at a 20 Hz strobe, rings drawn over 500 ms, title typed 150–750 ms, subline 500–800 ms, digits scrambled for 400 ms. Leaves with a 250 ms linear fade.',
    ...HUD,
  },
  linkUnderline: {
    description: '1 px bar scales 0→1 from the left on hover/focus, retracts toward the right on leave.',
    ms: 600, ease: CSS_EASE.expoOut,
  },
  indexScroll: {
    description: 'Index list translates so the active row is centred (600 ms expo-out); rows fade by distance (400 ms ease).',
    rowPx: 22, activeOffsetPx: 132, ms: 600, rowMs: 400,
  },
  ambientDrift: {
    description: 'Three incommensurate camera sines plus a 30 s focus breath and per-frame grain: the world is never still.',
    ...DRIFT,
  },
  velocityOptics: {
    description: 'Speed is shown by per-pixel motion blur (shutter 1.6 per 60 fps frame, capped at 3.5% of viewport height) and by audio brightness, never by layout.',
    shutter: 1.6, capFraction: 0.035,
  },
} as const;
