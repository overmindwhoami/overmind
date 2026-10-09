/**
 * Floppy lookdev: renders single disks or small arrangements through the production lighting and post chain.
 * Dev-only page (lookdev.html). Query: view=single|row|stack, shell, open, protect, label, rx/ry/rz (deg), d, el, side=0|1, ap.
 */
import * as THREE from 'three';
import { CAMERA } from '../design-system/scene';
import { DRIFT } from '../design-system/motion';
import { Composer } from './engine/composer';
import { Lighting } from './engine/lighting';
import { settings } from './engine/settings';
import { createKit, SHELLS, type FloppyRecord } from './engine/floppy/kit';
import { rng } from './engine/floppy/textures';
import { LABEL_FONTS } from './engine/floppy/labels';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const deg = Math.PI / 180;
const view = q.get('view') ?? 'single';

const r = rng(num('seed', 42));
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(r(0, 16)).toString(16)).join('');
function record(i: number, over: Partial<FloppyRecord> = {}): FloppyRecord {
  const shell = over.shell ?? i % SHELLS.length;
  const [a, b] = SHELLS[shell].tint;
  return {
    index: i, gen: 41 + i, parent: 38 + i, hash: hex(64), block: 18_912_044 + i * 17_311, born: `2025-10-${String(6 + i).padStart(2, '0')}`,
    label: i % 5, seed: 1000 + i * 77, alive: i % 2 === 0, shell, tint: a + (b - a) * r(), open: 0, protect: false, hub: r(0, Math.PI * 2), ...over,
  };
}
const shared: Partial<FloppyRecord> = {};
if (q.has('shell')) shared.shell = num('shell', 2);
if (q.has('open')) shared.open = num('open', 0);
if (q.has('protect')) shared.protect = q.get('protect') === '1';
if (q.has('label')) shared.label = num('label', 0);

type Placed = { rec: FloppyRecord; m: THREE.Matrix4 };
const placed: Placed[] = [];
const pose = (x: number, y: number, z: number, rx: number, ry: number, rz: number) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
if (view === 'row') {
  for (let i = 0; i < 5; i++) placed.push({ rec: record(i, { ...shared, shell: i }), m: pose((i - 2) * 0.82, 0, 0, num('rx', -12) * deg, (num('ry', 18) + (q.get('side') === '0' ? 180 : 0)) * deg, num('rz', 0) * deg) });
} else if (view === 'stack') {
  const shells = [2, 0, 3, 2, 1, 4, 2, 0];
  shells.forEach((s, i) => {
    const rec = record(i, { ...shared, shell: s, open: i === 1 ? 0.6 : 0, label: i % 5 });
    placed.push({ rec, m: pose(r(-0.05, 0.05), i * 0.045, r(-0.05, 0.05), -Math.PI / 2 + r(-0.015, 0.015), r(-0.5, 0.5) + 0.4, r(-0.015, 0.015)) });
  });
} else {
  placed.push({ rec: record(0, { label: 0, ...shared }), m: pose(0, 0, 0, num('rx', -10) * deg, (num('ry', 14) + (q.get('side') === '0' ? 180 : 0)) * deg, num('rz', 0) * deg) });
}

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(num('dpr', Math.min(devicePixelRatio, 2)));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(num('fov', CAMERA.fov), innerWidth / innerHeight, 0.05, 30);
const lighting = new Lighting(renderer, scene);
const composer = new Composer(renderer);
const glassUniforms = { uEdgeColor: { value: new THREE.Color('#ffffff') }, uEdgeGlow: { value: settings.edgeGlow }, uGlassOpacity: { value: settings.glassOpacity } };

async function main() {
  await document.fonts.ready;
  await Promise.all(LABEL_FONTS.map((f) => document.fonts.load(f)));
  const kit = createKit(placed.map((p) => p.rec), glassUniforms, { lite: q.get('quality') === 'low' });
  kit.atlas.paint();
  for (const part of kit.parts) {
    const ms: THREE.Matrix4[] = [], cs: THREE.Color[] = [], cells: number[] = [];
    for (const p of placed) part.place(p.rec, (m, c) => { ms.push(p.m.clone().multiply(m)); if (c) cs.push(c); cells.push(p.rec.index); });
    if (!ms.length) continue;
    const g = part.geometry.clone();
    if (part.cells) g.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cells), 1));
    const mesh = new THREE.InstancedMesh(g, part.material, ms.length);
    ms.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (cs.length === ms.length) cs.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  const d = num('d', view === 'row' ? 3.7 : view === 'stack' ? 1.9 : 1.3), el = num('el', view === 'stack' ? 26 : 4) * deg;
  const target = new THREE.Vector3(num('tx', 0), num('ty', view === 'stack' ? 0.12 : 0), 0);
  camera.position.set(target.x, target.y + Math.sin(el) * d, Math.cos(el) * d);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  lighting.update(new THREE.Vector2(), scene, settings);
  const frame = () => {
    renderer.setRenderTarget(composer.scene);
    renderer.render(scene, camera);
    composer.render({
      dt: 1 / 60, focus: camera.position.distanceTo(target) + DRIFT.focusBase * 0, frame: 0, time: 0,
      projectionInverse: camera.projectionMatrixInverse, reproject: new THREE.Matrix4(),
      settings: { ...settings, aperture: num('ap', settings.aperture * 0.35) },
    });
  };
  await renderer.compileAsync(scene, camera);
  frame(); frame();
  (window as unknown as { __ready: boolean }).__ready = true;
  if (q.has('debug')) Object.assign(window, { kit, scene, camera, renderer, frame });
}
main();
