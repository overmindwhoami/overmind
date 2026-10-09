import * as THREE from 'three';
import { DECAY, DRIFT, MAX_DT, PARALLAX, RATE, REDUCED, SCROLL, SPIN, damp } from '../../design-system/motion';
import { CAMERA, RENDERER } from '../../design-system/scene';
import { Tower, type Instance } from './tower';
import { Station, COLOUR_LAYER } from './station';
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

export class App {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  scene = new THREE.Scene();
  archive: Archive;
  tower: Tower;
  station: Station;
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
  private maskMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readerFocus = 0;
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

    this.camera = new THREE.PerspectiveCamera(fovFor(window.innerWidth / window.innerHeight), window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far + 20);
    this.lighting = new Lighting(this.renderer, this.scene);
    performance.mark('tower:start');
    this.tower = new Tower(this.archive, this.renderer, QUALITY === 'low');
    performance.mark('tower:end');
    this.scene.add(this.tower.group);
    this.station = new Station(this.tower.kit, this.tower.glassUniforms, this.archive);
    this.scene.add(this.station.root);
    this.composer = new Composer(this.renderer);
    this.sound = new Sound(document.querySelector<HTMLButtonElement>('[data-sound]'));
    this.tracker = new Tracker({ onLock: this.sound.lock, onTick: this.sound.tick, reduced: () => this.reduced });
    const logRoot = document.querySelector<HTMLElement>('[data-log]');
    if (logRoot) this.log = new WriteLog(logRoot, this.archive, () => this.reduced);

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

  async load() {
    // canvas text needs the faces loaded explicitly: fonts used only in canvases never start loading by themselves
    await Promise.all([this.archive.load(), document.fonts.ready, ...LABEL_FONTS.map((f) => document.fonts.load(f).catch(() => []))]);
    // a remote archive only knows the lineage now: take it as it is (no seal animation) and land on the live disk
    this.tower.resync();
    this.cameraHeight = this.cameraHeightTarget = this.tower.range.max - 0.1;
    for (const t of this.tower.textures) this.renderer.initTexture(t);
    this.update(0);
    performance.mark('compile:start');
    await this.renderer.compileAsync(this.scene, this.camera);
    performance.mark('upload:start');
    performance.mark('render:start');
    this.render();
    performance.mark('render:end');
    requestAnimationFrame((t) => {
      this.previousTime = t;
      document.documentElement.classList.add('is-ready');
      requestAnimationFrame(this.loop);
    });
  }

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
    // reading: the camera goes to the machine's screen
    this.station.place(this.cameraHeight, this.camera.aspect);
    const b = this.station.blend * this.station.blend * (3 - 2 * this.station.blend);
    if (b > 0) {
      const r = this.station.readerCamera(this.camera);
      this.camera.position.lerp(r.pos, b);
      this.lookAt.lerp(r.look, b);
      this.camera.up.lerp(new THREE.Vector3(0, 1, 0), b).normalize();
      this.readerFocus = r.distance;
    }
    this.camera.lookAt(this.lookAt);
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();

    const band = Math.tan((this.camera.fov * Math.PI) / 360) * 3.3 + 0.7;
    this.tower.cull(a - band, a + band);
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
    if (this.station.reading) this.hover = undefined;
    else if (this.focused) this.hover = this.focused;
    else {
      const picked = !this.isTouch && this.isPointerInside && !this.isOverInterface && this.pressDistance < SCROLL.tapSlop ? this.pick() : undefined;
      this.hover = picked ?? (this.isTouch ? this.hover : undefined);
    }
    document.documentElement.classList.toggle('is-live-view', Math.abs(this.tower.live.y - a) < band * 0.5);
    this.log?.update(dt);
    document.documentElement.classList.toggle('is-hovering', !!this.hover);
    document.documentElement.classList.toggle('is-reading', this.station.reading);
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
      host: hostOf(item?.url),
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
    const breathe = this.reduced ? 0 : Math.sin(this.elapsed * DRIFT.focusFreq) * DRIFT.focusAmp;
    const b = this.station.blend;
    this.composer.render({
      dt,
      focus: (DRIFT.focusBase + settings.focus + breathe) * (1 - b) + this.readerFocus * b,
      frame: this.frame,
      time: this.elapsed,
      projectionInverse: this.camera.projectionMatrixInverse,
      reproject: this.reproject,
      reprojectStatic: this.reprojectStatic,
      settings: { ...settings, shutter: this.reduced && !REDUCED.motionBlur ? 0 : settings.shutter, machineSaturation: MACHINE_SATURATION },
    });
    const cursor = this.isDragging && this.pressDistance >= SCROLL.tapSlop ? 'drag' : this.hover || this.readerHover ? 'hover' : 'idle';
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
    this.camera.layers.set(0);
    this.scene.overrideMaterial = null;
    this.scene.background = bg;
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
    if (this.station.reading || n > this.tower.count) return;
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
          link.textContent = `Open on ${sourceName(s.item)} ↗`;
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
    if (this.station.reading) { this.station.wheel(e.deltaY); return; }
    this.cameraHeightTarget -= e.deltaY * SCROLL.wheelUnitsPerPx;
  };

  onKeyDown = (e: { key: string; preventDefault?: () => void }) => {
    if (e.key === 'm' || e.key === 'M') { this.sound.toggle(!this.sound.enabled); return; }
    if (this.station.reading) { if (this.station.key(e.key)) e.preventDefault?.(); return; }
    if (e.key === 'Enter' && this.focused) { this.read(this.focused.slab.index); return; }
    if (e.key === 'Escape' && this.focused && !(document.activeElement instanceof HTMLAnchorElement)) { this.blur(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') this.spinBoost += e.key === 'ArrowLeft' ? -SPIN.keyBoost : SPIN.keyBoost;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') this.cameraHeightTarget += e.key === 'ArrowUp' ? SCROLL.keyStep : -SCROLL.keyStep;
  };

  onPointerDown = (e: { clientX: number; clientY: number; pointerType: string; target: EventTarget | null; timeStamp: number; type: string }) => {
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
    if (!this.isDragging || this.station.reading) return;
    const dx = e.clientX - this.pressStart.x, dy = e.clientY - this.pressStart.y;
    this.pressDistance += Math.hypot(dx, dy);
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
    this.tracker.resize();
  };
}

/** The reference's host label: the site, without www; Wayback links read `site (archived YYYY)`. */
function hostOf(url?: string) {
  if (!url) return 'Offline';
  const w = url.match(/web\.archive\.org\/web\/(\d{4})\d*\/(https?:\/\/.+)$/);
  try { return w?.[1] && w[2] ? `${new URL(w[2]).host.replace(/^www\./, '')} (archived ${w[1]})` : new URL(url).host.replace(/^www\./, ''); } catch { return 'Offline'; }
}
