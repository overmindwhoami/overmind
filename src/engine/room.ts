/**
 * The room around the tower (docs/reference-room/room/01-layout): a dark, windowless room with black walls and a
 * black floor, lit in pools. The tower rises out of a shaft in the middle of the floor on a clear lift column; the
 * desk with the computer and the manual stands behind it to the right under the $OMD board; the Q-Day clock, the
 * disk wall, the duplicator and the vending machine stand round it. Each menu place is one of these objects.
 *
 * The room is anchored to the top of the lineage: its floor sits a fixed height under the home camera, so the
 * computer keeps the pose it had before the room existed and the tower sinks into the shaft as it grows.
 * Millimetres inside `scaled`; `root` is in world units.
 */
import * as THREE from 'three';
import { MM, DiskSet, SHELLS, type FloppyKit, type FloppyRecord } from './floppy/kit';
import { BLANK_LABEL } from './floppy/labels';
import { lightScale, type GlassUniforms } from './floppy/materials';
import { Board, BOARD } from '../machine/board';
import { QClock, CLOCK } from '../machine/clock';
import { buildDesk, DESK } from '../machine/desk';
import { Manual, MANUAL } from '../machine/manual';
import { Duplicator, DUP } from '../machine/duplicator';
import { buildWall, slot as wallSlot, SLOTS as WALL_SLOTS, WALL } from '../machine/wall';
import { Vending, VEND, VEND_TURNS, vendingBlanks } from '../machine/vending';
import type { Current } from './dirty';

/** The room wakes in groups (the first visit lights them one at a time): the clock, the computer, everything else. */
export type WakeGroup = 'clock' | 'computer' | 'rest';
export type PlaceName = 'tower' | 'docs' | 'omd' | 'terminal' | 'launch' | 'explorer' | 'mint' | 'room';
export const PLACES: { name: Exclude<PlaceName, 'tower'>; label: string; soon?: boolean }[] = [
  { name: 'docs', label: 'docs' },
  { name: 'omd', label: '$OMD' },
  { name: 'terminal', label: 'terminal' },
  { name: 'launch', label: 'launch' },
  { name: 'explorer', label: 'explorer' },
  { name: 'mint', label: 'mint', soon: true },
];

/** The computer's pose, as it was before the room: right of and behind the tower, its feet this far under the home camera (world units). */
const PC = { x: 3.3, drop: 2.45, z: -9.4, ry: -0.38 };
const BACK = -2000; // back wall (mm)
const SIDE = 3400; // side walls at ±x (mm)
const SHAFT = 270; // radius of the opening round the tower (mm)
/** Where each place's camera stands: distance in units of the object's size, height and sideways offsets (fractions). */
type View = { box: THREE.Object3D; fit: number; up: number; side: number; look?: THREE.Vector3; kind: Current['kind'] };

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** The room view on tall screens: centre looked at (mm), camera pitch and turn (radians), distance (mm). */
const ROOM_TALL = { x: 300, y: 760, z: -620, pitch: 0.84, yaw: 0.86, d: 7300 };
/** Layer of the room's click targets: never drawn. */
const HIT_LAYER = 5;
const place = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; return o; };

export class Room {
  /** World units; its y is the floor's height. */
  readonly root = new THREE.Group();
  /** Millimetres. */
  readonly scaled = new THREE.Group();
  board!: Board;
  clock!: QClock;
  manual!: Manual;
  duplicator!: Duplicator;
  vending!: Vending;
  /** Readable surfaces: the dither treatment leaves them clean. */
  readonly faces: THREE.Mesh[] = [];
  /** Silhouettes that keep mild colour and are still (static reprojection): drawn on the colour layer only. */
  readonly proxies = new THREE.Group();
  /** The computer's place in the room (mm), for the station. */
  readonly pcAnchor = new THREE.Object3D();
  private lift = new THREE.Group();
  /** Click targets in the room view: invisible boxes on a layer no camera draws, each naming its place. */
  private hits = new THREE.Group();
  private views!: Record<Exclude<PlaceName, 'tower' | 'terminal' | 'room'>, View>;
  private floorY = 0;
  /** Readable surfaces by place: only the place being visited stays clean. */
  readonly placeFaces: Partial<Record<PlaceName, THREE.Mesh[]>> = {};
  private boardAt = -1;
  /** The blank disks in the room: every vending lane full, one in every wall cubby (tokens take them over as they launch). */
  private blanks?: { set: DiskSet; entries: { rec: FloppyRecord; matrix: THREE.Matrix4; cell: number }[]; kit: FloppyKit; cell: number };
  private placed = false;
  /** How lit each group is (0 dark … 1 as normal), where it's heading, and how fast it gets there. */
  readonly wake: Record<WakeGroup, { value: number }> = { clock: { value: 1 }, computer: { value: 1 }, rest: { value: 1 } };
  private wakeTarget: Record<WakeGroup, number> = { clock: 1, computer: 1, rest: 1 };
  private wakeRate: Record<WakeGroup, number> = { clock: 2.2, computer: 2.2, rest: 1.3 };
  private spots: { light: THREE.SpotLight; base: number; group: WakeGroup }[] = [];
  /** Until the coin exists the board says so (it only ever shows numbers that add up). */
  boardRows = ['$OMD', 'NOT LAUNCHED', 'NUMBERS WHEN', 'IT IS LIVE'];

  constructor() {
    this.scaled.scale.setScalar(MM);
    this.root.add(this.scaled, this.lift);
  }

  /** Builds the room one object at a time; `step` runs between them (the loader yields a frame there). */
  async build(kit: FloppyKit, glass: GlassUniforms, step: () => Promise<void> = async () => {}) {
    const t = kit.textures;
    const S = this.scaled;

    // the computer's pose: from its old place relative to the home camera
    const pcPos = v3(PC.x / MM, DESK.h, PC.z / MM);
    place(this.pcAnchor, pcPos.x, pcPos.y, pcPos.z, PC.ry);
    S.add(this.pcAnchor);
    // the desk under it, turned the same way, the computer a little left of its centre and back
    await step();
    const desk = new THREE.Group();
    desk.add(buildDesk(t, glass));
    const deskAt = pcPos.clone().sub(v3(-260, 0, -40).applyAxisAngle(v3(0, 1, 0), PC.ry)).setY(0);
    S.add(place(desk, deskAt.x, 0, deskAt.z, PC.ry));
    await step();
    this.manual = new Manual(t, glass);
    const manualAt = deskAt.clone().add(v3(470, 0, 110).applyAxisAngle(v3(0, 1, 0), PC.ry)).setY(DESK.h);
    S.add(place(this.manual.group, manualAt.x, manualAt.y, manualAt.z, PC.ry + 0.14));

    // on the back wall: the board above the desk, the clock to its left, the disk wall further left
    await step();
    this.board = new Board(t, glass);
    S.add(place(this.board.group, 980, 1140, BACK));
    await step();
    this.clock = new QClock(t, glass);
    S.add(place(this.clock.group, -1060, 1030, BACK));
    await step();
    const wall = new THREE.Group();
    wall.add(buildWall(t, glass));
    S.add(place(wall, -2380, 330, BACK));
    // on the floor: the duplicator on a clear plinth front left, the vending machine right
    await step();
    this.duplicator = new Duplicator(t, glass);
    const dup = new THREE.Group();
    dup.add(plinth(DUP.w + 120, 560, DUP.d + DUP.tray + 60, glass, t), place(this.duplicator.group, 0, 560, -DUP.tray / 2));
    S.add(place(dup, -1150, 0, 650, 0.55)); // in front of the tower's left, clear of the wall's view
    await step();
    this.vending = new Vending(t, glass);
    S.add(place(this.vending.group, 2650, 0, -1450, -0.55));

    this.faces.push(...this.board.faces, ...this.clock.faces, this.manual.pages, ...this.duplicator.faces, ...this.vending.faces);
    Object.assign(this.placeFaces, { omd: this.board.faces, docs: [this.manual.pages], launch: this.duplicator.faces, mint: this.vending.faces });
    await step();
    this.shell(glass);
    this.lights();
    this.buildLift();
    this.fillBlanks(kit, wall);
    this.wakeable('clock', this.clock.group, [this.clock.lit]);
    this.wakeable('computer', desk);
    this.wakeable('computer', this.manual.group);
    for (const o of [this.board.group, wall, dup, this.vending.group]) this.wakeable('rest', o);

    // colour and stillness for each object: boxes round them (the mask only needs silhouettes)
    const proxy = (o: THREE.Object3D, w: number, h: number, d: number, y: number, z = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
      m.position.set(0, y, z);
      const g = new THREE.Group();
      g.add(m);
      g.position.copy(o.position); g.rotation.copy(o.rotation);
      this.proxies.add(g);
    };
    proxy(this.board.group, BOARD.w, BOARD.h + 300, BOARD.d + BOARD.off, BOARD.h / 2, (BOARD.off + BOARD.d) / 2);
    proxy(this.clock.group, CLOCK.w, CLOCK.h, CLOCK.d + CLOCK.off, CLOCK.h / 2, (CLOCK.off + CLOCK.d) / 2);
    proxy(wall, WALL.cols * WALL.pitchX + 120, WALL.rows * WALL.pitchY + 80, WALL.off + WALL.depth + 20, WALL.base + (WALL.rows * WALL.pitchY) / 2, (WALL.off + WALL.depth) / 2);
    proxy(desk, DESK.w, DESK.h, DESK.d, DESK.h / 2);
    proxy(dup, DUP.w + 120, 560 + DUP.h + DUP.hopper.h, DUP.d + DUP.tray + 60, (560 + DUP.h + DUP.hopper.h) / 2);
    proxy(this.vending.group, VEND.w, VEND.h, VEND.d, VEND.h / 2);
    S.add(this.proxies);

    // click targets (room view): each object's box, the computer, and the tower on its lift
    this.root.updateMatrixWorld(true);
    const toLocal = this.scaled.matrixWorld.clone().invert();
    const hit = (place: PlaceName, box: THREE.Box3) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      box.getCenter(m.position); box.getSize(m.scale);
      m.layers.set(HIT_LAYER);
      m.userData.place = place;
      this.hits.add(m);
    };
    const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).applyMatrix4(toLocal);
    hit('omd', boxOf(this.board.group));
    hit('docs', boxOf(this.manual.group).expandByVector(v3(20, 40, 20)));
    hit('terminal', new THREE.Box3().setFromCenterAndSize(pcPos.clone().add(v3(0, 260, 40)), v3(560, 560, 560)));
    hit('launch', boxOf(dup));
    hit('explorer', boxOf(wall));
    hit('mint', boxOf(this.vending.group));
    hit('tower', new THREE.Box3(v3(-360, 0, -360), v3(360, PC.drop / MM + DESK.h + 120, 360)));
    S.add(this.hits);

    this.views = {
      omd: { box: this.board.group, fit: 1.12, up: 0.02, side: -0.06, look: v3(0, BOARD.h / 2, BOARD.off + BOARD.d), kind: 'rain' },
      docs: { box: this.manual.group, fit: 1.15, up: 1.25, side: 0.05, look: v3(0, 10, 0), kind: 'pour' },
      launch: { box: this.duplicator.group, fit: 1.15, up: 0.16, side: 0.22, look: v3(0, 320, 30), kind: 'spiral' },
      explorer: { box: wall, fit: 1.1, up: 0.05, side: 0.08, look: v3(0, WALL.base + (WALL.rows * WALL.pitchY) / 2, WALL.off + WALL.depth), kind: 'rain' },
      mint: { box: this.vending.group, fit: 1.08, up: 0.1, side: 0.22, look: v3(0, 1150, VEND.d / 2), kind: 'radial' },
    };
  }

  /** Floor, walls, the shaft and its collar, light fixtures. */
  private shell(glass: GlassUniforms) {
    const S = this.scaled;
    const dark = (c: number, rough: number, env: number) => lightScale(new THREE.MeshStandardMaterial({ color: c, roughness: rough }), { env });
    // the floor runs on into the dark well past the walls (from a phone's high angle there is no edge to see past)
    const floorShape = new THREE.Shape([v3(-14000, -16000, 0), v3(14000, -16000, 0), v3(14000, -BACK, 0), v3(-14000, -BACK, 0)].map((p) => new THREE.Vector2(p.x, p.y)));
    floorShape.holes.push(new THREE.Path().absarc(0, 0, SHAFT, 0, Math.PI * 2, true));
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(floorShape, 48).rotateX(-Math.PI / 2), dark(0x1c1c1c, 0.34, 0.3));
    S.add(floor);
    const walls = dark(0x101010, 0.9, 0.08);
    S.add(place(new THREE.Mesh(new THREE.PlaneGeometry(SIDE * 2, 3600), walls), 0, 1800, BACK));
    for (const s of [-1, 1]) S.add(place(new THREE.Mesh(new THREE.PlaneGeometry(4600, 3600), walls), s * SIDE, 1800, BACK + 2300, -s * Math.PI / 2));
    // skirting: a thin strip catching the light where the walls meet the floor
    const skirt = dark(0x161616, 0.5, 0.3);
    S.add(place(new THREE.Mesh(new THREE.BoxGeometry(SIDE * 2, 60, 12), skirt), 0, 30, BACK + 6));
    // the shaft under the opening, and the collar round it: steel ring under a polished clear ring
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(SHAFT, SHAFT, 40000, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.8, side: THREE.BackSide }));
    shaft.position.y = -20000;
    S.add(shaft);
    for (let k = 1; k < 40; k++) S.add(place(new THREE.Mesh(new THREE.TorusGeometry(SHAFT - 2, 3, 6, 48).rotateX(Math.PI / 2), skirt), 0, -k * 900, 0)); // rings down the shaft
    S.add(place(new THREE.Mesh(new THREE.TorusGeometry(SHAFT + 18, 14, 12, 64).rotateX(Math.PI / 2), lightScale(new THREE.MeshStandardMaterial({ color: 0x9c9c98, metalness: 0.6, roughness: 0.4 }), { env: 0.6, direct: 0.6 })), 0, 4, 0));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(SHAFT + 18, 8, 10, 64).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.25 }));
    S.add(place(ring, 0, 22, 0));
    // track-light cans along the top of the back wall (01)
    const can = dark(0x111111, 0.4, 0.4);
    for (const x of [-2500, -1400, -300, 800, 1900, 2900]) S.add(place(new THREE.Mesh(new THREE.CylinderGeometry(45, 45, 160, 20).rotateX(0.5), can), x, 3300, BACK + 120));
    void glass;
  }

  /** Pools of light on the floor-standing places and the wall; the tower, desk and board keep the home view's own light. */
  private lights() {
    const spot = (from: THREE.Vector3, to: THREE.Vector3, intensity: number, angle: number) => {
      const l = new THREE.SpotLight(0xfff4e6, intensity, 0, angle, 0.75, 2);
      l.position.copy(from).multiplyScalar(MM);
      l.target.position.copy(to).multiplyScalar(MM);
      this.root.add(l, l.target);
      this.spots.push({ light: l, base: intensity, group: 'rest' });
    };
    spot(v3(-1000, 3400, 1400), v3(-1150, 500, 650), 4200, 0.34);
    spot(v3(-2200, 3400, -800), v3(-2380, 700, -2000), 4200, 0.42);
    spot(v3(2300, 3400, -400), v3(2650, 900, -1450), 4400, 0.4);
  }

  /**
   * Keeps the room under the home camera (`anchor` = the home camera's height), holds the lift column under the
   * tower's base (`base`, world y of genesis), and runs the board and the clock.
   */
  update(dt: number, anchor: number, base: number, now: number, qday: number, portrait = false) {
    // on a tall screen the room turns so the desk stands behind the tower (the computer's old portrait pose)
    this.root.rotation.y = portrait ? 0.274 : 0;
    const target = anchor - PC.drop - DESK.h * MM;
    this.floorY = !this.placed ? target : this.floorY + (target - this.floorY) * (1 - Math.exp(-dt * 3));
    this.placed = true;
    // waking: each group's light glides to its target (one law, no snapping); the pools follow their objects
    for (const g of ['clock', 'computer', 'rest'] as const) {
      const w = this.wake[g];
      w.value += (this.wakeTarget[g] - w.value) * (1 - Math.exp(-dt * this.wakeRate[g]));
      if (Math.abs(w.value - this.wakeTarget[g]) < 1e-3) w.value = this.wakeTarget[g];
    }
    for (const s of this.spots) s.light.intensity = s.base * this.wake[s.group].value;
    // the blank disks: keep their shared label cell in use (so the tower never takes it), show them with the room's light
    const b = this.blanks;
    if (b) {
      const cell = b.kit.atlas.cell(-1000, b.entries[0].rec);
      if (cell !== b.cell) { b.cell = cell; for (const e of b.entries) e.cell = cell; b.set.set(b.entries); }
      b.set.setVisible(this.wake.rest.value > 0.35);
    }
    this.root.position.y = this.floorY;
    this.lift.position.y = base - this.floorY; // the lift column's top, in the root's frame
    this.board.update(dt);
    this.clock.show(qday - now);
    this.clock.update(now);
    // the board flaps from blank to its rows as it wakes, and again now and then
    if (this.wake.rest.value > 0.3 && (this.boardAt < 0 || now - this.boardAt > 45_000)) {
      const first = this.boardAt < 0;
      this.boardAt = now;
      // the $OMD row flips in once and stays; the rows under it refresh (from blank, so they visibly turn over)
      if (!first) for (let r = 1; r < 4; r++) this.board.set(r, '', 'left', true);
      this.boardRows.forEach((s, r) => { if (first || r > 0) this.board.set(r, s, 'centre'); });
    }
  }

  /** Puts the floppy kit's disks into the vending lanes and the wall's cubbies (matrices in the root's frame). */
  private fillBlanks(kit: FloppyKit, wall: THREE.Object3D) {
    let seed = 11;
    const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // a 90s box of colour diskettes: solid coloured plastic (tinted see-through shells read as black at this size)
    const PALETTE = ['#d8322c', '#ef7b1f', '#f3c331', '#3aa857', '#1fa4a4', '#2b64cc', '#7b44b8', '#e2569c'].map((h) => new THREE.Color(h));
    const rec = (shell: number, color?: THREE.Color): FloppyRecord => {
      const [a, b] = SHELLS[shell].tint;
      return { index: -1, gen: 0, parent: null, hash: '0'.repeat(64), block: 0, born: '', label: BLANK_LABEL, seed: 1, alive: false,
        shell, tint: a + (b - a) * r(), open: 0, protect: false, hub: r() * Math.PI * 2, color };
    };
    const coloured = (i: number) => rec(2, PALETTE[i % PALETTE.length]);
    const BLANK_KEY = -1000;
    const cell = kit.atlas.cell(BLANK_KEY, rec(2));
    this.scaled.updateMatrix(); wall.updateMatrix(); this.vending.group.updateMatrix();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const toRoot = (parent: THREE.Object3D, local: THREE.Matrix4) => {
      new THREE.Matrix4().multiplyMatrices(this.scaled.matrix, parent.matrix).multiply(local).decompose(p, q, sc);
      return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)); // kit disks are already world-sized
    };
    const entries: { rec: FloppyRecord; matrix: THREE.Matrix4; cell: number }[] = [];
    // vending: every lane one colour (like a row of the same snack)
    const lanes = vendingBlanks(), perLane = VEND_TURNS;
    lanes.forEach((m, i) => {
      const lane = Math.floor(i / perLane);
      entries.push({ rec: coloured(lane * 3 + Math.floor(lane / 5)), matrix: toRoot(this.vending.group, m), cell });
    });
    // the wall: every colour, mixed
    for (let i = 0; i < WALL_SLOTS; i++) entries.push({ rec: coloured(Math.floor(r() * PALETTE.length)), matrix: toRoot(wall, wallSlot(i)), cell });
    const set = new DiskSet(kit, entries.length, this.root);
    set.set(entries);
    this.blanks = { set, entries, kit, cell };
  }

  /**
   * Makes a group wakeable: every material under `root` (but `skip`) multiplies its light by the group's level, so a
   * dark object is genuinely unlit, not covered. Call once per object, after it's built.
   */
  wakeable(group: WakeGroup, root: THREE.Object3D, skip: THREE.Material[] = []) {
    const u = this.wake[group], done = new Set<THREE.Material>(skip);
    root.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      for (const m of mat ? (Array.isArray(mat) ? mat : [mat]) : []) {
        if (done.has(m)) continue;
        done.add(m);
        const prev = m.onBeforeCompile.bind(m), prevKey = m.customProgramCacheKey.bind(m);
        m.onBeforeCompile = (shader, renderer) => {
          prev(shader, renderer);
          shader.uniforms.uWake = u;
          shader.fragmentShader = 'uniform float uWake;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n\tgl_FragColor.rgb *= uWake;');
        };
        m.customProgramCacheKey = () => `${prevKey()}|wake`;
        m.needsUpdate = true;
      }
    });
  }
  /** Sets where a group's light is heading (`now` jumps there). */
  light(group: WakeGroup, to: number, now = false) {
    this.wakeTarget[group] = to;
    if (now) this.wake[group].value = to;
  }

  /** Where each place's name tag floats in the room view (world units): above the middle of its click target. */
  anchors() {
    return this.hits.children.map((m) => {
      const box = new THREE.Box3().setFromObject(m);
      return { place: m.userData.place as PlaceName, pos: v3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2) };
    });
  }

  /** The place a ray points at in the room view (nearest click target). */
  pick(ray: THREE.Raycaster): PlaceName | undefined {
    ray.layers.set(HIT_LAYER);
    const hit = ray.intersectObject(this.hits, true)[0];
    ray.layers.set(0);
    return hit?.object.userData.place as PlaceName | undefined;
  }

  /** Puts the visited place's readable surfaces on `layer` (the clean layer) and takes everyone else's off it. */
  clean(place: PlaceName, layer: number) {
    for (const m of this.faces) m.layers.disable(layer);
    for (const m of this.placeFaces[place] ?? []) m.layers.enable(layer);
  }

  /** The lift column under the tower (world units): a clear square column with steel lead screws. */
  private buildLift() {
    const col = new THREE.Group();
    col.scale.setScalar(MM);
    const clear = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, transparent: true, opacity: 0.14, depthWrite: false });
    const steel = lightScale(new THREE.MeshStandardMaterial({ color: 0xb8b8b4, metalness: 1, roughness: 0.32 }), { env: 0.5, direct: 0.5 });
    const H = 30000;
    const body = new THREE.Mesh(new THREE.BoxGeometry(300, H, 300), clear);
    body.position.y = -H / 2 - 30;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(330, 22, 330), clear);
    plate.position.y = -16;
    col.add(body, plate);
    for (const [x, z] of [[-130, -130], [130, -130], [-130, 130], [130, 130]]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, H, 12), steel);
      rod.position.set(x, -H / 2 - 30, z);
      col.add(rod);
    }
    this.lift.add(col);
  }

  /** An object's world bounding box: measured once in the room's frame (the room only moves up and down). */
  private boxes = new Map<THREE.Object3D, THREE.Box3>();
  private boxOf(o: THREE.Object3D) {
    let local = this.boxes.get(o);
    if (!local) {
      this.root.updateMatrixWorld(true);
      local = new THREE.Box3().setFromObject(o, true).applyMatrix4(this.scaled.matrixWorld.clone().invert());
      this.boxes.set(o, local);
    }
    return local.clone().applyMatrix4(this.scaled.matrixWorld);
  }

  /** The camera's pose for a place (world units). `room` is the establishing view of the whole room. */
  view(name: Exclude<PlaceName, 'tower' | 'terminal'>, camera: THREE.PerspectiveCamera, yaw = 0) {
    if (name === 'room') {
      // the establishing view: from the front right, a little above, the whole room in frame (further back on tall screens)
      // `yaw` swings the camera round the room's middle (dragging in the room view). Tall screens look from higher
      // up and from the front right corner, so the room's depth fills the height instead of a band across the middle
      const tall = camera.aspect < 1, Y = v3(0, 1, 0);
      const centre = tall ? v3(ROOM_TALL.x, ROOM_TALL.y, ROOM_TALL.z) : v3(0, 900, -900);
      const off = tall
        ? v3(0, Math.sin(ROOM_TALL.pitch), Math.cos(ROOM_TALL.pitch)).applyAxisAngle(Y, ROOM_TALL.yaw + yaw).multiplyScalar(ROOM_TALL.d / Math.max(0.4, camera.aspect / 0.46) ** 0.5)
        : v3(2600, 1600, 4800).multiplyScalar(camera.aspect < 1.4 ? 1.3 : 1).applyAxisAngle(Y, yaw);
      const look = this.scaled.localToWorld(centre.clone()), pos = this.scaled.localToWorld(centre.clone().add(off));
      return { pos, look, distance: pos.distanceTo(look), kind: 'rain' as const, object: this.scaled };
    }
    if (name === 'docs') return this.docsView(camera);
    const v = this.views[name];
    v.box.updateWorldMatrix(true, true);
    const box = this.boxOf(v.box);
    const size = box.getSize(new THREE.Vector3());
    const look = (v.look ? v.box.localToWorld(v.look.clone()) : box.getCenter(new THREE.Vector3()));
    const q = v.box.getWorldQuaternion(new THREE.Quaternion());
    const fwd = v3(0, 0, 1).applyQuaternion(q), right = v3(1, 0, 0).applyQuaternion(q);
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const wide = Math.max(size.x, size.z * 0.6), d = Math.max((size.y * v.fit) / 2 / tan, (wide * v.fit) / 2 / (tan * camera.aspect));
    const dir = fwd.clone().addScaledVector(right, v.side).add(v3(0, v.up, 0)).normalize();
    return { pos: look.clone().addScaledVector(dir, d), look, distance: d, kind: v.kind, object: v.box };
  }

  /**
   * Docs: close enough to read. The camera comes down almost overhead (a little toward the reader, so the pages keep
   * some depth) with the pages upright on screen: the whole spread across a wide screen, the right-hand page alone on
   * a tall one.
   */
  private docsView(camera: THREE.PerspectiveCamera) {
    const g = this.manual.group, { pageW, pageD, gutter } = MANUAL;
    g.updateWorldMatrix(true, false);
    const tall = camera.aspect < 1;
    const centre = g.localToWorld(v3(tall ? gutter + pageW / 2 : 0, 12, 0));
    const q = g.getWorldQuaternion(new THREE.Quaternion());
    const toward = v3(0, 0, 1).applyQuaternion(q), pageUp = v3(0, 0, -1).applyQuaternion(q);
    const tilt = 0.2; // radians off vertical, toward the reader
    const dir = v3(0, 1, 0).multiplyScalar(Math.cos(tilt)).addScaledVector(toward, Math.sin(tilt)).normalize();
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const w = (tall ? pageW : pageW * 2 + gutter * 2) * MM * 1.06, h = pageD * MM * 1.08;
    const d = Math.max(h / 2 / tan, w / 2 / (tan * camera.aspect));
    const up = pageUp.clone().addScaledVector(dir, -pageUp.dot(dir)).normalize();
    return { pos: centre.clone().addScaledVector(dir, d), look: centre, distance: d, kind: 'pour' as const, object: g, up };
  }

  /** A place's click target as a world box (the walkthrough frames overmind's tower by it). */
  hitBox(place: PlaceName) {
    const m = this.hits.children.find((h) => h.userData.place === place);
    return m ? new THREE.Box3().setFromObject(m) : undefined;
  }

  /** The screen rectangle a place occupies (for the dither's current): its bounding box, projected. */
  rect(name: Exclude<PlaceName, 'tower' | 'terminal' | 'room'>, camera: THREE.Camera, w: number, h: number) {
    const box = this.boxOf(this.views[name].box), c = new THREE.Vector3();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      const x = (c.x * 0.5 + 0.5) * w, y = (0.5 - c.y * 0.5) * h;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(w, x1), y1: Math.min(h, y1), kind: this.views[name].kind };
  }
}

/** A clear display plinth (the duplicator stands on one, like an exhibit). */
function plinth(w: number, h: number, d: number, glass: GlassUniforms, t: FloppyKit['textures']) {
  const g = new THREE.Group();
  const clear = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, transparent: true, opacity: 0.12, depthWrite: false });
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 20, d), clear);
  top.position.y = h - 10;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w - 30, h - 20, d - 30), clear);
  body.position.y = (h - 20) / 2;
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w - 30, h - 20, d - 30)), new THREE.LineBasicMaterial({ color: 0x9a9a9a }));
  edge.position.y = (h - 20) / 2;
  g.add(top, body, edge);
  void glass; void t;
  return g;
}
