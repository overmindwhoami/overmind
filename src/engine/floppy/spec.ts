/**
 * 3.5″ HD floppy disk, in millimetres. Source: ECMA-125 (geometry) and the measured CC0 Viking scan (shutter),
 * consolidated in docs/reference-floppy/00-floppy-reference.md.
 *
 * Model frame: origin at the case centre, Side 1 (label side) faces +z, shutter edge at +y.
 * Viewed from Side 1 the chamfer is top right, the write-protect hole bottom left and the density hole bottom right.
 */
export type Corner = [x: number, y: number, r: number];

const box = (x0: number, y0: number, x1: number, y1: number, r: [number, number, number, number]): Corner[] =>
  [[x0, y0, r[0]], [x1, y0, r[1]], [x1, y1, r[2]], [x0, y1, r[3]]]; // bottom-left, bottom-right, top-right, top-left (CCW)

export const CASE = {
  w: 90,
  h: 94,
  t: 3.3,
  edge: 0.35, // R0.40 ± 0.25 (spec 6.1.2)
  seam: -0.15, // ultrasonic weld line between the two moulded halves
  /** Plan outline, CCW from the bottom-left corner. Top edge follows the stepped shutter-edge profile (spec 6.1.9). */
  outline: [
    [-45, -47, 2],
    [45, -47, 2],
    [45, 42, 0.8], // 45° chamfer, 5 × 5 legs
    [40, 47, 0.8],
    [36, 47, 0.4],
    [36, 46.5, 0.1],
    [28, 46.5, 0.6],
    [26.5, 45, 0.3], // drive-lever slot beside the closed shutter
    [17, 45, 0.45],
    [17, 42, 0.2],
    [15.5, 42, 0.3],
    [11, 46.5, 0.8], // 45° ramp under the shutter
    [-36.5, 46.5, 0.1],
    [-36.5, 47, 0.4],
    [-45, 47, 2],
  ] as Corner[],
} as const;

export const Z1 = CASE.t / 2; // Side 1 face; Side 0 is at −Z1

/** Recesses, pockets and through-holes. `depth` is measured into the case from that face. */
export const FEATURES = {
  side1: {
    shutterRecess: { ring: box(-35.8, 15.6, 25.6, 49, [1.5, 1.5, 0, 0]), depth: 0.3 },
    labelRecess: { ring: box(-37.2, -49, 37.2, 9.5, [0, 0, 1.8, 1.8]), depth: 0.2 },
  },
  side0: {
    shutterRecess: { ring: box(-36, 15.4, 25.6, 49, [1.5, 1.5, 0, 0]), depth: 0.3 },
    labelStrip: { ring: box(-37.2, -49, 37.2, -31, [0, 0, 1.6, 1.6]), depth: 0.2 },
    hubAccess: { center: [0, -1.5] as [number, number], r: 13.25, depth: 1.75 },
    locateRound: { center: [-40, 29.5] as [number, number], r: 1.8, depth: 2.5 },
    locateSlot: { ring: box(37.8, 27.7, 42.2, 31.3, [1.79, 1.79, 1.79, 1.79]), depth: 2.5 },
    notchLeft: { ring: box(-46, 34.9, -42, 39.1, [0, 1, 1, 0]), depth: 2 },
    notchRight: { ring: box(42, 34.9, 46, 39.1, [1, 0, 0, 1]), depth: 2 },
    protectSlot: { ring: box(-42, -45.4, -38, -35.6, [0.5, 0.5, 0.5, 0.5]), depth: 1.4 },
  },
  holes: {
    headWindow: box(-4.5, 18, 4.5, 41.8, [0.5, 0.5, 0.5, 0.5]),
    writeProtect: box(-41.75, -40.25, -38.25, -36.25, [0.3, 0.3, 0.3, 0.3]),
    density: box(38.25, -40.25, 41.75, -36.25, [0.3, 0.3, 0.3, 0.3]),
  },
} as const;

/** Stainless U-section shutter, closed position (measured 47.5 × 31.0, travel ≈ 11.2 toward −x). */
export const SHUTTER = {
  x0: -23,
  x1: 24.5,
  y0: 16,
  corner: 1,
  sheet: 0.2,
  bend: 0.5, // outer bend radius over the top edge
  top: 46.9, // outer face of the spine
  gap: 0.04, // above the recess floor (keeps the sheet clear of the floor in the depth buffer)
  window: { cx: 11.2, w: 12, y0: 17.5, y1: 43, r: 0.8, lip: 0.9 },
  travel: 11.2,
} as const;

export const HUB = {
  center: [0, -1.5] as [number, number],
  r: 12.5, // Ø25.0
  flange: 15.5, // Ø31.15 max
  face: -Z1 + 0.3, // hub Side 0 surface sits 0.3 inside the reference plane (spec 6.6)
  thickness: 1.25,
  spindle: { size: 4.4, r: 1 }, // square, 4.00 min after the 0.2 bevel
  drivePin: { inner: 5.5, outer: 10, along: [-2, 6] as [number, number], angle: (15 * Math.PI) / 180, r: 1, rBig: 2 },
} as const;

export const MEDIA = { rIn: 14, rOut: 42.9, z: 0 } as const; // Ø85.8 × 0.08
export const LINER = { rIn: 16.5, rOut: 41, z: 0.33, cut: { w: 13, y0: 14 } } as const;
export const SLIDER = { x: -40, w: 3.8, h: 5, z0: -Z1 + 0.1, z1: -0.27, yEnabled: -38.15, yProtected: -42.85 } as const;

/** Paper label: front panel in the Side 1 recess, wrapped round the bottom edge onto the Side 0 strip. */
export const LABEL = {
  w: 70,
  front: 8.2, // top of the front panel
  back: -33, // top of the back flap
  edge: -47.1, // outer face of the wrap
  bend: 0.5,
  paper: 0.09,
  corner: 1.4,
} as const;
/** Length of the label along its wrap path, front top → back top. */
export const LABEL_LENGTH = (() => {
  const zf = Z1 - FEATURES.side1.labelRecess.depth + LABEL.paper;
  const straightFront = LABEL.front - (LABEL.edge + LABEL.bend);
  const straightBack = LABEL.back - (LABEL.edge + LABEL.bend);
  return straightFront + straightBack + Math.PI * LABEL.bend + 2 * (zf - LABEL.bend);
})();
