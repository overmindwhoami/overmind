/**
 * Drive and machine concepts for the archivist (design exploration, rendered in lookdev).
 * Three directions in the Overmind language, all procedural, in millimetres (the group is scaled to world units):
 *   A "Slab"      a flat smoked-glass drive with a glass screen leaning on its back edge
 *   B "Monolith"  an upright glass slab: disks drop in at the top, the screen is text in the glass
 *   C "Terminal"  a stippled all-in-one computer: screen above, slot below
 * Each returns the disk's pose in the slot for an insertion amount (0 = fully in, 1 = just touching the slot).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { filletRing, type V2 } from '../engine/floppy/shapes';
import { glassMaterial, softMetal, type FloppyTextures, type GlassUniforms } from '../engine/floppy/materials';
import { buildPC, type PcOptions } from './pc';
import { at, badgeTexture, brushTangents, cyl, dampDirect, flatDisk, prism, rr, shapeOf, slab, type Machine } from './geom';
export type { Machine } from './geom';

export type Concept = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'pc-beige' | 'pc-obsidian' | 'pc-clear';
export const CONCEPTS: Record<Concept, string> = { a: 'Slab', b: 'Monolith', c: 'Terminal', d: 'Compact 89 (clear)', e: 'Compact 89 (black)', f: 'Color 93 (clear)', g: 'Color 93 (black)', h: 'Internet 98 (clear)', i: 'Internet 98 (graphite)', 'pc-beige': 'Overmind PC (beige)', 'pc-obsidian': 'Overmind PC (obsidian)', 'pc-clear': 'Overmind PC (clear)' };

/* ------------------------------------------------------------------ the screen */
const NOTE = '> minute 41. a modem manual from 1989. page 12 has a coffee ring on it. keeping the coffee ring too';
const DIR: [string, string, string, string][] = [
  ['30', '14:20', 'BYTE_MAGAZINE_1983_08.TXT', '16,384'],
  ['31', '14:21', 'ON_THIS_DAY_1996_10_08.TXT', '16,384'],
  ['32', '14:22', 'QUANT_PH_2610_04411.TXT', '16,384'],
  ['33', '14:23', '---- nothing came through ----', ''],
  ['34', '14:24', 'BBS_FAREWELL_POST_1997.TXT', '16,384'],
  ['35', '14:25', 'WAYBACK_BITCOIN_ORG_2009.TXT', '16,384'],
  ['36', '14:26', 'SHAREWARE_DISK_0042.TXT', '16,384'],
  ['37', '14:27', 'RADIO_SHACK_CAT_1984.TXT', '16,384'],
  ['38', '14:28', 'KEYS_EXPOSED_THIS_HOUR.TXT', '16,384'],
  ['39', '14:29', 'GEOCITIES_AREA51_HOME.TXT', '16,384'],
  ['40', '14:30', 'SOLAR_FLUX_M2_WATCH.TXT', '16,384'],
  ['41', '14:31', 'MODEM_MANUAL_1989.TXT', 'writing'],
];

/** Phosphor display: a disk directory with the newest slot being written and the Overmind's note typing below. */
export function screenTexture(transparent = false, w = 1024, h = 640) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  if (!transparent) {
    g.fillStyle = '#050505'; g.fillRect(0, 0, w, h);
    const v = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.85);
    v.addColorStop(0, 'rgba(255,255,255,0.035)'); v.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  }
  const ink = '#e4e4e4';
  g.shadowColor = 'rgba(255,255,255,0.55)'; g.shadowBlur = transparent ? 6 : 9;
  const mono = (t: string, x: number, y: number, size: number, weight = 400, color = ink) => { g.font = `${weight} ${size}px "JetBrains Mono", Menlo, monospace`; g.fillStyle = color; g.fillText(t, x, y); };
  const m = 44;
  g.fillStyle = ink; g.fillRect(m, 30, w - m * 2, 34);
  g.shadowBlur = 0;
  mono('OVERMIND   A:\\   DISK 0213', m + 12, 54, 21, 600, '#050505');
  g.font = '600 21px "JetBrains Mono", Menlo, monospace'; g.textAlign = 'right';
  g.fillStyle = '#050505'; g.fillText('SLOT 41/90   14:31:07', w - m - 12, 54); g.textAlign = 'left';
  g.shadowBlur = transparent ? 6 : 9;
  mono('A:\\>DIR', m, 104, 21);
  mono(' Volume in drive A is DISK_0213        seal: open', m, 132, 19, 400, '#9a9a9a');
  DIR.forEach(([n, t, name, size], i) => {
    const y = 172 + i * 29, last = i === DIR.length - 1, dim = name.startsWith('----');
    const color = dim ? '#6e6e6e' : ink;
    if (last) { g.fillStyle = 'rgba(228,228,228,0.13)'; g.fillRect(m - 8, y - 22, w - m * 2 + 16, 29); }
    mono(` ${n}  ${t}  ${name.padEnd(31, ' ')}`, m, y, 20, last ? 600 : 400, color);
    g.textAlign = 'right'; mono(size, w - m, y, 20, last ? 600 : 400, color); g.textAlign = 'left';
  });
  // the note, typing, with a block cursor
  const words = NOTE.split(' '), lines: string[] = [];
  g.font = '400 21px "JetBrains Mono", Menlo, monospace';
  let line = '';
  for (const word of words) { const next = line ? `${line} ${word}` : word; if (g.measureText(next).width > w - m * 2) { lines.push(line); line = word; } else line = next; }
  lines.push(line);
  lines.forEach((l, i) => mono(l, m, 538 + i * 30, 21, 400));
  const last = lines[lines.length - 1];
  g.font = '400 21px "JetBrains Mono", Menlo, monospace';
  g.fillStyle = ink; g.fillRect(m + g.measureText(last).width + 6, 538 + (lines.length - 1) * 30 - 19, 12, 23);
  if (!transparent) { // scanlines
    g.shadowBlur = 0; g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ------------------------------------------------------------------ materials */
function materials(t: FloppyTextures, glassUniforms: GlassUniforms) {
  const stipple = t.stipple.clone();
  stipple.repeat.set(1 / 14, 1 / 14);
  stipple.needsUpdate = true;
  const glass = (tint: number) => { const m = glassMaterial(glassUniforms); m.color.setScalar(tint); return m; };
  // the clear case gets its own glass: more edge, a little more body and less glare than the disks' shells,
  // so a large clear object still reads as an object
  const caseEdge = { value: 0.32 };
  const caseGlass = glassMaterial({ uEdgeColor: { value: new THREE.Color('#ffffff') }, uEdgeGlow: caseEdge, uGlassOpacity: { value: 0.3 } });
  caseGlass.userData.edgeUniform = caseEdge;
  caseGlass.color.setScalar(0.93);
  caseGlass.envMapIntensity = 0.5;
  return {
    glassSmoke: glass(0.7),
    glassClear: glass(0.96),
    glassCase: caseGlass,
    steel: softMetal(new THREE.MeshPhysicalMaterial({
      color: 0xc4c5c8, metalness: 1, roughness: 0.34, roughnessMap: t.brushed.roughness, normalMap: t.brushed.normal,
      normalScale: new THREE.Vector2(0.2, 0.2), anisotropy: 0.7, envMapIntensity: 0.42,
    })),
    abs: dampDirect(new THREE.MeshStandardMaterial({ color: new THREE.Color().setScalar(0.03), roughness: 0.52, normalMap: stipple, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 0.5 }), 0.35),
    absBlack: new THREE.MeshStandardMaterial({ color: new THREE.Color().setScalar(0.012), roughness: 0.4, normalMap: stipple, normalScale: new THREE.Vector2(0.4, 0.4) }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.55 }),
    chip: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.22 }),
    matte: new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.94, envMapIntensity: 0.3 }), // graphite-coated tube funnel
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6) }),
  };
}
type Mats = ReturnType<typeof materials>;
type Key = Exclude<keyof Mats, never>;

/** Collects geometry per material and merges it into one mesh each. */
class Builder {
  parts = new Map<Key, THREE.BufferGeometry[]>();
  group = new THREE.Group();
  add(key: Key, g: THREE.BufferGeometry) { const list = this.parts.get(key) ?? []; list.push(g.index ? g.toNonIndexed() : g); this.parts.set(key, list); return g; }
  build(m: Mats) {
    for (const [key, list] of this.parts) {
      const merged = mergeGeometries(list.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; }));
      if (key === 'steel') brushTangents(merged);
      const mesh = new THREE.Mesh(merged, m[key]);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    return this.group;
  }
}


/** Drive internals shared by A and B, in a local frame where the disk lies in the xz plane with its hub at hubZ. */
function mechanism(b: Builder, y0: number, hubZ: number, headZ: number, x0 = 0) {
  const add = b.add.bind(b);
  b = { add: (k: Key, g: THREE.BufferGeometry) => add(k, g.translate(x0, 0, 0)) } as Builder;
  b.add('steel', at(slab(110, 128, 0.8, 4, 0.2), 0, y0 - 6.5, hubZ - 26)); // chassis plate
  b.add('steel', at(cyl(13, 3.2, 48), 0, y0 - 3.7, hubZ)); // spindle motor
  b.add('dark', at(cyl(4, 1, 24), 0, y0 - 2, hubZ));
  for (const x of [-10, 10]) b.add('steel', at(cyl(1.1, 66, 16), x, y0 + 3.4, headZ - 18, Math.PI / 2)); // head rails
  b.add('dark', at(prism(26, 4.6, 11, 1.2, 0.3), 0, y0 + 3.6, headZ - 2)); // carriage
  b.add('steel', at(slab(7, 18, 0.6, 1.5, 0.15), 0, y0 + 2.4, headZ)); // head arm over the window
  b.add('steel', at(cyl(0.8, 46, 12), 0, y0 + 3.9, headZ - 26, Math.PI / 2)); // lead screw
  b.add('steel', at(cyl(8, 12, 40), 0, y0 + 1.5, headZ - 50, Math.PI / 2)); // stepper motor
  b.add('dark', at(slab(100, 32, 1.2, 1.5, 0.3), 0, y0 - 8.8, hubZ - 76)); // controller board
  for (const [x, z, w] of [[-30, -70, 12], [-8, -68, 9], [16, -72, 14], [36, -66, 7]] as const) b.add('chip', at(slab(w, 9, 1.4, 0.6, 0.2), x, y0 - 7.6, hubZ + z + 4));
}


/* ------------------------------------------------------------------ A: Slab */
function slabDrive(t: FloppyTextures, gu: GlassUniforms): Machine {
  const m = materials(t, gu), b = new Builder();
  const H = 22, D = 146, front = D / 2;
  b.add('glassSmoke', at(slab(124, D, H, 7, 1.5), 0, H / 2, 0));
  const slot = rr(-48, -2.6, 48, 2.6, 1.2);
  b.add('absBlack', at(prism(118, 17, 5, 3, 0.6, [slot]), 0, H / 2, front + 1)); // bezel, proud of the glass
  b.add('absBlack', at(prism(9, 3.6, 2.4, 1.2, 0.4), 49, H / 2 - 5.6, front + 4)); // eject button
  b.add('led', at(prism(4.5, 1.2, 1, 0.5, 0), -50, H / 2 - 5.6, front + 3.6));
  for (const [x, z] of [[-52, -60], [52, -60], [-52, 60], [52, 60]]) b.add('dark', at(cyl(4, 1.2, 20), x, -0.6, z));
  const diskZ = front + 3.5 - 3 - 47; // rear edge 3 mm inside the bezel face
  mechanism(b, H / 2, diskZ + 1.5, diskZ - 29.9);
  // screen: a glass panel leaning back on hinges at the rear edge
  const tilt = (-14 * Math.PI) / 180, hingeY = H + 9, hingeZ = -front + 10;
  const panel = new THREE.Matrix4().compose(new THREE.Vector3(0, hingeY, hingeZ), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)), new THREE.Vector3(1, 1, 1));
  const onPanel = (g: THREE.BufferGeometry, y: number, z: number) => g.translate(0, y, z).applyMatrix4(panel);
  b.add('glassClear', onPanel(prism(150, 102, 5, 5, 1.2), 54, 0));
  b.add('dark', onPanel(prism(146, 98, 1.4, 4, 0.3), 54, -1.6));
  for (const x of [-60, 60]) { // two slim posts carry the panel
    b.add('steel', at(cyl(1.6, 14, 20), x, H + 6, hingeZ + 1));
    b.add('steel', at(cyl(3.2, 1.6, 24), x, H + 0.4, hingeZ + 1));
  }
  const screen = screenTexture();
  const display = new THREE.Mesh(onPanel(new THREE.PlaneGeometry(136, 85), 54, 0.9), new THREE.MeshBasicMaterial({ map: screen, color: new THREE.Color(1.45, 1.45, 1.45) }));
  const group = b.build(m);
  group.add(display);
  return { group, height: 130, screen, disk: (s) => flatDisk(0, H / 2, diskZ + s * 70) };
}

/* ------------------------------------------------------------------ B: Monolith */
function monolith(t: FloppyTextures, gu: GlassUniforms): Machine {
  const m = materials(t, gu), b = new Builder();
  const W = 120, H = 178, D = 34, base = 8, top = base + H;
  b.add('steel', at(slab(134, 50, base, 5, 1), 0, base / 2, 0)); // plinth
  b.add('glassSmoke', at(prism(W, H, D, 9, 1.6), 0, base + H / 2, 0));
  b.add('absBlack', at(slab(108, 14, 3.2, 3, 0.6, [rr(-48, -2.8, 48, 2.8, 1.2)]), 0, top + 1.2, -2)); // slot on the top edge
  b.add('led', at(prism(4.5, 1, 1.2, 0.5, 0).rotateX(-Math.PI / 2), -52, top + 0.6, 12));
  b.add('steel', at(cyl(3.2, 2.4, 24), 52, top + 1.4, 9));
  // the disk stands in the upper half: label to the front, shutter edge down
  const diskY = top - 4 - 47, hubY = diskY + 1.5;
  b.add('steel', at(cyl(13, 3.2, 48).rotateX(Math.PI / 2), 0, hubY, -7.4)); // spindle motor behind the disk
  for (const x of [-10, 10]) b.add('steel', at(cyl(1.1, 64, 16), x, diskY - 22, -9)); // head rails (vertical)
  b.add('steel', at(prism(18, 7, 2.4, 1.2, 0.3), 0, diskY - 31, -9.5)); // head carriage, slim
  b.add('dark', at(prism(104, 70, 0.8, 4, 0.2), 0, base + 46, -15.5)); // dark backing behind the text, so it reads
  const screen = screenTexture(true);
  const text = new THREE.Mesh(new THREE.PlaneGeometry(110, 69), new THREE.MeshBasicMaterial({ map: screen, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.3, 1.3, 1.3) }));
  text.position.set(0, base + 46, D / 2 + 0.25);
  const group = b.build(m);
  group.add(text);
  const upright = (s: number) => new THREE.Matrix4().compose(new THREE.Vector3(0, diskY + s * 70, -3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)), new THREE.Vector3(1, 1, 1));
  return { group, height: top, screen, disk: upright };
}

/* ------------------------------------------------------------------ C: Terminal */
function terminal(t: FloppyTextures, gu: GlassUniforms): Machine {
  const m = materials(t, gu), b = new Builder();
  const W = 156, bevel = 3;
  // side profile (z, y), extruded across the width
  const profile = filletRing([[-70, 0, 3], [64, 0, 3], [64, 160, 6], [46, 182, 8], [-34, 182, 8], [-70, 116, 10]]);
  const body = new THREE.ExtrudeGeometry(shapeOf(profile), { depth: W - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 });
  body.translate(0, 0, -(W - 2 * bevel) / 2).rotateY(-Math.PI / 2);
  b.add('abs', body.translate(0, 3, 0));
  b.add('steel', at(slab(150, 128, 3, 6, 0.8), 0, 1.5, -3)); // foot plate
  // screen
  b.add('absBlack', at(prism(130, 98, 4, 5, 1), 0, 112, 66));
  const screen = screenTexture();
  const display = new THREE.Mesh(new THREE.PlaneGeometry(118, 74), new THREE.MeshBasicMaterial({ map: screen, color: new THREE.Color(1.45, 1.45, 1.45) }));
  display.position.set(0, 112, 68.1);
  b.add('glassClear', at(prism(124, 90, 1.4, 4, 0.4), 0, 112, 68.9));
  // drive
  const slotY = 38;
  b.add('absBlack', at(prism(128, 15, 3, 2.5, 0.6, [rr(-48, -2.6, 48, 2.6, 1.2)]), 0, slotY, 67));
  b.add('led', at(prism(4, 1.2, 1, 0.5, 0), -56, slotY - 4.5, 68.6));
  b.add('absBlack', at(prism(6, 3.6, 2, 1, 0.4), 56, slotY - 4.5, 69));
  // vents on the sloping back
  for (let k = 0; k < 9; k++) b.add('dark', at(prism(70, 1.2, 2, 0.5, 0.2), 0, 128 + k * 5.2, -64 + k * 2.8, 0.48));
  b.add('steel', at(prism(28, 6, 0.8, 1.5, 0.2), -50, 16, 67)); // badge
  const group = b.build(m);
  group.add(display);
  const diskZ = 64 + 3 - 3 - 47;
  return { group, height: 186, screen, disk: (s) => flatDisk(0, slotY, diskZ + s * 70) };
}

/* ------------------------------------------------------------------ D/E: Compact 89 */
/** A compact all-in-one at the 1989 SE/30's real size (244 × 345 × 277 mm), restyled: our materials, our badge, no maker's marks. */
function compact(t: FloppyTextures, gu: GlassUniforms, clear: boolean): Machine {
  const m = materials(t, gu), b = new Builder();
  const shell: Key = clear ? 'glassCase' : 'abs';
  const W = 244, H = 340, front = 138;
  const screen = { x: 0, y: 224, w: 196, h: 150 }, slot = { x: 52, y: 116 };
  // front bezel: a 6 mm face plate with the screen opening and the floppy slot, over a 58 mm deep collar
  const faceHoles = [rr(screen.x - screen.w / 2, screen.y - H / 2 - screen.h / 2, screen.x + screen.w / 2, screen.y - H / 2 + screen.h / 2, 13),
    rr(slot.x - 49, slot.y - H / 2 - 2.8, slot.x + 49, slot.y - H / 2 + 2.8, 1.4)];
  b.add(shell, at(prism(W, H, 6, 18, 2, faceHoles), 0, H / 2, front - 3));
  b.add(shell, at(prism(W, H, 58, 18, 3), 0, H / 2, front - 6 - 29));
  // rear case, tapering toward the back (sides in, top down) with a carry handle across the top
  const rear = prism(W - 8, H - 10, 200, 16, 3);
  rear.translate(0, (H - 10) / 2 + 1, front - 64 - 100);
  const p = rear.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const k = Math.min(Math.max((front - 64 - p.getZ(i)) / 200, 0), 1), f = 1 - 0.065 * k;
    p.setX(i, p.getX(i) * f); p.setY(i, p.getY(i) * (1 - 0.055 * k));
  }
  rear.computeVertexNormals();
  b.add(shell, rear);
  b.add('absBlack', at(slab(130, 34, 4, 6, 1), 0, 313, -100)); // handle recess
  for (let k = 0; k < 11; k++) b.add('absBlack', at(prism(150, 2.2, 3, 1, 0.4), 0, 225 + k * 7, -126.5)); // rear vents
  for (let k = 0; k < 4; k++) b.add('absBlack', at(prism(W - 40, 1, 1.4, 0.4, 0.2), 0, 32 + k * 6, front + 0.3)); // fine grooves across the chin
  for (const [x, z] of [[-96, 110], [96, 110], [-96, -110], [96, -110]]) b.add('dark', at(cyl(7, 2, 20), x, -1, z));
  // picture tube: face in the opening, funnel and neck behind (visible through the clear case)
  b.add('dark', at(prism(screen.w + 6, screen.h + 6, 3, 14, 0.6), screen.x, screen.y, front - 7.5));
  const display = new THREE.Mesh(new THREE.PlaneGeometry(screen.w - 12, screen.h - 12 * 0.75), new THREE.MeshBasicMaterial({ map: screenTexture(), color: new THREE.Color(1.45, 1.45, 1.45) }));
  display.position.set(screen.x, screen.y, front - 5.6);
  b.add('glassClear', at(prism(screen.w - 2, screen.h - 2, 1.2, 12, 0.3), screen.x, screen.y, front - 4.6));
  b.add('matte', at(new THREE.CylinderGeometry(30, 104, 120, 4, 1, true).rotateY(Math.PI / 4).rotateX(-Math.PI / 2).scale(1.32, 1, 1), 0, screen.y, front - 70)); // funnel, wide end at the face
  b.add('chip', at(cyl(15, 80, 32).rotateX(Math.PI / 2), 0, screen.y, front - 168)); // neck
  b.add('steel', at(cyl(34, 26, 40).rotateX(Math.PI / 2), 0, screen.y, front - 138)); // yoke
  // floppy drive under the tube, on the right, with the disk in it
  const diskZ = front - 3 - 47, y0 = slot.y;
  b.add('steel', at(slab(104, 150, 1, 3, 0.3), slot.x, y0 - 12, diskZ - 18)); // drive tray
  for (const x of [-52, 52]) b.add('steel', at(prism(1, 22, 150, 0.4, 0.2), slot.x + x, y0 - 2, diskZ - 18)); // side rails
  mechanism(b, y0, diskZ + 1.5, diskZ - 29.9, slot.x);
  b.add('led', at(prism(4.5, 1.4, 1, 0.5, 0), slot.x - 62, slot.y, front + 0.6));
  // logic board on the floor, analog board up the left side, power supply and fan at the back
  b.add('dark', at(slab(214, 220, 1.6, 4, 0.4), 0, 9, -14));
  for (const [x, z, w, d] of [[-60, 40, 26, 26], [-20, 50, 16, 16], [20, 30, 34, 20], [60, 60, 14, 14], [-70, -40, 20, 12], [10, -60, 40, 14]] as const) b.add('chip', at(slab(w, d, 2.4, 0.8, 0.3), x, 11, z));
  for (let k = 0; k < 4; k++) b.add('dark', at(prism(70, 18, 1.2, 0.6, 0.2), -40 + 0, 21, -96 + k * 6)); // memory modules
  b.add('dark', at(prism(1.6, 150, 190, 3, 0.4), -108, 100, -20)); // analog board
  b.add('chip', at(cyl(14, 34, 24).rotateZ(Math.PI / 2), -92, 150, -50)); // flyback transformer
  for (const [y, z] of [[60, 20], [70, -10], [55, -70]]) b.add('steel', at(cyl(7, 22, 20).rotateZ(Math.PI / 2), -96, y, z));
  b.add('steel', at(prism(74, 70, 100, 3, 0.6), 74, 50, -86)); // power supply cage
  b.add('dark', at(cyl(32, 12, 40).rotateX(Math.PI / 2), -64, 248, -116)); // fan
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(46, 10), new THREE.MeshStandardMaterial({ map: badgeTexture(), metalness: 1, roughness: 0.35, color: 0xd0d0d0 }));
  badge.position.set(-66, slot.y, front + 0.4);
  const group = b.build(m);
  group.add(display, badge);
  return { group, height: H, screen: display.material.map!, disk: (s) => flatDisk(slot.x, slot.y, diskZ + s * 70) };
}

/* ------------------------------------------------------------------ F/G: Color 93 */
/**
 * A 1993-era colour web page in a period browser, with the Overmind's writer window on top.
 * Generic chrome (no real browser or maker marks). The post chain renders it in greyscale like the rest of the scene.
 */
export function webScreenTexture(w = 1024, h = 768) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const font = (size: number, weight = 400, family = 'Geneva, "Helvetica Neue", Arial, sans-serif') => `${weight} ${size}px ${family}`;
  const serif = (size: number, weight = 400) => font(size, weight, '"Times New Roman", Times, serif');
  const mono = (size: number, weight = 400) => font(size, weight, '"JetBrains Mono", Menlo, monospace');
  const bevel = (x: number, y: number, ww: number, hh: number, inset = false) => {
    g.fillStyle = '#c6c6c6'; g.fillRect(x, y, ww, hh);
    g.fillStyle = inset ? '#7a7a7a' : '#ffffff'; g.fillRect(x, y, ww, 2); g.fillRect(x, y, 2, hh);
    g.fillStyle = inset ? '#ffffff' : '#6a6a6a'; g.fillRect(x, y + hh - 2, ww, 2); g.fillRect(x + ww - 2, y, 2, hh);
  };
  const stripes = (x: number, y: number, ww: number, hh: number) => { g.fillStyle = '#202020'; for (let k = 2; k < hh - 1; k += 3) g.fillRect(x, y + k, ww, 1); };
  // desktop and menu bar
  g.fillStyle = '#4a4a5a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, 28);
  g.fillStyle = '#000'; g.fillRect(0, 27, w, 1);
  g.font = font(17, 700); g.fillStyle = '#000';
  g.lineWidth = 3; g.strokeStyle = '#000'; g.beginPath(); g.arc(22, 14, 6, 0, Math.PI * 2); g.stroke();
  ['File', 'Edit', 'View', 'Go', 'Bookmarks', 'Window'].reduce((x, m) => { g.fillText(m, x, 20); return x + g.measureText(m).width + 26; }, 48);
  g.textAlign = 'right'; g.fillText('2:31 PM', w - 14, 20); g.textAlign = 'left';
  // browser window
  const X = 14, Y = 38, W = w - 28, H = h - 50;
  g.fillStyle = '#000'; g.fillRect(X - 1, Y - 1, W + 2, H + 2);
  g.fillStyle = '#e8e8e8'; g.fillRect(X, Y, W, 26); stripes(X + 30, Y + 3, W - 60, 20);
  g.fillStyle = '#e8e8e8'; const title = 'Wayback: Modem Manual (1989)'; g.font = font(16, 700);
  const tw = g.measureText(title).width; g.fillRect(X + W / 2 - tw / 2 - 10, Y + 2, tw + 20, 22);
  g.fillStyle = '#000'; g.textAlign = 'center'; g.fillText(title, X + W / 2, Y + 19); g.textAlign = 'left';
  g.strokeStyle = '#000'; g.lineWidth = 1.5; g.strokeRect(X + 9, Y + 6, 14, 14);
  // toolbar
  bevel(X, Y + 26, W, 62);
  ['Back', 'Forward', 'Home', 'Reload', 'Images', 'Open', 'Print', 'Find', 'Stop'].forEach((label, i) => {
    const bx = X + 8 + i * 74; bevel(bx, Y + 31, 68, 52);
    g.fillStyle = i === 8 ? '#9a9a9a' : '#303030';
    g.beginPath(); g.arc(bx + 34, Y + 50, 10, 0, Math.PI * 2); g.fill();
    g.font = font(12, 400); g.fillStyle = i === 8 ? '#8a8a8a' : '#000'; g.textAlign = 'center'; g.fillText(label, bx + 34, Y + 77); g.textAlign = 'left';
  });
  bevel(X + W - 74, Y + 31, 66, 52, true); // throbber
  g.fillStyle = '#1c1c3a'; g.fillRect(X + W - 70, Y + 35, 58, 44);
  g.fillStyle = '#f0f0f0'; for (let k = 0; k < 14; k++) g.fillRect(X + W - 66 + ((k * 37) % 50), Y + 39 + ((k * 23) % 36), 2, 2);
  // location bar
  bevel(X, Y + 88, W, 40);
  g.font = font(14, 700); g.fillStyle = '#000'; g.fillText('Location:', X + 10, Y + 113);
  bevel(X + 86, Y + 95, W - 96, 26, true); g.fillStyle = '#fff'; g.fillRect(X + 88, Y + 97, W - 100, 22);
  g.font = font(14); g.fillStyle = '#000'; g.fillText('http://web.archive.org/web/19961022/http://www.geocities.com/SiliconValley/1989/modem.html', X + 94, Y + 113);
  // directory buttons
  bevel(X, Y + 128, W, 34);
  ['Archive', 'On This Day', 'Floppies', 'Q-Day Watch', 'Search'].forEach((label, i) => { bevel(X + 8 + i * 128, Y + 132, 120, 26); g.font = font(13); g.fillStyle = '#000'; g.textAlign = 'center'; g.fillText(label, X + 68 + i * 128, Y + 150); g.textAlign = 'left'; });
  // page
  const PX = X + 2, PY = Y + 164, PW = W - 22, PH = H - 164 - 26;
  g.fillStyle = '#c0c0c0'; g.fillRect(PX, PY, PW, PH);
  g.fillStyle = '#d8d8d8'; g.fillRect(PX + PW, PY, 18, PH); g.fillStyle = '#9a9a9a'; g.fillRect(PX + PW + 3, PY + 40, 12, 90);
  g.save(); g.beginPath(); g.rect(PX, PY, PW, PH); g.clip();
  g.fillStyle = '#000080'; g.font = serif(34, 700); g.textAlign = 'center';
  g.fillText('2400 BAUD MODEM', PX + PW / 2, PY + 46);
  g.font = serif(22, 700); g.fillStyle = '#000'; g.fillText("Owner's Manual, 1989 \u2014 scanned page by page", PX + PW / 2, PY + 76);
  g.textAlign = 'left';
  g.fillStyle = '#808080'; g.fillRect(PX + 20, PY + 92, PW - 40, 2); g.fillStyle = '#fff'; g.fillRect(PX + 20, PY + 94, PW - 40, 1);
  // scanned page with a coffee ring
  const sx = PX + 24, sy = PY + 108;
  g.fillStyle = '#f4f1e8'; g.fillRect(sx, sy, 230, 300); g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(sx, sy, 230, 300);
  g.fillStyle = '#5a5a5a'; for (let k = 0; k < 22; k++) g.fillRect(sx + 18, sy + 30 + k * 11, 150 + ((k * 53) % 46), 3);
  g.font = font(15, 700); g.fillStyle = '#222'; g.fillText('PAGE 12', sx + 18, sy + 20);
  g.strokeStyle = 'rgba(120,80,40,0.55)'; g.lineWidth = 7; g.beginPath(); g.arc(sx + 158, sy + 210, 44, 0.3, Math.PI * 2 - 0.2); g.stroke();
  g.font = serif(15); g.fillStyle = '#000'; g.fillText('fig. 1: page 12, with coffee ring', sx, sy + 322);
  // body text
  const tx = sx + 256; let ty = sy + 16;
  g.font = serif(19);
  for (const line of ['This is the manual that came in the box with my', 'first modem. I scanned all forty pages so it', 'would not be lost. The AT commands are on', 'pages 11 to 14. Page 12 has a coffee ring on it', 'from 1990. I left it in.']) { g.fillText(line, tx, ty); ty += 26; }
  ty += 10;
  g.fillStyle = '#0000ee'; g.font = serif(19);
  for (const link of ['Download all 40 pages (2.1 MB)', 'AT command cheat sheet', 'My other old manuals']) {
    g.fillText(link, tx, ty); g.fillRect(tx, ty + 3, g.measureText(link).width, 1.5); ty += 28;
  }
  ty += 14; g.fillStyle = '#000'; g.font = serif(17, 700); g.fillText('You are visitor number', tx, ty);
  g.fillStyle = '#000'; g.fillRect(tx + 196, ty - 18, 92, 24); g.fillStyle = '#e8e8e8'; g.font = mono(17, 600); g.fillText('004127', tx + 206, ty);
  g.font = serif(14); g.fillStyle = '#333'; g.fillText('Best viewed at 640 x 480. Last updated October 22, 1996.', tx, ty + 34);
  g.restore();
  // status bar
  bevel(X, Y + H - 26, W, 26); g.font = font(13); g.fillStyle = '#000'; g.fillText('Document: Done.', X + 10, Y + H - 8);
  // the Overmind's writer window, over the page
  const OX = w - 452, OY = h - 300, OW = 420, OH = 236;
  g.fillStyle = '#000'; g.fillRect(OX - 1, OY - 1, OW + 2, OH + 2);
  g.fillStyle = '#e8e8e8'; g.fillRect(OX, OY, OW, 24); stripes(OX + 26, OY + 3, OW - 52, 18);
  g.fillStyle = '#e8e8e8'; g.fillRect(OX + OW / 2 - 92, OY + 2, 184, 20); g.font = font(14, 700); g.fillStyle = '#000'; g.textAlign = 'center'; g.fillText('OVERMIND  \u2014  A:\\', OX + OW / 2, OY + 17); g.textAlign = 'left';
  g.fillStyle = '#060606'; g.fillRect(OX, OY + 24, OW, OH - 24);
  g.shadowColor = 'rgba(255,255,255,0.5)'; g.shadowBlur = 6; g.fillStyle = '#e6e6e6';
  g.font = mono(15, 600); g.fillText('DISK 0213    SLOT 41/90    14:31', OX + 16, OY + 50);
  for (let k = 0; k < 90; k++) { const col = k % 30, row = Math.floor(k / 30); g.shadowBlur = k <= 40 ? 6 : 0; g.fillStyle = k < 40 ? '#e6e6e6' : k === 40 ? '#ffffff' : '#2e2e2e'; g.fillRect(OX + 16 + col * 12.9, OY + 64 + row * 13, 9, 9); }
  g.shadowBlur = 6;
  g.fillStyle = '#e6e6e6'; g.font = mono(14); g.fillText('writing MODEM_MANUAL_1989.TXT', OX + 16, OY + 128);
  g.font = mono(15);
  ['> minute 41. a modem manual from 1989.', '  page 12 has a coffee ring on it.', '  keeping the coffee ring too'].forEach((l, i) => g.fillText(l, OX + 16, OY + 160 + i * 22));
  g.fillRect(OX + 16 + g.measureText('  keeping the coffee ring too').width + 4, OY + 160 + 2 * 22 - 15, 10, 18);
  g.shadowBlur = 0;
  // faint scanlines and tube vignette
  g.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.78); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/**
 * A 1993 colour compact at the Color Classic's real size (368 × 251 × 320 mm): face tilted back, chin with the floppy
 * slot projecting forward, curved 10-inch tube. Restyled in our materials, with our badge and no maker's marks.
 */
function colorCompact(t: FloppyTextures, gu: GlassUniforms, clear: boolean): Machine {
  const m = materials(t, gu), b = new Builder();
  const shell: Key = clear ? 'glassCase' : 'abs';
  const W = 251, H = 368, front = 158, back = -154, bevel = 4;
  const tilt = Math.atan2(18, 232); // face leans back ~4.4°
  const faceZ = (y: number) => 146 - (y - 120) * Math.tan(tilt);
  // side profile (z, y), extruded across the width
  // the extrusion bevel grows the outline by `bevel`, so the profile is drawn that much inside the real surface
  const e = bevel;
  const profile = filletRing([[back + e, e, 1], [front - e, e, 1], [front - e, 104 - e, 10], [147 - e, 120, 6], [faceZ(352) - e, 352 - e, 20], [-30, 368 - e, 36], [back - 2 + e, 318 - e, 22]]);
  const body = new THREE.ExtrudeGeometry(shapeOf(profile), { depth: W - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  body.translate(0, 0, -(W - 2 * bevel) / 2).rotateY(-Math.PI / 2);
  const p = body.getAttribute('position'); // sides draw in toward the back, like the real case
  for (let i = 0; i < p.count; i++) { const k = Math.min(Math.max((120 - p.getZ(i)) / 270, 0), 1); p.setX(i, p.getX(i) * (1 - 0.06 * k)); }
  body.computeVertexNormals();
  b.add(shell, body);
  // things mounted on the tilted face: local frame at face height y, `out` mm proud of the surface
  const onFace = (g: THREE.BufferGeometry, y: number, out: number) =>
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, y + out * Math.sin(tilt), faceZ(y) + out * Math.cos(tilt)), new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, 0, 0)), new THREE.Vector3(1, 1, 1)));
  const scr = { y: 246, w: 172, h: 129 };
  b.add('absBlack', onFace(prism(W - 24, 222, 5, 16, 1.4, [rr(-scr.w / 2 - 4, -scr.h / 2 - 4 + (scr.y - 236), scr.w / 2 + 4, scr.h / 2 + 4 + (scr.y - 236), 12)]), 236, 2.5));
  // curved tube face (cylindrical, like a Trinitron), bowing toward the viewer
  const tube = new THREE.PlaneGeometry(scr.w, scr.h, 40, 1);
  const tp = tube.getAttribute('position');
  for (let i = 0; i < tp.count; i++) tp.setZ(i, 2.4 * (1 - (tp.getX(i) / (scr.w / 2)) ** 2));
  tube.computeVertexNormals();
  const display = new THREE.Mesh(onFace(tube, scr.y, 0.6), new THREE.MeshBasicMaterial({ map: webScreenTexture(), color: new THREE.Color(1.4, 1.4, 1.4) }));
  b.add('dark', onFace(prism(scr.w + 10, scr.h + 10, 2, 12, 0.4), scr.y, -0.6));
  // picture tube behind the face, along the tilted axis
  const along = (g: THREE.BufferGeometry, depth: number) => onFace(g.translate(0, 0, -depth), scr.y, 0);
  b.add('matte', along(new THREE.CylinderGeometry(28, 100, 118, 4, 1, true).rotateY(Math.PI / 4).rotateX(-Math.PI / 2).scale(1.3, 1, 1), 64));
  b.add('chip', along(cyl(14, 70, 32).rotateX(Math.PI / 2), 158));
  b.add('steel', along(cyl(32, 24, 40).rotateX(Math.PI / 2), 128));
  // chin: slot plate, status light, badge
  const slot = { x: 46, y: 64 };
  b.add('absBlack', at(prism(122, 18, 3, 3, 0.6, [rr(-49, -2.8, 49, 2.8, 1.4)]), slot.x, slot.y, front + 1.2));
  b.add('led', at(prism(4.5, 1.4, 1, 0.5, 0), slot.x - 68, slot.y, front + 0.8));
  for (let k = 0; k < 3; k++) b.add('absBlack', at(prism(W - 60, 1, 1.4, 0.4, 0.2), 0, 22 + k * 6, front + 0.4)); // fine grooves low on the chin
  // drive behind the slot, with the disk in it
  const diskZ = front - 3 - 47;
  b.add('steel', at(slab(104, 150, 1, 3, 0.3), slot.x, slot.y - 12, diskZ - 18));
  for (const x of [-52, 52]) b.add('steel', at(prism(1, 22, 150, 0.4, 0.2), slot.x + x, slot.y - 2, diskZ - 18));
  mechanism(b, slot.y, diskZ + 1.5, diskZ - 29.9, slot.x);
  // boards, power, fan, rear vents
  b.add('dark', at(slab(220, 230, 1.6, 4, 0.4), 0, 9, -10));
  for (const [x, z, w2, d] of [[-70, 40, 26, 26], [-34, 54, 16, 16], [-40, -20, 34, 20], [60, -60, 14, 14], [-80, -50, 20, 12], [10, -90, 40, 14]] as const) b.add('chip', at(slab(w2, d, 2.4, 0.8, 0.3), x, 11, z));
  b.add('dark', at(prism(1.6, 150, 200, 3, 0.4), -110, 110, -10)); // analog board
  b.add('chip', at(cyl(14, 34, 24).rotateZ(Math.PI / 2), -94, 160, -50));
  for (const [y, z] of [[70, 20], [80, -12], [62, -72]]) b.add('steel', at(cyl(7, 22, 20).rotateZ(Math.PI / 2), -98, y, z));
  b.add('steel', at(prism(76, 70, 96, 3, 0.6), 76, 50, -96)); // power supply
  b.add('dark', at(cyl(30, 12, 40).rotateX(Math.PI / 2), -66, 240, -138)); // fan
  for (let k = 0; k < 10; k++) b.add('absBlack', at(prism(150, 2.2, 3, 1, 0.4), 0, 170 + k * 8, back + 1)); // rear vents
  for (const [x, z] of [[-100, 120], [100, 120], [-100, -120], [100, -120]]) b.add('dark', at(cyl(7, 2, 20), x, -1, z));
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(46, 10), new THREE.MeshStandardMaterial({ map: badgeTexture(), metalness: 1, roughness: 0.35, color: 0xd0d0d0 }));
  badge.position.set(-74, slot.y, front + 0.5);
  const group = b.build(m);
  group.add(display, badge);
  return { group, height: H, screen: display.material.map!, disk: (s) => flatDisk(slot.x, slot.y, diskZ + s * 70) };
}

/* ------------------------------------------------------------------ H/I: Internet 98 */
/**
 * Lofted shell: superellipse rings from the front opening to a rounded back. Each ring: centre y, half-width a,
 * half-height b, squareness n, at depth z. Returns an indexed side surface (the last ring is tiny, closing the back).
 */
function loft(rings: { z: number; c: number; a: number; b: number; n: number }[], M = 120) {
  const pos: number[] = [], idx: number[] = [], uv: number[] = [];
  rings.forEach((r, j) => {
    for (let i = 0; i < M; i++) {
      const th = (i / M) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
      pos.push(r.a * Math.sign(cs) * Math.abs(cs) ** (2 / r.n), r.c + r.b * Math.sign(sn) * Math.abs(sn) ** (2 / r.n), r.z);
      uv.push(i / M, j / (rings.length - 1));
    }
  });
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < M; i++) {
    const a = j * M + i, b = j * M + ((i + 1) % M), c = (j + 1) * M + i, d = (j + 1) * M + ((i + 1) % M);
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure the normals face out (+x at θ = 0 on the middle ring)
  const mid = Math.floor(rings.length / 2) * M, n = g.getAttribute('normal');
  if (n.getX(mid) < 0) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}
const superRing = (a: number, b: number, n: number, cy = 0, M = 120): V2[] =>
  Array.from({ length: M }, (_, i) => { const th = (i / M) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th); return [a * Math.sign(cs) * Math.abs(cs) ** (2 / n), cy + b * Math.sign(sn) * Math.abs(sn) ** (2 / n)] as V2; });

/**
 * The 1998 "internet" all-in-one at its real size (401 × 386 × 447 mm), restyled in our materials: a translucent shell
 * around a 15-inch tube. It shipped without a floppy drive, so ours has a translucent external drive beside it.
 */
function internetCompact(t: FloppyTextures, gu: GlassUniforms, tint: number): Machine {
  const m = materials(t, gu), b = new Builder();
  m.glassCase.color.setScalar(tint);
  m.glassCase.envMapIntensity = 0.13; // a big convex shell turns the softbox into one huge highlight; keep it a sheen
  m.glassCase.roughness = 0.2;
  (m.glassCase.userData.edgeUniform as { value: number }).value = 0.16;
  const X = -84; // the computer sits left, the drive right
  const front = 222, depth = 447;
  // shell: front half keeps its full size, then rounds down into the back
  const rings: { z: number; c: number; a: number; b: number; n: number }[] = [];
  const K = 28;
  for (let k = 0; k <= K; k++) {
    const u = k / K, z = front - u * depth;
    const top = 401 - 118 * u ** 2.1, bottom = 4 + 70 * u ** 2.4;
    let a = 193 - 70 * u ** 1.7, hb = (top - bottom) / 2;
    const close = u > 0.8 ? Math.sqrt(Math.max(1 - ((u - 0.8) / 0.2) ** 2, 0.0004)) : 1;
    a *= close; hb *= close;
    rings.push({ z, c: (top + bottom) / 2, a, b: hb, n: 3.4 - 1.1 * u });
  }
  b.add('glassCase', loft(rings).translate(X, 0, 0));
  // front bezel: closes the opening, with the screen window
  const r0 = rings[0];
  const scr = { y: 236, w: 280, h: 210 };
  const bezelOutline = superRing(r0.a - 3, r0.b - 3, r0.n, 0);
  const bezel = new THREE.ExtrudeGeometry(shapeOf(bezelOutline, [rr(-scr.w / 2 - 6, scr.y - r0.c - scr.h / 2 - 6, scr.w / 2 + 6, scr.y - r0.c + scr.h / 2 + 6, 14).reverse()]),
    { depth: 6, bevelEnabled: true, bevelThickness: 1.6, bevelSize: 1.6, bevelSegments: 3, curveSegments: 12 });
  b.add('absBlack', bezel.translate(X, r0.c, front - 7));
  // tube face, gently curved both ways
  const tube = new THREE.PlaneGeometry(scr.w, scr.h, 40, 30);
  const tp = tube.getAttribute('position');
  for (let i = 0; i < tp.count; i++) tp.setZ(i, 3.5 * (1 - (tp.getX(i) / (scr.w / 2)) ** 2) * (1 - 0.7 * (tp.getY(i) / (scr.h / 2)) ** 2));
  tube.computeVertexNormals();
  const display = new THREE.Mesh(tube.translate(X, scr.y, front - 6), new THREE.MeshBasicMaterial({ map: webScreenTexture(), color: new THREE.Color(1.4, 1.4, 1.4) }));
  b.add('dark', at(prism(scr.w + 12, scr.h + 12, 2, 14, 0.4), X, scr.y, front - 7.5));
  // picture tube, neck and yoke behind it
  b.add('matte', at(new THREE.CylinderGeometry(34, 168, 190, 4, 1, true).rotateY(Math.PI / 4).rotateX(-Math.PI / 2).scale(1.33, 1, 1), X, scr.y, front - 112));
  b.add('chip', at(cyl(17, 110, 32).rotateX(Math.PI / 2), X, scr.y, front - 260));
  b.add('steel', at(cyl(40, 30, 40).rotateX(Math.PI / 2), X, scr.y, front - 220));
  // below the screen: badge, speaker grilles, power light
  for (const side of [-1, 1]) for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++)
    b.add('dark', at(cyl(1.6, 1.2, 10).rotateX(Math.PI / 2), X + side * (128 + c * 6.5 - (r % 2) * 3.2), 58 + r * 6.5, front + 0.2));
  b.add('led', at(cyl(2.2, 1, 16).rotateX(Math.PI / 2), X + 88, 64, front + 0.4));
  // inside: bottom tray with the boards, a disc drive under the tube (no floppy), speakers, power supply
  b.add('steel', at(slab(300, 300, 1.2, 8, 0.3), X, 14, 20));
  for (const [x, z, w2, d] of [[-90, 60, 30, 30], [-40, 80, 18, 18], [40, 40, 40, 22], [100, -40, 16, 16], [-100, -60, 22, 14], [10, -90, 50, 16]] as const) b.add('chip', at(slab(w2, d, 2.6, 0.8, 0.3), X + x, 16.5, z));
  b.add('dark', at(slab(260, 250, 1.6, 6, 0.4), X, 12, 10));
  b.add('dark', at(slab(146, 180, 28, 3, 0.6), X, 44, 96)); // disc drive
  for (const side of [-1, 1]) b.add('dark', at(cyl(22, 24, 32).rotateX(Math.PI / 2), X + side * 150, 72, front - 22)); // speakers
  b.add('dark', at(prism(100, 80, 110, 3, 0.6), X + 70, 60, -110)); // power supply
  // carry handle: a slot through the top rear of the shell
  const hu = 0.66, hz = front - hu * depth, hy = 401 - 118 * hu ** 2.1 - 10;
  b.add('absBlack', at(slab(120, 24, 3, 10, 1).rotateX(-0.34), X, hy + 9, hz));
  for (const [x, z] of [[-120, 160], [120, 160], [-80, -120], [80, -120]]) b.add('dark', at(cyl(8, 3, 20), X + x, 0.5, z));
  // external floppy drive, beside the computer
  const DX = 196, DW = 124, DD = 170, DH = 25, df = 200;
  b.add('glassCase', at(slab(DW, DD, DH, 11, 3), DX, DH / 2, df - DD / 2));
  b.add('absBlack', at(prism(DW - 8, 15, 3, 3, 0.6, [rr(-49, -2.6, 49, 2.6, 1.3)]), DX, 12.5, df + 0.4));
  b.add('led', at(prism(5, 1.4, 1, 0.5, 0), DX - 52, 6, df + 2));
  for (const [x, z] of [[-50, -14], [50, -14], [-50, -156], [50, -156]]) b.add('dark', at(cyl(5, 1.5, 16), DX + x, -0.2, df + z));
  const diskZ = df - 3 - 47;
  mechanism(b, 12.5, diskZ + 1.5, diskZ - 29.9, DX);
  // cable from the back of the drive round into the side of the computer
  const cable = new THREE.CatmullRomCurve3([
    new THREE.Vector3(DX, 8, df - DD - 2), new THREE.Vector3(DX, 6, df - DD - 50), new THREE.Vector3(DX - 70, 8, df - DD - 60),
    new THREE.Vector3(X + 168, 40, -40), new THREE.Vector3(X + 160, 70, -10),
  ]);
  b.add('dark', new THREE.TubeGeometry(cable, 64, 2.4, 10, false));
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(52, 11), new THREE.MeshStandardMaterial({ map: badgeTexture(), metalness: 1, roughness: 0.35, color: 0xd0d0d0 }));
  badge.position.set(X, 74, front + 0.6);
  const group = b.build(m);
  group.add(display, badge);
  return { group, height: 401, screen: display.material.map!, disk: (s) => flatDisk(DX, 12.5, diskZ + s * 70) };
}

export function buildMachine(concept: Concept, t: FloppyTextures, gu: GlassUniforms, opts: PcOptions = {}): Machine {
  switch (concept) {
    case 'a': return slabDrive(t, gu);
    case 'b': return monolith(t, gu);
    case 'c': return terminal(t, gu);
    case 'd': return compact(t, gu, true);
    case 'e': return compact(t, gu, false);
    case 'f': return colorCompact(t, gu, true);
    case 'g': return colorCompact(t, gu, false);
    case 'h': return internetCompact(t, gu, 0.93);
    case 'i': return internetCompact(t, gu, 0.42);
    case 'pc-beige': return buildPC(t, gu, 'beige', { screen: webScreenTexture(), ...opts });
    case 'pc-obsidian': return buildPC(t, gu, 'obsidian', { screen: webScreenTexture(), ...opts });
    case 'pc-clear': return buildPC(t, gu, 'clear', { screen: webScreenTexture(), ...opts });
  }
}
