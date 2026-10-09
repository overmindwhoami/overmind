/**
 * Overmind PC dimensions, millimetres (measured from docs/reference-machine/generated: 03-front, 05-monitor-side,
 * 06-keyboard, 09-clear-unit-top). Origin on the floor under the unit's centre, +z toward the viewer, y up.
 */
export const FOOT = 5;
export const UNIT = { w: 396, h: 96, d: 330, r: 7, bevel: 3.5, frame: 3 } as const; // 450 in the references; narrowed on request
export const TOP = FOOT + UNIT.h; // 101
export const FRONT = UNIT.d / 2; // body front face
export const FACE = FRONT + UNIT.frame; // front of the bezel frame
export const BACK = -UNIT.d / 2;
export const HW = UNIT.w / 2;
// Front layout, anchored to the edges as measured on 03-front (the drive keeps its real size, the gaps close up)
export const RECESS = { x0: -HW + 12, x1: HW - 12, y0: 15.8, y1: 81.2 };
export const POWER = { x: -HW + 34.2, y: 46.2, size: 21 };
export const LED_POWER = { x: -HW + 60.3, y: 46.6 };
export const BAY = { x0: HW - 145.1, x1: HW - 16.3, y0: 26.2, y1: 76.6 };
export const VENT = { x0: BAY.x0 - 17.4 - 104, x1: BAY.x0 - 17.4, y0: 21.6, y1: 80.1, slots: 19 };
export const SLOT = { x: (BAY.x0 + BAY.x1) / 2 - 9.3, y: 51.6, w: 98, h: 5.4 };
export const DOOR = { y0: 54.3, y1: 60.6 };
export const EJECT = { x0: BAY.x1 - 21.8, x1: BAY.x1 - 6.3, y0: 35.8, y1: 46.6 };
export const LED_DRIVE = { x: BAY.x1 - 12.7, y: 63.9 };
/** Where the disk sits when fully inserted (its centre). */
export const DISK_Z = FACE - 3 - 47;
export const PEDESTAL = { plate: [216, 200, 12], collar: [188, 118, 10], neck: [150, 90, 12] } as const;
export const MONITOR = { w: 322, h: 250, depth: 308, bezel: 41, setBack: 70 } as const;
export const OPENING = { w: 277, h: 204, r: 10, top: 20.8 };
export const GLASS = { w: 262, h: 189, r: 15, inset: 8 };
export const KEYBOARD = { w: 460, d: 181, back: 34, front: 18, gap: 42 };
export const KEY_PITCH = 19.05;
/** Centre and size of the CRT picture (4:3), in the PC's frame. */
export const SCREEN = (() => {
  const y0 = FOOT + UNIT.h + PEDESTAL.plate[2] + PEDESTAL.collar[2] + PEDESTAL.neck[2];
  const openY = MONITOR.h / 2 - OPENING.top - OPENING.h / 2;
  const front = FRONT - MONITOR.setBack;
  const h = GLASS.h * 0.94;
  return { x: 0, y: y0 + MONITOR.h / 2 + openY, z: front - GLASS.inset + 2.4, w: h * (4 / 3), h };
})();
