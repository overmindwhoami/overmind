import * as THREE from 'three';
import { DECAY, DRIFT, MAX_DT, PARALLAX, RATE, REDUCED, SCROLL, SPIN, damp } from '../../design-system/motion';
import { CAMERA, RENDERER } from '../../design-system/scene';
import { Tower, type Instance } from './tower';
import { Station, CLEAN_LAYER, COLOUR_LAYER } from './station';
import { Dirty, DIRTY, type Current } from './dirty';
import { Room, PLACES, type PlaceName } from './room';
import { LABEL_FONTS } from './floppy/labels';
import { Composer } from './composer';
import { Lighting } from './lighting';
import { Resolution } from './resolution';
import { FREE, QUALITY, VERIFY, settings } from './settings';
import { Tracker, type TrackerContent } from '../hud/tracker';
import { clientOf, preload, sourceFor } from '../hud/source';
import { Sound } from '../audio/sound';
import { SimArchive, fmtDisk, fmtTime, type Archive } from '../archive/sim';
import { sourceName } from '../archive/types';
import { BLUR_EVENT, FOCUS_EVENT, READ_EVENT } from '../ui/indexNav';
import { WriteLog } from '../ui/writeLog';

const INTERFACE = 'a, button, .lil-gui';
/** Vertical FOV for an aspect ratio: the design FOV, widened on portrait screens so enough shows horizontally. */
const fovFor = (aspect: number) => Math.max(CAMERA.fov, (2 * Math.atan(Math.tan((CAMERA.minHorizontalFov * Math.PI) / 360) / aspect) * 180) / Math.PI);
const wrapAngle = (a: number) => ((((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
const MACHINE_SATURATION = 0.72; // mild colour, only inside the machine
const FLIGHT = 1.6; // seconds for the camera to fly between places
const INTRO = 3.4; // the first pull back from the live disk to the room
/** The DIRTYPXLS treatment at the places (dirty.ts): off for now, the room shows as it is. */
const DITHER = false;
const ease = (t: number) => t * t * (3 - 2 * t);
const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
export { PLACES };

export class App {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  scene = new THREE.Scene();
  archive: Archive;
  tower: Tower;
  station!: Station;
  room!: Room;
  composer: Composer;
  lighting: Lighting;
  tracker: Tracker;
  sound: Sound;
  log?: WriteLog;
  resolution: Resolution;

  // world state
  cameraHeight = 0;
  cameraHeightTarget = 0;
  spin = 0;
  spinBoost = 0;
  spinVelocity = 0;
  hoverSpin = 1;
  focusSpin = 0;
  focused?: Instance;
  hover?: Instance;
  pressed?: Instance;
  elapsed = 0;
  frame = 0;
  motionScale = 1;
  reduced = false;
  private lastWritten = -1;

  // input state
  pointer = new THREE.Vector2();
  pointerTarget = new THREE.Vector2();
  pressStart = new THREE.Vector2();
  isPointerInside = false;
  isOverInterface = false;
  isTouch = false;
  isDragging = false;
  dragVelocity = 0;
  pressDistance = 0;
  lastMoveTime?: number;

  // reprojection
  private lookAt = new THREE.Vector3();
  private viewProjection = new THREE.Matrix4();
  private viewProjectionInverse = new THREE.Matrix4();
  private previousViewProjection = new THREE.Matrix4();
  private previousTower = new THREE.Matrix4();
  private towerInverse = new THREE.Matrix4();
  private reproject = new THREE.Matrix4();
  private reprojectStatic = new THREE.Matrix4();
  private raycaster = new THREE.Raycaster();
  private rayOrigin = new THREE.Vector3();
  private rayDirection = new THREE.Vector3();
  private previousTime = 0;
  private maskMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // red: may keep colour (green is 'stays clean')
  private cleanMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 0) });
  /** The DIRTYPXLS treatment for the places in the room (dirty.ts). */
  readonly dirty = new Dirty();
  private dirtyPixel = 3;
  private current?: Current;
  private corner = new THREE.Vector3();
  private readerFocus = 0;
  /** The place the camera is at (or flying to): the page opens on the whole room; `tower` is the lineage up close. */
  place: PlaceName = 'tower';
  private flightT = 1;
  private flightFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), focus: 0 };
  private placeFocus = 0;
  private placeBlend = 0;
  private flightDur = FLIGHT;
  /** Dragging in the room view swings the camera round the room. */
  private roomYaw = 0;
  private roomYawTarget = 0;
  private tags = new Map<PlaceName, HTMLButtonElement>();
  private touchFirst = window.matchMedia('(hover: none)').matches;
  /** In the room view: the place under the pointer. */
  private roomHover?: PlaceName;
  private roomLabel = document.querySelector<HTMLElement>('[data-room-label]');
  private dom = {
    link: document.querySelector<HTMLAnchorElement>('[data-reader-link]'),
    eject: document.querySelector<HTMLButtonElement>('[data-eject]'),
    announce: document.querySelector<HTMLElement>('[data-announce]'),
  };

  constructor(archive: Archive = new SimArchive()) {
    this.archive = archive;
    this.resolution = new Resolution(settings.pixelRatio, RENDERER.pixelRatio.min, RENDERER.pixelRatio.start);
    this.renderer = new THREE.WebGLRenderer({ antialias: RENDERER.antialias, powerPreference: RENDERER.powerPreference, stencil: RENDERER.stencil });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.info.autoReset = false;
    if (!this.renderer.capabilities.isWebGL2 || !this.renderer.extensions.has('EXT_color_buffer_float')) throw new Error('WebGL 2 with EXT_color_buffer_float is required.');
    const canvas = this.renderer.domElement;
    canvas.classList.add('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(fovFor(window.innerWidth / window.innerHeight), window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far + 70); // the room reaches further than the tower
    this.lighting = new Lighting(this.renderer, this.scene);
    performance.mark('tower:start');
    this.tower = new Tower(this.archive, this.renderer, QUALITY === 'low');
    performance.mark('tower:end');
    this.scene.add(this.tower.group);
    this.composer = new Composer(this.renderer);
    this.sound = new Sound(document.querySelector<HTMLButtonElement>('[data-sound]'));
    this.tracker = new Tracker({ onLock: this.sound.lock, onTick: this.sound.tick, reduced: () => this.reduced });
    const logRoot = document.querySelector<HTMLElement>('[data-log]');
    if (logRoot) this.log = new WriteLog(logRoot, this.archive, () => this.reduced);

    this.resizeDirty();
    // Land on the live disk, at the top of the lineage.
    this.cameraHeight = this.cameraHeightTarget = this.tower.range.max - 0.1;

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = (on: boolean) => { this.reduced = on; this.motionScale = on ? REDUCED.continuousScale : 1; };
    apply(query.matches);
    query.addEventListener('change', (e) => apply(e.matches));
    this.listen();
    if (VERIFY) Object.assign(window, { __overmind: this, __THREE: THREE }); // verification harness only
  }

  private pixelRatio() { return settings.adaptiveResolution ? this.resolution.ratio : settings.pixelRatio; }

  /**
   * Loads in stages so the loader keeps moving: the archive and the fonts start at once; the computer and the room
   * are built one object at a time, a frame apart (`overmind:progress` events report each stage).
   */
  async load() {
    const progress = (p: number, step: string) => window.dispatchEvent(new CustomEvent('overmind:progress', { detail: { p, step } }));
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    progress(0.06, 'Waking the archivist');
    const data = this.archive.load();
    // canvas text needs the faces loaded explicitly: fonts used only in canvases never start loading by themselves
    const fonts = Promise.all([document.fonts.ready, ...LABEL_FONTS.map((f) => document.fonts.load(f).catch(() => []))]);
    await frame();
    progress(0.2, 'Building the computer');
    await frame();
    this.station = new Station(this.tower.kit, this.tower.glassUniforms, this.archive);
    this.scene.add(this.station.root);
    await fonts; // the board's flaps and the screens print with them
    progress(0.36, 'Furnishing the room');
    await frame();
    this.room = new Room();
    let built = 0;
    await this.room.build(this.tower.kit, this.tower.glassUniforms, async () => { progress(0.36 + (++built / 8) * 0.4, 'Furnishing the room'); await frame(); });
    this.scene.add(this.room.root);
    this.room.proxies.traverse((o) => o.layers.set(COLOUR_LAYER));
    this.room.clean(this.place, CLEAN_LAYER);
    progress(0.8, 'Reading the lineage');
    await data;
    // a remote archive only knows the lineage now: take it as it is (no seal animation) and land on the live disk
    this.tower.resync();
    this.cameraHeight = this.cameraHeightTarget = this.tower.range.max - 0.1;
    for (const t of this.tower.textures) this.renderer.initTexture(t);
    this.update(0);
    progress(0.88, 'Turning on the lights');
    await frame();
    performance.mark('compile:start');
    await this.renderer.compileAsync(this.scene, this.camera);
    performance.mark('upload:start');
    performance.mark('render:start');
    this.render();
    performance.mark('render:end');
    progress(1, 'Ready');
    this.ready = true;
    requestAnimationFrame((t) => {
      this.previousTime = t;
      document.documentElement.classList.add('is-ready');
      // the reveal: from the live disk being written, the camera pulls back to show the whole room
      if (this.place === 'tower') this.go('room', this.reduced ? 0.01 : INTRO);
      requestAnimationFrame(this.loop);
    });
  }
  private ready = false;

  private loop = (t: number) => {
    const dt = Math.min((t - this.previousTime) / 1000, MAX_DT);
    this.previousTime = t;
    if (settings.adaptiveResolution && this.resolution.update(dt, settings.frameRate)) this.resize();
    this.update(dt);
    this.render(dt);
    requestAnimationFrame(this.loop);
  };

  update(dt: number) {
    this.elapsed += dt;
    const t = this.elapsed, m = this.motionScale;
    this.spinBoost *= Math.exp(-dt * DECAY.inertia);
    if (this.isDragging) this.dragVelocity *= Math.exp(-dt * DECAY.dragHold);
    this.hoverSpin += ((this.hover ? SPIN.attention : 1) - this.hoverSpin) * damp(RATE.mechanism, dt);
    const ambient = settings.spin * m * this.hoverSpin;
    if (this.focused) {
      const step = (this.focusSpin - this.spin) * damp(RATE.mechanism, dt);
      this.spin += step;
      this.spinVelocity = dt > 0 ? step / dt : 0;
      this.spinBoost = 0;
    } else {
      this.spinVelocity = this.isDragging ? this.dragVelocity : ambient + this.spinBoost;
      if (!this.isDragging) this.spin += this.spinVelocity * dt;
    }
    this.tower.group.rotation.y = this.spin;

    // the lineage is finite: from genesis up to the live disk, with a soft stop at both ends
    const { min, max } = this.tower.range;
    if (!FREE) {
      const clamped = Math.min(max, Math.max(min - 0.3, this.cameraHeightTarget));
      this.cameraHeightTarget += (clamped - this.cameraHeightTarget) * damp(RATE.mechanism, dt);
    }
    this.cameraHeight += (this.cameraHeightTarget - this.cameraHeight) * damp(this.reduced ? REDUCED.cameraRate : RATE.world, dt);
    this.pointer.lerp(this.pointerTarget, damp(RATE.world, dt));

    const par = settings.parallax * m * (1 - this.station.blend);
    const a = this.cameraHeight + Math.sin(t * DRIFT.heightFreq) * DRIFT.heightAmp * m;
    this.camera.position.set(
      Math.sin(t * DRIFT.xFreq) * DRIFT.xAmp * m + this.pointer.x * PARALLAX.cameraX * par,
      a + CAMERA.heightOffset + this.pointer.y * PARALLAX.cameraY * par,
      CAMERA.distance + Math.sin(t * DRIFT.zFreq) * DRIFT.zAmp * (this.reduced ? 0 : 1),
    );
    this.lookAt.set(CAMERA.lookX, a + CAMERA.lookOffset, 0);
    this.camera.up.set(Math.sin(CAMERA.roll), Math.cos(CAMERA.roll), 0);
    // the room sits under the top of the lineage; the computer stands on its desk
    const qday = Date.parse(this.archive.watch?.()?.qday?.estimate ?? '2032-01-01T00:00:00Z');
    this.room.update(dt, this.tower.range.max - 0.1, this.tower.range.min - 0.05, this.archive.now(), qday, this.camera.aspect < 1);
    this.room.root.updateMatrixWorld(true);
    this.station.placeAt(this.room.pcAnchor);
    // reading: the camera goes to the machine's screen
    const b = this.station.blend * this.station.blend * (3 - 2 * this.station.blend);
    if (b > 0) {
      const r = this.station.readerCamera(this.camera);
      this.camera.position.lerp(r.pos, b);
      this.lookAt.lerp(r.look, b);
      this.camera.up.lerp(new THREE.Vector3(0, 1, 0), b).normalize();
      this.readerFocus = r.distance;
    }
    this.fly(dt);
    this.camera.lookAt(this.lookAt);
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();

    const band = Math.tan((this.camera.fov * Math.PI) / 360) * 3.3 + 0.7;
    this.tower.cull(a - band - this.placeBlend * 14, a + band); // from the room, more of the tower shows
    this.lighting.update(this.pointer, this.scene, settings);
    const towerInv = this.towerInverse.copy(this.tower.group.matrixWorld).invert();
    const lifted = this.station.update(dt, (n) => this.tower.worldMatrix({ slab: this.tower.slab(n), offset: 0 }, new THREE.Matrix4()));
    this.tower.lifted = lifted || this.station.reading ? this.station.disk : undefined;
    this.tower.update(dt, a, settings, lifted ? { matrix: lifted.matrix.clone().premultiply(towerInv), open: lifted.open } : undefined);

    // the instrument: only on what the pointer is over (or the last tap); the write log says what is being written
    const cur = this.archive.current();
    if (cur.written !== this.lastWritten) {
      this.lastWritten = cur.written;
      // stream ahead: the item about to be written, then the cover of every disk in view
      if (cur.written < 90) preload(sourceFor(this.archive.slot(cur.disk, cur.written).item));
      for (const inst of this.tower.instances) preload(this.contentFor(inst).source);
    }
    this.roomHover = this.place === 'room' && this.flightT >= 1 && this.isPointerInside && !this.isOverInterface && !this.isTouch ? this.roomPick() : undefined;
    this.updateRoomLabel();
    this.updateTags();
    if (this.station.reading || this.place !== 'tower' || this.flightT < 1) this.hover = undefined;
    else if (this.focused) this.hover = this.focused;
    else {
      const picked = !this.isTouch && this.isPointerInside && !this.isOverInterface && this.pressDistance < SCROLL.tapSlop ? this.pick() : undefined;
      this.hover = picked ?? (this.isTouch ? this.hover : undefined);
    }
    document.documentElement.classList.toggle('is-live-view', Math.abs(this.tower.live.y - a) < band * 0.5);
    // arriving at a place: the picture dissolves into the DIRTYPXLS treatment over the last part of the flight
    const arrive = this.station.reading ? Math.min(1, Math.max(0, (this.station.blend - 0.72) / 0.28)) : 0;
    const atPlace = this.place !== 'tower' && this.place !== 'room' ? smooth((this.flightT - 0.72) / 0.28) : 0;
    this.dirty.amount = DITHER ? Math.max(arrive * arrive * (3 - 2 * arrive), atPlace) : 0;
    this.current = this.dirty.amount <= 0 ? undefined : this.station.reading || this.place === 'terminal' ? this.computerCurrent() : this.placeCurrent();
    this.log?.update(dt);
    document.documentElement.classList.toggle('is-hovering', !!this.hover);
    document.documentElement.classList.toggle('is-reading', this.station.reading);
    document.documentElement.dataset.place = this.place;
    if (this.hover) this.tracker.select(this.hover, this.contentFor(this.hover));
    this.updateReaderDom();
    this.sound.update(dt, this.spinVelocity / SPIN.idle, settings.volume);
  }

  /**
   * What the instrument shows for a disk, in the reference's terms (name · client · year · host, one media source):
   * the live disk shows the item just written; a sealed disk shows its cover item,
   * the last thing on it with moving pictures, else with a picture, else its last entry.
   */
  contentFor(inst: Instance): TrackerContent {
    const n = inst.slab.index, d = this.archive.disk(n);
    const slots = this.archive.written(n);
    const slot = d.sealed
      ? [...slots].reverse().find((s) => s.item?.clip) ?? [...slots].reverse().find((s) => s.item?.media) ?? slots[slots.length - 1]
      : slots[slots.length - 1];
    const item = slot?.item;
    return {
      key: d.sealed ? `disk-${n}-${slots.length}` : `live-${n}-${d.written}`, // a remote disk's slots may arrive after the first look
      name: item?.title ?? (slot ? 'Nothing came through' : `${fmtDisk(n)}`),
      client: slot ? clientOf(item) : 'Blank disk, waiting for the first slot',
      year: item?.year ? String(item.year) : slot ? fmtTime(slot.time) : 'now',
      host: slot ? hostOf(item?.url) : 'live', // a blank disk isn't offline: it's about to be written
      url: item?.url,
      source: slot ? sourceFor(item) : sourceFor(undefined, { key: `blank-${n}`, name: fmtDisk(n), client: 'Blank · writing begins' }),
    };
  }

  render(dt = 1 / 60) {
    const tw = this.tower.group.matrixWorld;
    this.renderer.info.reset();
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.viewProjectionInverse.multiplyMatrices(this.camera.matrixWorld, this.camera.projectionMatrixInverse);
    this.towerInverse.copy(tw).invert();
    if (this.frame === 0) { this.previousTower.copy(tw); this.previousViewProjection.copy(this.viewProjection); }
    this.reproject.copy(this.previousViewProjection).multiply(this.previousTower).multiply(this.towerInverse).multiply(this.viewProjectionInverse);
    this.reprojectStatic.copy(this.previousViewProjection).multiply(this.viewProjectionInverse);
    this.renderer.setRenderTarget(this.composer.scene);
    this.renderer.render(this.scene, this.camera);
    this.renderMask();
    this.dirty.update(this.reduced ? 0 : dt, this.current, this.renderer);
    const breathe = this.reduced ? 0 : Math.sin(this.elapsed * DRIFT.focusFreq) * DRIFT.focusAmp;
    const b = this.station.blend;
    this.composer.render({
      dt,
      focus: ((DRIFT.focusBase + settings.focus + breathe) * (1 - b) + this.readerFocus * b) * (1 - this.placeBlend) + this.placeFocus * this.placeBlend,
      frame: this.frame,
      time: this.elapsed,
      projectionInverse: this.camera.projectionMatrixInverse,
      reproject: this.reproject,
      reprojectStatic: this.reprojectStatic,
      settings: { ...settings, shutter: this.reduced && !REDUCED.motionBlur ? 0 : settings.shutter, machineSaturation: MACHINE_SATURATION },
      dirty: { amount: this.dirty.amount, pixel: this.dirtyPixel, strands: this.dirty.target.texture, ink: DIRTY.ink, accent: DIRTY.accent },
    });
    const cursor = this.isDragging && this.pressDistance >= SCROLL.tapSlop ? 'drag' : this.hover || this.readerHover || this.roomHover ? 'hover' : 'idle';
    this.tracker.update({
      camera: this.camera, cursor, dt, focused: !!this.focused, hovering: !!this.hover,
      matrixOf: (i, out) => this.tower.worldMatrix(i, out),
      pointer: this.isPointerInside && !this.isTouch && !this.isOverInterface
        ? { x: ((this.pointerTarget.x + 1) / 2) * window.innerWidth, y: ((1 - this.pointerTarget.y) / 2) * window.innerHeight }
        : undefined,
    });
    this.previousTower.copy(tw);
    this.previousViewProjection.copy(this.viewProjection);
    this.frame++;
  }

  /** Half-resolution coverage of the machine: the composer keeps mild colour there and nowhere else. */
  private renderMask() {
    const r = this.renderer, bg = this.scene.background;
    r.setRenderTarget(this.composer.mask);
    this.scene.background = null;
    r.setClearColor(0x000000, 1);
    r.clear();
    this.scene.overrideMaterial = this.maskMaterial;
    this.camera.layers.set(COLOUR_LAYER);
    r.render(this.scene, this.camera);
    // readable screens: green (and red, they're part of the machine), drawn over the silhouette without clearing it
    if (this.dirty.amount > 0) {
      const auto = r.autoClear;
      r.autoClear = false;
      r.clearDepth();
      this.scene.overrideMaterial = this.cleanMaterial;
      this.camera.layers.set(CLEAN_LAYER);
      r.render(this.scene, this.camera);
      r.autoClear = auto;
    }
    this.camera.layers.set(0);
    this.scene.overrideMaterial = null;
    this.scene.background = bg;
  }

  /** The computer as a place: marks are born around its screen and rise off it; the red pixel sits by the drive. */
  private computerCurrent(): Current | undefined {
    const mesh = this.station.pc.screenMesh;
    if (!mesh) return undefined;
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox!, { w, h } = this.dirty.size;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      this.corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(mesh.matrixWorld).project(this.camera);
      const x = (this.corner.x * 0.5 + 0.5) * w, y = (0.5 - this.corner.y * 0.5) * h;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { rect: { x0, y0, x1, y1 }, kind: 'rise', live: { x: x1 - 6, y: y1 + 6 } };
  }

  /** Fly to a place in the room (or home to the tower). Reading a disk ends first. */
  go(name: PlaceName, duration = FLIGHT) {
    if (name === this.place) return;
    this.flightDur = duration;
    if (this.isTouch && this.ready) navigator.vibrate?.(8); // a light tick on phones that have it
    if (this.station.reading) this.station.eject();
    this.focused = undefined;
    this.flightFrom.pos.copy(this.camera.position);
    this.flightFrom.look.copy(this.lookAt);
    this.flightFrom.up.copy(this.camera.up);
    this.flightFrom.focus = this.place === 'tower' ? DRIFT.focusBase + settings.focus : this.placeFocus;
    this.place = name;
    this.flightT = 0;
    this.room.clean(name, CLEAN_LAYER);
    window.dispatchEvent(new Event('placechange')); // the menu marks where the camera is going
    const label = PLACES.find((p) => p.name === name)?.label;
    this.announce(name === 'room' ? 'The room.' : name === 'tower' ? 'The tower: the lineage, newest disk on top.' : `${label}.`);
    if (window.location.hash.slice(1) !== (name === 'room' ? '' : name)) history.replaceState(null, '', name === 'room' ? window.location.pathname + window.location.search : `#${name}`);
  }

  /** The camera's flight: from where it was to the place's pose, along a shallow arc (home is a moving target). */
  private fly(dt: number) {
    if (this.place === 'tower' && this.flightT >= 1) { this.placeBlend = 0; return; }
    this.flightT = Math.min(1, this.flightT + dt / (this.reduced ? 0.01 : this.flightDur));
    this.roomYaw += (this.roomYawTarget - this.roomYaw) * (1 - Math.exp(-dt * 5));
    const e = ease(this.flightT);
    let pos: THREE.Vector3, look: THREE.Vector3, up = new THREE.Vector3(0, 1, 0), focus: number;
    if (this.place === 'tower') { pos = this.camera.position.clone(); look = this.lookAt.clone(); up = this.camera.up.clone(); focus = DRIFT.focusBase + settings.focus; }
    else if (this.place === 'terminal') { const r = this.station.readerCamera(this.camera); pos = r.pos; look = r.look; focus = r.distance; }
    else { const v = this.room.view(this.place, this.camera, this.place === 'room' ? this.roomYaw : 0); pos = v.pos; look = v.look; focus = v.distance; }
    if (this.place === 'room') pos.add(new THREE.Vector3(this.pointer.x * 0.9, this.pointer.y * 0.45, 0)); // a little parallax over the room
    const from = this.flightFrom, lift = from.pos.distanceTo(pos) * 0.12;
    this.camera.position.copy(from.pos).lerp(pos, e);
    this.camera.position.y += Math.sin(Math.PI * e) * lift;
    this.lookAt.copy(from.look).lerp(look, e);
    this.camera.up.copy(from.up).lerp(up, e).normalize();
    this.placeFocus = from.focus + (focus - from.focus) * e;
    this.placeBlend = this.place === 'tower' ? 1 - e : 1;
  }

  /** The place under the pointer in the room view (the tower, or an object with a place). */
  private roomPick(): PlaceName | undefined {
    this.raycaster.setFromCamera(this.pointerTarget, this.camera);
    return this.room.pick(this.raycaster);
  }
  /** Name tags over the room's places on touch screens (there is no hover to name them); tapping one goes there. */
  private updateTags() {
    const show = this.touchFirst && this.place === 'room' && this.flightT > 0.85;
    document.documentElement.classList.toggle('show-tags', show);
    if (!show) return;
    const root = document.querySelector<HTMLElement>('[data-room-tags]');
    if (!root) return;
    const v = new THREE.Vector3();
    for (const a of this.room.anchors()) {
      let el = this.tags.get(a.place);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'tag';
        el.textContent = a.place === 'tower' ? 'the tower' : PLACES.find((p) => p.name === a.place)?.label ?? a.place;
        const place = a.place;
        el.addEventListener('click', () => this.go(place));
        root.appendChild(el);
        this.tags.set(a.place, el);
      }
      v.copy(a.pos).project(this.camera);
      // a place off the side of the screen keeps its tag, pinned to that edge with an arrow (drag to bring it in)
      const side = v.x < -1 ? -1 : v.x > 1 ? 1 : 0, W = window.innerWidth;
      el.style.visibility = v.z > 1 || Math.abs(v.y) > 1.05 ? 'hidden' : 'visible';
      el.classList.toggle('tag--left', side < 0);
      el.classList.toggle('tag--right', side > 0);
      const half = el.offsetWidth / 2 + 10;
      const x = side ? (side < 0 ? 12 : W - 12) : Math.min(W - half, Math.max(half, (v.x * 0.5 + 0.5) * W));
      el.style.transform = `translate(${side < 0 ? '0' : side > 0 ? '-100%' : '-50%'}, -100%) translate(${x}px, ${(-v.y * 0.5 + 0.5) * window.innerHeight - 6}px)`;
    }
  }
  private updateRoomLabel() {
    const el = this.roomLabel;
    if (!el) return;
    el.hidden = !this.roomHover;
    if (!this.roomHover) return;
    const name = this.roomHover === 'tower' ? 'the tower' : PLACES.find((p) => p.name === this.roomHover)?.label ?? '';
    if (el.textContent !== name) el.textContent = name;
    el.style.transform = `translate(${((this.pointerTarget.x + 1) / 2) * window.innerWidth + 18}px, ${((1 - this.pointerTarget.y) / 2) * window.innerHeight + 14}px)`;
  }

  /** A room place as the dither's current: marks born round the object's outline; the red pixel at its lower right. */
  private placeCurrent(): Current | undefined {
    if (this.place === 'tower' || this.place === 'terminal' || this.place === 'room') return undefined;
    const { w, h } = this.dirty.size, r = this.room.rect(this.place, this.camera, w, h);
    return { rect: r, kind: r.kind, live: { x: r.x1 - 8, y: r.y1 - 8 } };
  }

  private resizeDirty() {
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.dirtyPixel = this.dirty.resize(s.x, s.y, this.renderer.getPixelRatio());
  }

  pick() {
    this.raycaster.setFromCamera(this.pointerTarget, this.camera);
    this.towerInverse.copy(this.tower.group.matrixWorld).invert();
    this.rayOrigin.copy(this.raycaster.ray.origin).applyMatrix4(this.towerInverse);
    this.rayDirection.copy(this.raycaster.ray.direction).transformDirection(this.towerInverse);
    return this.tower.pick(this.rayOrigin, this.rayDirection);
  }

  /** Fly to a disk and turn it to face the camera (keyboard index focus). */
  focus(n: number) {
    if (!this.ready) return;
    if (this.place !== 'tower') this.go('tower');
    const slab = this.tower.slab(n);
    if (!slab) return;
    const { x, z } = slab.box.center;
    this.focused = { slab, offset: 0 };
    this.focusSpin = this.spin + wrapAngle(-Math.atan2(x, z) - this.spin);
    this.cameraHeightTarget = slab.y;
  }
  blur() { this.focused = undefined; }

  /** Lift a disk out of the stack and read it in the machine. */
  read(n: number) {
    if (!this.ready || this.station.reading || n > this.tower.count) return;
    if (this.place !== 'tower') this.go('tower');
    const slab = this.tower.slab(n);
    this.focused = undefined;
    this.station.insert(n, this.tower.worldMatrix({ slab, offset: 0 }, new THREE.Matrix4()));
    this.tower.lifted = n;
    this.sound.select(Math.max(-1, Math.min(1, (slab.box.center.x / 0.8) * 0.5)));
    this.announce(`${fmtDisk(n)} is in the drive.`);
  }

  private readerHover = false;
  private lastSelection = '';
  private updateReaderDom() {
    const s = this.station.view === 'entry' ? this.station.selection() : undefined;
    // reading a sealed disk's directory: the link goes to its seal on chain (live archive only)
    const seal = this.station.reading && this.station.view === 'dir' && this.station.disk !== undefined ? this.archive.disk(this.station.disk).chain?.url : undefined;
    const key = s ? `${s.disk}-${s.index}` : seal ?? '';
    if (key !== this.lastSelection) {
      this.lastSelection = key;
      const { link } = this.dom;
      if (link) {
        link.hidden = !s?.item && !seal;
        if (s?.item) {
          link.href = s.item.url;
          link.textContent = `Open on ${sourceName(s.item)} ↗`; // a web page is named by its site
        } else if (seal) {
          link.href = seal;
          link.textContent = 'Seal on Solana ↗';
        }
      }
      if (s) this.announce(`${s.item?.title ?? 'Nothing came through'}. ${s.note}`);
    }
    if (this.dom.eject) this.dom.eject.hidden = !this.station.open;
  }
  private announce(text: string) { if (this.dom.announce) this.dom.announce.textContent = text; }

  private listen() {
    document.documentElement.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener(FOCUS_EVENT, ((e: CustomEvent<number>) => this.focus(e.detail)) as EventListener);
    window.addEventListener(READ_EVENT, ((e: CustomEvent<number>) => this.read(e.detail)) as EventListener);
    window.addEventListener(BLUR_EVENT, () => this.blur());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('resize', this.resize);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    this.dom.eject?.addEventListener('click', () => this.station.eject());
  }

  onWheel = (e: { deltaY: number }) => {
    if (!this.ready) return;
    if (this.station.reading) { this.station.wheel(e.deltaY); return; }
    if (this.place === 'room' && e.deltaY > 0) { this.go('tower'); return; }
    if (this.place !== 'tower' || this.flightT < 1) return; // no scrolling the lineage mid-flight
    this.cameraHeightTarget -= e.deltaY * SCROLL.wheelUnitsPerPx;
  };

  onKeyDown = (e: { key: string; preventDefault?: () => void }) => {
    if (!this.ready) return;
    if (e.key === 'm' || e.key === 'M') { this.sound.toggle(!this.sound.enabled); return; }
    if (this.station.reading) { if (this.station.key(e.key)) e.preventDefault?.(); return; }
    if (this.place !== 'tower') { if (e.key === 'Escape' && this.place !== 'room') this.go('room'); return; }
    if (e.key === 'Enter' && this.focused) { this.read(this.focused.slab.index); return; }
    if (e.key === 'Escape' && this.focused && !(document.activeElement instanceof HTMLAnchorElement)) { this.blur(); return; }
    if (e.key === 'Escape') { this.go('room'); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') this.spinBoost += e.key === 'ArrowLeft' ? -SPIN.keyBoost : SPIN.keyBoost;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') this.cameraHeightTarget += e.key === 'ArrowUp' ? SCROLL.keyStep : -SCROLL.keyStep;
  };

  onPointerDown = (e: { clientX: number; clientY: number; pointerType: string; target: EventTarget | null; timeStamp: number; type: string }) => {
    if (!this.ready) return;
    if (e.target instanceof Element && e.target.closest(INTERFACE)) return;
    this.isTouch = e.pointerType !== 'mouse';
    this.pressDistance = 0;
    this.pressed = this.hover;
    this.onPointerMove(e);
    this.isDragging = true;
    this.dragVelocity = this.spinVelocity;
    this.pressStart.set(e.clientX, e.clientY);
    document.documentElement.classList.add('is-dragging');
  };

  onPointerMove = (e: { clientX: number; clientY: number; pointerType: string; target: EventTarget | null; timeStamp: number }) => {
    this.isPointerInside = true;
    this.isTouch = e.pointerType !== 'mouse';
    this.isOverInterface = e.target instanceof Element && !!e.target.closest(INTERFACE);
    this.pointerTarget.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
    if (this.station.open && !this.isTouch) {
      this.raycaster.setFromCamera(this.pointerTarget, this.camera);
      this.readerHover = !!this.station.hitAt(this.raycaster);
    } else this.readerHover = false;
    if (!this.ready || !this.isDragging || this.station.reading) return;
    const dx = e.clientX - this.pressStart.x, dy = e.clientY - this.pressStart.y;
    this.pressDistance += Math.hypot(dx, dy);
    if (this.place === 'room') { // look round the room
      const range = this.camera.aspect < 1 ? 0.95 : 0.6;
      this.roomYawTarget = Math.max(-range, Math.min(range, this.roomYawTarget - (dx / window.innerWidth) * 1.8));
      this.pressStart.set(e.clientX, e.clientY);
      return;
    }
    if (this.place !== 'tower') return;
    const turn = (dx / window.innerWidth) * SCROLL.dragTurnPerViewport;
    const step = Math.max(e.timeStamp - (this.lastMoveTime ?? e.timeStamp), 8) / 1000;
    this.spin += turn;
    this.dragVelocity += (turn / step - this.dragVelocity) * SCROLL.dragVelocityBlend;
    this.cameraHeightTarget += (dy / window.innerHeight) * SCROLL.dragUnitsPerViewport;
    this.pressStart.set(e.clientX, e.clientY);
    this.lastMoveTime = e.timeStamp;
  };

  onPointerUp = (e: { type: string; clientX?: number; clientY?: number }) => {
    if (!this.isDragging) return;
    if (e.type === 'pointerup' && this.pressDistance < SCROLL.tapSlop) this.onTap();
    this.pressDistance = 0;
    this.isDragging = false;
    if (!this.station.reading) this.spinBoost = this.dragVelocity - settings.spin * this.motionScale;
    this.lastMoveTime = undefined;
    document.documentElement.classList.remove('is-dragging');
  };

  private onTap() {
    if (this.place === 'room') { const p = this.roomPick(); if (p) this.go(p); return; }
    if (this.place !== 'tower') return;
    if (this.station.reading) {
      if (!this.station.open) return;
      this.raycaster.setFromCamera(this.pointerTarget, this.camera);
      const hit = this.station.hitAt(this.raycaster);
      if (hit) this.station.act(hit);
      else if (!this.station.touches(this.raycaster)) this.station.eject();
      return;
    }
    const target = this.isTouch ? this.pick() : this.hover;
    if (this.isTouch && target?.slab !== this.hover?.slab) { this.hover = target; return; }
    if (target && (this.isTouch || target.slab === this.pressed?.slab)) this.read(target.slab.index);
    else if (this.focused) this.blur();
  }

  onPointerLeave = () => { this.isPointerInside = false; this.pointerTarget.set(0, 0); };

  resize = () => {
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.fov = fovFor(this.camera.aspect);
    this.camera.updateProjectionMatrix();
    this.composer.resize();
    this.resizeDirty();
    this.tracker.resize();
  };
}

/** The reference's host label: the site, without www; Wayback links read `site (archived YYYY)`. */
function hostOf(url?: string) {
  if (!url) return 'Offline';
  const w = url.match(/web\.archive\.org\/web\/(\d{4})\d*\/(https?:\/\/.+)$/);
  try { return w?.[1] && w[2] ? `${new URL(w[2]).host.replace(/^www\./, '')} (archived ${w[1]})` : new URL(url).host.replace(/^www\./, ''); } catch { return 'Offline'; }
}
