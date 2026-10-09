/**
 * The Overmind's computer: a late-80s desktop (system unit, 14-inch CRT monitor on a swivel pedestal, keyboard),
 * modelled from the GPT reference set in docs/reference-machine/generated at real size, so a 3.5" disk fits the slot.
 * Millimetres; origin on the floor under the unit's centre, +z toward the viewer, y up.
 * Variants: 'beige' (as the references), 'obsidian' (our black), 'clear' (transparent case, internals modelled).
 */
import * as THREE from 'three';
import { filletRing } from '../engine/floppy/shapes';
import { glassMaterial, lightScale, softMetal, type FloppyTextures, type GlassUniforms } from '../engine/floppy/materials';
import type { Corner } from '../engine/floppy/spec';
import { at, badgeTexture, cyl, flatDisk, prism, rr, slab, type Machine } from './geom';
import { BAY, DISK_Z, DOOR, EJECT, FACE, FOOT, FRONT, GLASS, HW, KEYBOARD, KEY_PITCH, LED_DRIVE, LED_POWER, MONITOR, OPENING, PEDESTAL, POWER, RECESS, SLOT, TOP, UNIT, VENT } from './pcSpec';
import { Parts, loftRings, roundRect, type Key } from './pcParts';
import { clearMonitor, clearUnit } from './pcClear';

export { MONITOR, SLOT, UNIT } from './pcSpec';

export type PcVariant = 'beige' | 'obsidian' | 'clear';

const U = KEY_PITCH;

/* ------------------------------------------------------------------ geometry helpers */
/** A box-ish keycap: rounded-rect frustum with a top, axis up (+y). */
function keycap(w: number, d: number, h = 9) {
  const g = loftRings([{ pts: roundRect(w, d, 1.4), z: 0 }, { pts: roundRect(w - 4.4, d - 4, 2.4, 0, -0.6), z: h }], false, true);
  return g.rotateX(-Math.PI / 2); // ring plane xy → xz, axis z → y; ring y → −z (keeps the top offset toward the back)
}

/* ------------------------------------------------------------------ materials */
/** Ribbon cable: 34 conductors across the width (u). */
function ribbonTexture() {
  const c = document.createElement('canvas'); c.width = 136; c.height = 4;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 34; i++) { g.fillStyle = '#d4d4d0'; g.fillRect(i * 4, 0, 3, 4); g.fillStyle = '#8c8c88'; g.fillRect(i * 4 + 3, 0, 1, 4); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

function materials(t: FloppyTextures, gu: GlassUniforms, variant: PcVariant, screen: THREE.Texture) {
  const stipple = (tile: number) => { const s = t.stipple.clone(); s.repeat.setScalar(1 / tile); s.needsUpdate = true; return s; };
  const abs = (c: THREE.Color, rough: number, tile = 34, k = 0.4, direct = 0.5) =>
    lightScale(new THREE.MeshStandardMaterial({ color: c, roughness: rough, normalMap: stipple(tile), normalScale: new THREE.Vector2(k, k) }), { direct });
  const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  // clear acrylic: drawn without depth writes so far walls show through; two-sided only for the thin frame parts
  // (a two-sided shell stacks up to four grazing reflections of the studio cards and blooms)
  const clearGlass = (tint: number, edge: number, opacity: number, twoSided = false, env = 0.6) => {
    const m = glassMaterial({ uEdgeColor: gu.uEdgeColor, uEdgeGlow: { value: edge }, uGlassOpacity: { value: opacity } });
    m.color.setScalar(tint);
    m.roughness = 0.12;
    lightScale(m, { env });
    m.side = twoSided ? THREE.DoubleSide : THREE.FrontSide;
    m.depthWrite = false;
    return m;
  };
  const tone = {
    beige: { case: srgb(168, 160, 138), trim: srgb(76, 76, 74), keyLight: srgb(172, 165, 145), keyDark: srgb(118, 112, 98), well: srgb(40, 39, 36) },
    obsidian: { case: new THREE.Color().setScalar(0.021), trim: new THREE.Color().setScalar(0.07), keyLight: new THREE.Color().setScalar(0.045), keyDark: new THREE.Color().setScalar(0.018), well: new THREE.Color().setScalar(0.006) },
    clear: { case: srgb(168, 160, 138), trim: srgb(64, 64, 62), keyLight: srgb(172, 165, 145), keyDark: srgb(118, 112, 98), well: new THREE.Color().setScalar(0.01) },
  }[variant];
  const m: Record<Key, THREE.Material> = {
    case: variant === 'clear' ? clearGlass(0.96, 0.2, 0.1, false, 0.14) : abs(tone.case, variant === 'beige' ? 0.62 : 0.5),
    accent: abs(tone.case, variant === 'beige' ? 0.62 : 0.5),
    door: abs(tone.trim.clone().multiplyScalar(1.6), 0.45, 24, 0.3),
    trim: abs(tone.trim, 0.5, 24, 0.3),
    keyLight: abs(tone.keyLight, 0.5, 24, 0.25, 0.7),
    keyDark: abs(tone.keyDark, 0.5, 24, 0.25, 0.7),
    well: abs(tone.well, 0.7, 24, 0.2),
    seam: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.75 }),
    // CRT glass: dark, glossy, the picture as light coming through it
    screen: new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.1, metalness: 0, emissive: 0xffffff, emissiveMap: screen, emissiveIntensity: 1.3 }),
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6) }),
    ledDim: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2) }),
    steel: softMetal(new THREE.MeshPhysicalMaterial({
      color: 0xc4c5c8, metalness: 1, roughness: 0.34, roughnessMap: t.brushed.roughness, normalMap: t.brushed.normal,
      normalScale: new THREE.Vector2(0.2, 0.2), anisotropy: 0.7,
    })),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.55 }),
    chip: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.22 }),
    matte: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.42 }),
    metal: lightScale(new THREE.MeshStandardMaterial({ color: 0x9c9c98, metalness: 0.35, roughness: 0.52 }), { env: 0.55, direct: 0.5 }), // galvanised boxes
    part: new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.5 }), // connectors, capacitors, cable ends
    cable: new THREE.MeshStandardMaterial({ color: variant === 'obsidian' ? 0x050505 : tone.case, roughness: 0.6 }),
    board: lightScale(new THREE.MeshStandardMaterial({ color: srgb(38, 118, 62), roughness: 0.42 }), { direct: 0.5 }), // solder-mask green
    boardTan: new THREE.MeshStandardMaterial({ color: srgb(152, 128, 66), roughness: 0.5 }), // phenolic board (monitor)
    cream: new THREE.MeshStandardMaterial({ color: srgb(232, 226, 206), roughness: 0.45 }), // connectors, film capacitors
    header: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.4 }),
    gold: lightScale(new THREE.MeshStandardMaterial({ color: srgb(214, 178, 72), metalness: 1, roughness: 0.3 }), { env: 0.7, direct: 0.6 }),
    ledGreen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 3.4, 0.6) }),
    ledAmber: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 1.3, 0.15) }),
    coil: new THREE.MeshStandardMaterial({ color: srgb(196, 112, 52), metalness: 0.5, roughness: 0.4 }), // enamelled copper wire bundles
    // inner workings (clear case)
    acrylic: clearGlass(0.98, 0.2, 0.1, true), // frame posts and rails: the bright edges of an acrylic build
    tube: lightScale(new THREE.MeshStandardMaterial({ color: 0x5f6368, roughness: 0.3, metalness: 0.1 }), { env: 0.45, direct: 0.4 }), // CRT funnel glass, graphite grey
    neck: clearGlass(0.9, 0.5, 0.18, true),
    copper: lightScale(new THREE.MeshStandardMaterial({ color: srgb(184, 115, 51), metalness: 1, roughness: 0.32 }), { env: 0.7, direct: 0.6 }),
    brass: lightScale(new THREE.MeshStandardMaterial({ color: srgb(181, 160, 90), metalness: 0.85, roughness: 0.45 }), { env: 0.6 }),
    tin: lightScale(new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 1, roughness: 0.42 }), { env: 0.42, direct: 0.28 }),
    wireA: new THREE.MeshStandardMaterial({ color: srgb(200, 40, 34), roughness: 0.42 }), // red
    wireB: new THREE.MeshStandardMaterial({ color: srgb(236, 196, 44), roughness: 0.42 }), // yellow
    wireC: new THREE.MeshStandardMaterial({ color: srgb(40, 84, 196), roughness: 0.42 }), // blue
    wireD: new THREE.MeshStandardMaterial({ color: srgb(232, 128, 30), roughness: 0.42 }), // orange
    sleeve: new THREE.MeshStandardMaterial({ color: srgb(30, 52, 120), roughness: 0.32 }), // blue capacitor sleeves
    sleeveBlack: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.32 }),
    ribbon: new THREE.MeshStandardMaterial({ color: srgb(178, 178, 174), roughness: 0.55, side: THREE.DoubleSide, map: ribbonTexture() }),
    pane: clearGlass(0.98, 0.18, 0.05, false, 0.25), // internal acrylic walls
    alu: lightScale(new THREE.MeshStandardMaterial({ color: srgb(196, 194, 186), metalness: 0.65, roughness: 0.42 }), { env: 0.5, direct: 0.6 }),
    tie: new THREE.MeshStandardMaterial({ color: srgb(236, 234, 226), roughness: 0.5 }),
    orange: new THREE.MeshStandardMaterial({ color: srgb(222, 120, 40), roughness: 0.4 }),
    blue: new THREE.MeshStandardMaterial({ color: srgb(40, 90, 200), roughness: 0.4 }),
    label: new THREE.MeshStandardMaterial({ color: srgb(238, 236, 228), roughness: 0.7 }),
  };
  return m;
}

/* ------------------------------------------------------------------ system unit */
function systemUnit(P: Parts, clear: boolean) {
  const { w: W, h: H, d: D } = UNIT;
  P.add('case', at(slab(W, D, H, UNIT.r, UNIT.bevel), 0, FOOT + H / 2, 0));
  // front bezel frame, proud of the body, with the long recessed panel
  const recess = rr(RECESS.x0, RECESS.y0 - FOOT - H / 2, RECESS.x1, RECESS.y1 - FOOT - H / 2, 3).reverse();
  P.add('case', at(prism(W - 3, H - 3, UNIT.frame + 0.6, UNIT.r - 1, 1.2, [recess]), 0, FOOT + H / 2, FRONT + UNIT.frame / 2 - 0.3));
  // seams: across the top behind the front cover, round the sides and back at the lid split (moulded cases only)
  if (!clear) {
    P.add('seam', at(prism(W - 14, 0.8, 0.9, 0.2, 0).rotateX(Math.PI / 2), 0, TOP + 0.15, FRONT - 14));
    for (const s of [-1, 1]) P.add('seam', at(prism(0.9, 0.8, D - 16, 0.2, 0), s * (W / 2 + 0.15), FOOT + 46, 0));
    P.add('seam', at(prism(W - 16, 0.8, 0.9, 0.2, 0), 0, FOOT + 46, -D / 2 - 0.15));
  }
  // power button: dark square frame, beige cap, green-glowing LED
  P.add('trim', at(prism(POWER.size, POWER.size, 3, 2, 0.6), POWER.x, POWER.y, FRONT + 1.5));
  P.add('accent', at(prism(POWER.size - 6, POWER.size - 6, 4.2, 1.6, 0.8), POWER.x, POWER.y, FRONT + 2.4));
  P.add('ledGreen', at(cyl(2, 1.2, 16).rotateX(Math.PI / 2), LED_POWER.x, LED_POWER.y, FRONT + 0.6));
  // vent grille: dark backing with plastic bars
  const vw = VENT.x1 - VENT.x0, vh = VENT.y1 - VENT.y0, pitch = vw / VENT.slots;
  P.add('seam', at(prism(vw, vh, 0.6, 1, 0), (VENT.x0 + VENT.x1) / 2, (VENT.y0 + VENT.y1) / 2, FRONT + 0.3));
  for (let k = 0; k <= VENT.slots; k++) P.add('accent', at(prism(pitch - 2.3, vh, 2.2, 0.4, 0.3), VENT.x0 + k * pitch, (VENT.y0 + VENT.y1) / 2, FRONT + 1.1));
  // drive bay: dark bezel with the slot, a recessed door above it, eject button and activity light
  const bx = (BAY.x0 + BAY.x1) / 2, by = (BAY.y0 + BAY.y1) / 2;
  // one opening for the slot and the door flap above it; the flap sits 1 mm back, the slot stays open
  const slotHole = rr(SLOT.x - bx - SLOT.w / 2, SLOT.y - by - SLOT.h / 2, SLOT.x - bx + SLOT.w / 2, DOOR.y1 - by, 1).reverse();
  P.add('trim', at(prism(BAY.x1 - BAY.x0, BAY.y1 - BAY.y0, 2.6, 2, 0.6, [slotHole]), bx, by, FRONT + 1.3));
  P.add('door', at(prism(SLOT.w - 0.6, DOOR.y1 - DOOR.y0 - 0.4, 1.2, 0.6, 0.3), SLOT.x, (DOOR.y0 + DOOR.y1) / 2 - 0.2, FRONT + 1.6)); // door flap, recessed
  P.add('seam', at(prism(SLOT.w + 6, 16, 1, 1, 0), SLOT.x, SLOT.y, FRONT - 0.2)); // dark throat behind the slot
  P.add('accent', at(prism(EJECT.x1 - EJECT.x0, EJECT.y1 - EJECT.y0, 4.8, 1.2, 0.7), (EJECT.x0 + EJECT.x1) / 2, (EJECT.y0 + EJECT.y1) / 2, FRONT + 2.4));
  P.add('ledAmber', at(cyl(1.8, 1.4, 16).rotateX(Math.PI / 2), LED_DRIVE.x, LED_DRIVE.y, FRONT + 2.8));
  // feet
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.add('rubber', at(prism(30, FOOT, 16, 2, 0.8), x * (W / 2 - 40), FOOT / 2, z * (D / 2 - 30)));
  // back: vents and the power socket (the clear case shows the real parts instead)
  const back = -D / 2 - 0.2;
  if (!clear) {
  for (const [x0, x1, n] of [[-HW + 20, -HW + 47, 6], [-HW + 85, HW - 85, 44], [HW - 47, HW - 20, 6]] as const) for (let k = 0; k < n; k++) {
    const x = x0 + ((x1 - x0) * (k + 0.5)) / n;
    P.add('seam', at(prism(2.2, 52, 0.8, 0.6, 0), x, FOOT + H / 2, back));
  }
  P.add('trim', at(prism(30, 24, 2, 2, 0.4), HW - 66, FOOT + H / 2, back - 0.8));
  P.add('seam', at(prism(22, 15, 1, 1, 0), HW - 66, FOOT + H / 2, back - 1.7));
  }
  if (clear) clearUnit(P);
}

/* ------------------------------------------------------------------ monitor */
function monitor(P: Parts, clear: boolean, screen: THREE.Texture) {
  const M = MONITOR;
  const plate = PEDESTAL.plate, collar = PEDESTAL.collar, neck = PEDESTAL.neck;
  const front = FRONT - M.setBack; // bezel front face
  const pz = front - 128; // pedestal centre
  let y = TOP;
  P.add('case', at(slab(plate[0], plate[1], plate[2], 9, 3), 0, y + plate[2] / 2, pz)); y += plate[2];
  P.add('case', at(slab(collar[0], collar[1], collar[2], 40, 2), 0, y + collar[2] / 2, pz)); y += collar[2];
  P.add('case', at(slab(neck[0], neck[1], neck[2], 20, 2), 0, y + neck[2] / 2, pz + 8)); y += neck[2];
  const y0 = y, cy = y0 + M.h / 2; // monitor bottom and centre
  // bezel with the screen opening
  const openY = M.h / 2 - OPENING.top - OPENING.h / 2; // opening centre relative to the bezel centre
  P.add('case', at(prism(M.w, M.h, M.bezel, 12, 4, [rr(-OPENING.w / 2, openY - OPENING.h / 2, OPENING.w / 2, openY + OPENING.h / 2, OPENING.r).reverse()]), 0, cy, front - M.bezel / 2));
  // dark surround sloping from the opening back to the glass
  const sy = cy + openY;
  P.add('trim', loftRings([
    { pts: roundRect(OPENING.w + 1, OPENING.h + 1, OPENING.r, 0, sy), z: front - 1 },
    { pts: roundRect(GLASS.w + 4, GLASS.h + 4, GLASS.r, 0, sy), z: front - GLASS.inset },
    { pts: roundRect(GLASS.w + 4, GLASS.h + 4, GLASS.r, 0, sy), z: front - GLASS.inset - 6 },
  ], false, false, true));
  // the tube face: glass curved both ways, picture inset 4:3
  const glass = new THREE.ShapeGeometry(new THREE.Shape(roundRect(GLASS.w, GLASS.h, GLASS.r).map(([x, yy]) => new THREE.Vector2(x, yy))), 12);
  const gp = glass.getAttribute('position'), guv = new Float32Array(gp.count * 2);
  const pic = { w: GLASS.h * 1.333 * 0.94, h: GLASS.h * 0.94 };
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), yy = gp.getY(i);
    gp.setZ(i, 4.2 * (1 - (x / (GLASS.w / 2)) ** 2) * (1 - 0.75 * (yy / (GLASS.h / 2)) ** 2));
    guv.set([x / pic.w + 0.5, yy / pic.h + 0.5], i * 2);
  }
  glass.setAttribute('uv', new THREE.BufferAttribute(guv, 2));
  glass.computeVertexNormals();
  screen.wrapS = screen.wrapT = THREE.ClampToEdgeWrapping;
  const tube = new THREE.Mesh(glass.translate(0, sy, front - GLASS.inset - 2), undefined);
  // housing: lofted rounded rectangles from the bezel back to the rear box (heights from the monitor bottom)
  const ring = (z: number, w: number, top: number, bottom: number, r: number) => ({ pts: roundRect(w, top - bottom, r, 0, y0 + (top + bottom) / 2), z: front - z });
  P.add('case', loftRings([
    ring(M.bezel - 1, 316, 247, 3, 10), ring(76, 306, 237, 3, 12), ring(265, 200, 186, 9, 16),
    ring(265.5, 165, 186, 24, 14), ring(300, 165, 186, 24, 14), ring(M.depth, 150, 178, 32, 12),
  ], false, true));
  const halfW = (z: number) => z < 76 ? 158 - ((z - 41) / 35) * 5 : z < 265 ? 153 - ((z - 76) / 189) * 53 : 82.5;
  const topAt = (z: number) => z < 76 ? 247 - ((z - 41) / 35) * 10 : 237 - ((z - 76) / 189) * 51;
  // side vents on the tapering walls: upper and lower rows
  const vent: Key = clear ? 'pane' : 'seam';
  for (const s of [-1, 1]) for (let k = 0; k < 24; k++) {
    const z = 86 + k * 5.2, hw = halfW(z) + 0.25, yaw = Math.atan2(53, 189) * s;
    const upTop = topAt(z) - (19 - ((z - 86) / 123) * 13), upBot = 176; // tops follow the sloping roof (05-monitor-side)
    P.add(vent, at(prism(0.6, upTop - upBot, 2.2, 0.5, 0), s * hw, y0 + (upTop + upBot) / 2, front - z, 0, yaw));
    P.add(vent, at(prism(0.6, 28, 2.2, 0.5, 0), s * hw, y0 + 22, front - z, 0, yaw));
  }
  // rear box: horizontal side vents, top vents, two screws on the back
  for (const s of [-1, 1]) for (let k = 0; k < 15; k++) P.add(vent, at(prism(0.6, 2.2, 30, 0.5, 0), s * 82.8, y0 + 60 + k * 5.6, front - 286));
  for (let k = 0; k < 22; k++) P.add(vent, at(prism(2.2, 0.6, 26, 0.5, 0), -48 + k * 4.6, y0 + 186.3, front - 284));
  for (const s of [-1, 1]) P.add('steel', at(cyl(2.6, 1.2, 20).rotateX(Math.PI / 2), s * 50, y0 + 60, front - M.depth - 0.2));
  // inside (clear case only): picture tube, yoke, boards
  if (clear) clearMonitor(P, { front, y0, sy, halfW, topAt });
  if (clear) for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.add('tin', cyl(4, 34, 16).translate(x * 60, TOP + 17, front - 128 + z * 34)); // steel standoffs in the clear pedestal
  return { tube, frontZ: front, top: y0 + M.h };
}

/* ------------------------------------------------------------------ keyboard */
type KeyDef = [x: number, w: number, row: number, dark: boolean, h?: number];
function keyLayout(): KeyDef[] {
  const k: KeyDef[] = [];
  const run = (x0: number, n: number, row: number, dark: boolean) => { for (let i = 0; i < n; i++) k.push([x0 + i, 1, row, dark]); };
  k.push([0, 1, 0, false]); run(2, 4, 0, false); run(6.5, 4, 0, true); run(11, 4, 0, false); run(15.25, 3, 0, true); run(18.5, 4, 0, true);
  run(0, 13, 1, false); k.push([13, 2, 1, true]); run(15.25, 3, 1, true); run(18.5, 3, 1, false); k.push([21.5, 1, 1, true]);
  k.push([0, 1.5, 2, true]); run(1.5, 12, 2, false); k.push([13.5, 1.5, 2, false]); run(15.25, 3, 2, true); run(18.5, 3, 2, false); k.push([21.5, 1, 2, true, 2]);
  k.push([0, 1.75, 3, true]); run(1.75, 11, 3, false); k.push([12.75, 2.25, 3, true]); run(18.5, 3, 3, false);
  k.push([0, 2.25, 4, true]); run(2.25, 10, 4, false); k.push([12.25, 2.75, 4, true]); k.push([16.25, 1, 4, true]); run(18.5, 3, 4, false); k.push([21.5, 1, 4, true, 2]);
  run(0, 3, 5, true); k[k.length - 3][1] = k[k.length - 2][1] = k[k.length - 1][1] = 1.25; k[k.length - 2][0] = 1.25; k[k.length - 1][0] = 2.5;
  k.push([3.75, 6.25, 5, false]); for (let i = 0; i < 4; i++) k.push([10 + i * 1.25, 1.25, 5, true]);
  run(15.25, 3, 5, true); k.push([18.5, 2, 5, false]); k.push([20.5, 1, 5, false]);
  return k;
}
const ROW_Z = [-51.8, -23.1, -4.05, 15, 34, 53.1];
const KEY_X0 = -216.3;

function keyboard(P: Parts, clear: boolean) {
  const K = KEYBOARD, cz = FACE + K.gap + K.d / 2;
  // body: side profile extruded across the width
  const profile = filletRing([[-K.d / 2, 3, 3], [K.d / 2, 3, 4], [K.d / 2, 3 + K.front, 4], [-K.d / 2, 3 + K.back, 6]] as Corner[]);
  const body = new THREE.ExtrudeGeometry(new THREE.Shape(profile.map(([z, yy]) => new THREE.Vector2(z, yy))), { depth: K.w - 8, bevelEnabled: true, bevelThickness: 4, bevelSize: 2.6, bevelSegments: 3, curveSegments: 6 });
  body.translate(0, 0, -(K.w - 8) / 2).rotateY(-Math.PI / 2); // profile (z,y) → extrude along x
  P.add('case', body.translate(0, 0, cz));
  P.add('seam', at(prism(K.w - 6, 0.7, 0.8, 0.2, 0), 0, 9, cz + K.d / 2 + 0.1)); // case split line on the front
  for (const s of [-1, 1]) P.add('rubber', at(prism(26, 3, 12, 2, 0.6), s * (K.w / 2 - 40), 1.5, cz + K.d / 2 - 20));
  for (const s of [-1, 1]) P.add('rubber', at(prism(26, 3, 12, 2, 0.6), s * (K.w / 2 - 40), 1.5, cz - K.d / 2 + 20));
  // deck frame: tilted plane through the top face
  const slope = Math.atan2(K.back - K.front, K.d), deckY = 3 + (K.back + K.front) / 2;
  const deck = new THREE.Matrix4().compose(new THREE.Vector3(0, deckY, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(slope, 0, 0)), new THREE.Vector3(1, 1, 1));
  const onDeck = (g: THREE.BufferGeometry) => g.applyMatrix4(deck);
  const keys = keyLayout();
  // wells: dark recesses under each key group
  const wells: [number, number, number, number][] = [[0, 1, 0, 0], [2, 6, 0, 0], [6.5, 10.5, 0, 0], [11, 15, 0, 0], [15.25, 18.25, 0, 0], [18.5, 22.5, 0, 0], [0, 15, 1, 5], [15.25, 18.25, 1, 2], [16.25, 17.25, 4, 4], [15.25, 18.25, 5, 5], [18.5, 22.5, 1, 5]];
  for (const [u0, u1, r0, r1] of wells) {
    const x0 = KEY_X0 + u0 * U - 1.4, x1 = KEY_X0 + u1 * U + 1.4, z0 = ROW_Z[r0] - U / 2 - 1.4, z1 = ROW_Z[r1] + U / 2 + 1.4;
    P.add('well', onDeck(at(slab(x1 - x0, z1 - z0, 1, 2, 0.3), (x0 + x1) / 2, 0.3, (z0 + z1) / 2)));
  }
  for (const [u, w, row, dark, hh = 1] of keys) {
    const x = KEY_X0 + (u + w / 2) * U, z = hh === 2 ? (ROW_Z[row] + ROW_Z[row + 1]) / 2 : ROW_Z[row];
    const zz = hh === 2 ? ROW_Z[row + 1] - ROW_Z[row] + U : U;
    P.add(dark ? 'keyDark' : 'keyLight', onDeck(at(keycap(w * U - 1.1, zz - 1.1), x, 0.8, z)));
  }
  if (clear) P.add('board', at(slab(K.w - 20, K.d - 20, 1.4, 4, 0.3), 0, 8, cz)); // the keyboard's circuit board
  // cable into the left side of the unit
  const cable = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-150, 22, cz - K.d / 2 - 1), new THREE.Vector3(-185, 6, cz - K.d / 2 - 22), new THREE.Vector3(-HW - 32, 4, FRONT - 10),
    new THREE.Vector3(-HW - 38, 5, 20), new THREE.Vector3(-HW - 1, 30, -40),
  ]);
  P.add('cable', new THREE.TubeGeometry(cable, 80, 2.2, 10, false));
}

/* ------------------------------------------------------------------ assembly */
export interface PcOptions { monitor?: boolean; keyboard?: boolean; /** Texture for the CRT (defaults to a still web page). */ screen?: THREE.Texture }
export function buildPC(t: FloppyTextures, gu: GlassUniforms, variant: PcVariant, { monitor: withMonitor = true, keyboard: withKeyboard = true, screen: screenTex }: PcOptions = {}): Machine {
  const clear = variant === 'clear';
  const screen = screenTex ?? new THREE.CanvasTexture(document.createElement('canvas'));
  const P = new Parts();
  systemUnit(P, clear);
  const mon = withMonitor ? monitor(P, clear, screen) : undefined;
  if (withKeyboard) keyboard(P, clear);
  const m = materials(t, gu, variant, screen);
  const group = P.build(m);
  if (mon) { mon.tube.material = m.screen; group.add(mon.tube); }
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(40, 8.5), new THREE.MeshStandardMaterial({ map: badgeTexture(), metalness: 1, roughness: 0.35, color: 0xd0d0d0 }));
  badge.position.set(-HW + 100, 90.5, FACE - 0.25);
  group.add(badge);
  return { group, height: mon?.top ?? TOP, screen, screenMesh: mon?.tube, disk: (s) => flatDisk(SLOT.x, SLOT.y, DISK_Z + s * 70) };
}
