/**
 * Floppy kit: every part as world-unit geometry + material + a placement rule per replica.
 * The tower (and the lookdev page) instance these parts; 8 instanced draws per visible tower copy.
 */
import * as THREE from 'three';
import spec from '../tower-spec.json';
import { HUB, SHUTTER, SLIDER } from './spec';
import { glassShellGeometry, hubGeometry, labelGeometry, linerGeometry, mediaGeometry, shellGeometry, shutterGeometry, sliderGeometry } from './parts';
import { createMaterials, createTextures, type GlassUniforms } from './materials';
import { buildLabelAtlas, type LabelData } from './labels';

/** World units per millimetre: floppies are drawn at cassette-equivalent screen area (the reference uses 0.01). */
export const MM = spec.mm;

/** Shell kinds (tower-spec.json). Translucent kinds use the reference's smoked-glass patch and show the internals. */
export const SHELLS = spec.shells;

export interface FloppyLook {
  shell: number; // index into SHELLS
  tint: number; // glass tint or ABS albedo (linear)
  open: number; // shutter, 0 closed … 1 fully open
  protect: boolean; // write-protect window open
  hub: number; // hub angle, radians
}
export type FloppyRecord = LabelData & FloppyLook;

export interface KitPart {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  cells?: boolean; // per-instance atlas cell (labels)
  place: (rec: FloppyRecord, add: (m: THREE.Matrix4, c?: THREE.Color) => void) => void;
}

const toWorld = <T extends THREE.BufferGeometry>(g: T) => { g.scale(MM, MM, MM); g.computeBoundingSphere(); return g; };
const grey = (v: number) => new THREE.Color(v, v, v);
export const local = (x: number, y: number, z = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x * MM, y * MM, z * MM), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rz), new THREE.Vector3(1, 1, 1));

/** `lite` (phones, ?quality=low): half-size textures and label atlas, lighter case mesh. */
export function createKit(records: FloppyRecord[], glassUniforms: GlassUniforms, { lite = false } = {}) {
  performance.mark('kit:textures');
  const textures = createTextures(lite);
  performance.mark('kit:atlas');
  const atlas = buildLabelAtlas(records, lite ? 2048 : 4096);
  performance.mark('kit:geometry');
  const M = createMaterials(textures, glassUniforms, atlas);
  const shellMm = shellGeometry(lite);
  const glassShell = toWorld(glassShellGeometry(shellMm));
  const shell = toWorld(shellMm);
  const I = new THREE.Matrix4();
  const glass = (r: FloppyRecord) => SHELLS[r.shell].glass;
  const parts: KitPart[] = [
    { name: 'shell', geometry: shell, material: M.abs, place: (r, add) => { if (!glass(r)) add(I, grey(r.tint)); } },
    { name: 'shutter', geometry: toWorld(shutterGeometry()), material: M.steel, place: (r, add) => add(local(-r.open * SHUTTER.travel, 0)) },
    { name: 'hub', geometry: toWorld(hubGeometry()), material: M.hub, place: (r, add) => add(local(HUB.center[0], HUB.center[1], 0, r.hub)) },
    { name: 'media', geometry: toWorld(mediaGeometry()), material: M.media, place: (_r, add) => add(I) },
    { name: 'liner', geometry: toWorld(linerGeometry()), material: M.liner, place: (r, add) => { if (glass(r)) add(I); } },
    { name: 'slider', geometry: toWorld(sliderGeometry()), material: M.slider, place: (r, add) => add(local(SLIDER.x, r.protect ? SLIDER.yProtected : SLIDER.yEnabled)) },
    { name: 'label', geometry: toWorld(labelGeometry().geometry), material: M.label, cells: true, place: (r, add) => { if (r.label >= 0) add(I); } },
    { name: 'glass', geometry: glassShell, material: M.glass, place: (r, add) => { if (glass(r)) add(I, grey(r.tint)); } },
  ];
  performance.mark('kit:end');
  const textureList: THREE.Texture[] = [atlas.tex, ...Object.values(textures).flatMap((t) => (t instanceof THREE.Texture ? [t] : Object.values(t)))];
  return { parts, textures, textureList, atlas, materials: M };
}
export type FloppyKit = ReturnType<typeof createKit>;
