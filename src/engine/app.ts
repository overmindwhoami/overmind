import * as THREE from 'three';
import { DECAY, DRIFT, MAX_DT, PARALLAX, RATE, REDUCED, SCROLL, SPIN, damp } from '../../design-system/motion';
import { CAMERA, RENDERER } from '../../design-system/scene';
import { Tower, period, replicas, type Instance } from './tower';
import { LABEL_FONTS } from './floppy/labels';
import { Composer } from './composer';
import { Lighting } from './lighting';
import { Resolution } from './resolution';
import { QUALITY, VERIFY, settings } from './settings';
import { Tracker } from '../hud/tracker';
import { Sound } from '../audio/sound';
import { BLUR_EVENT, FOCUS_EVENT } from '../ui/indexNav';

const INTERFACE = 'a, button, .lil-gui';
/** Vertical FOV for an aspect ratio: the design FOV, widened on portrait screens so enough shows horizontally. */
const fovFor = (aspect: number) => Math.max(CAMERA.fov, (2 * Math.atan(Math.tan((CAMERA.minHorizontalFov * Math.PI) / 360) / aspect) * 180) / Math.PI);
const wrapAngle = (a: number) => ((((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

export class App {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  scene = new THREE.Scene();
  tower: Tower;
  composer: Composer;
  lighting: Lighting;
  tracker: Tracker;
  sound: Sound;
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
  private shift = new THREE.Matrix4();
  private raycaster = new THREE.Raycaster();
  private rayOrigin = new THREE.Vector3();
  private rayDirection = new THREE.Vector3();
  private previousTime = 0;

  constructor() {
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

    this.camera = new THREE.PerspectiveCamera(fovFor(window.innerWidth / window.innerHeight), window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far);
    this.lighting = new Lighting(this.renderer, this.scene);
    performance.mark('tower:start');
    this.tower = new Tower(QUALITY === 'low');
    performance.mark('tower:end');
    this.scene.add(this.tower.group);
    this.composer = new Composer(this.renderer);
    this.sound = new Sound(document.querySelector<HTMLButtonElement>('[data-sound]'));
    this.tracker = new Tracker({ onLock: this.sound.lock, onTick: this.sound.tick, reduced: () => this.reduced });

    // Start on the newest replica.
    const newest = this.tower.slabs.find((s) => s.replica.index === replicas.length - 1);
    this.cameraHeight = this.cameraHeightTarget = newest ? newest.y : 0;

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
    await Promise.all([document.fonts.ready, ...LABEL_FONTS.map((f) => document.fonts.load(f).catch(() => []))]);
    performance.mark('labels:start');
    this.tower.paintLabels();
    performance.mark('labels:end');
    this.update(0);
    performance.mark('compile:start');
    await this.renderer.compileAsync(this.scene, this.camera);
    performance.mark('upload:start');
    for (const t of this.tower.textures) this.renderer.initTexture(t);
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

    const H = this.tower.height;
    if (Math.abs(this.cameraHeight) > H / 2) {
      const e = Math.round(this.cameraHeight / H) * H;
      this.cameraHeight -= e;
      this.cameraHeightTarget -= e;
      if (this.focused) this.focused.offset -= e;
      this.previousViewProjection.multiply(this.shift.makeTranslation(0, e, 0));
    }
    this.cameraHeight += (this.cameraHeightTarget - this.cameraHeight) * damp(this.reduced ? REDUCED.cameraRate : RATE.world, dt);
    this.pointer.lerp(this.pointerTarget, damp(RATE.world, dt));

    const par = settings.parallax * m;
    const a = this.cameraHeight + Math.sin(t * DRIFT.heightFreq) * DRIFT.heightAmp * m;
    this.camera.position.set(
      Math.sin(t * DRIFT.xFreq) * DRIFT.xAmp * m + this.pointer.x * PARALLAX.cameraX * par,
      a + CAMERA.heightOffset + this.pointer.y * PARALLAX.cameraY * par,
      CAMERA.distance + Math.sin(t * DRIFT.zFreq) * DRIFT.zAmp * (this.reduced ? 0 : 1),
    );
    this.lookAt.set(CAMERA.lookX, a + CAMERA.lookOffset, 0);
    this.camera.up.set(Math.sin(CAMERA.roll), Math.cos(CAMERA.roll), 0);
    this.camera.lookAt(this.lookAt);
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();

    const band = Math.tan((this.camera.fov * Math.PI) / 360) * 3.3 + 0.7;
    this.tower.cull(a - band, a + band);
    this.lighting.update(this.pointer, this.scene, settings);
    this.tower.update(a, settings);

    if (this.focused) this.hover = this.focused;
    else if (!this.isTouch) this.hover = this.isPointerInside && !this.isOverInterface && this.pressDistance < SCROLL.tapSlop ? this.pick() : undefined;
    document.documentElement.classList.toggle('is-hovering', !!this.hover);
    this.tracker.select(this.hover);
    this.sound.update(dt, this.spinVelocity / SPIN.idle, settings.volume);
  }

  render(dt = 1 / 60) {
    const tw = this.tower.group.matrixWorld;
    this.renderer.info.reset();
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.viewProjectionInverse.multiplyMatrices(this.camera.matrixWorld, this.camera.projectionMatrixInverse);
    this.towerInverse.copy(tw).invert();
    if (this.frame === 0) { this.previousTower.copy(tw); this.previousViewProjection.copy(this.viewProjection); }
    this.reproject.copy(this.previousViewProjection).multiply(this.previousTower).multiply(this.towerInverse).multiply(this.viewProjectionInverse);
    this.renderer.setRenderTarget(this.composer.scene);
    this.renderer.render(this.scene, this.camera);
    const breathe = this.reduced ? 0 : Math.sin(this.elapsed * DRIFT.focusFreq) * DRIFT.focusAmp;
    this.composer.render({
      dt,
      focus: DRIFT.focusBase + settings.focus + breathe,
      frame: this.frame,
      time: this.elapsed,
      projectionInverse: this.camera.projectionMatrixInverse,
      reproject: this.reproject,
      settings: { ...settings, shutter: this.reduced && !REDUCED.motionBlur ? 0 : settings.shutter },
    });
    const cursor = this.isDragging && this.pressDistance >= SCROLL.tapSlop ? 'drag' : this.hover ? 'hover' : 'idle';
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

  pick() {
    this.raycaster.setFromCamera(this.pointerTarget, this.camera);
    this.towerInverse.copy(this.tower.group.matrixWorld).invert();
    this.rayOrigin.copy(this.raycaster.ray.origin).applyMatrix4(this.towerInverse);
    this.rayDirection.copy(this.raycaster.ray.direction).transformDirection(this.towerInverse);
    return this.tower.pick(this.rayOrigin, this.rayDirection);
  }

  /** Fly to a replica and turn it to face the camera (reference keyboard focus; also used for click-to-inspect). */
  focus(replicaIndex: number) {
    const slab = this.tower.slabs.find((s) => s.replica.index === replicaIndex);
    if (!slab) return;
    const offset = Math.round((this.cameraHeight - slab.y) / period) * period;
    const { x, z } = slab.box.center;
    this.focused = { slab, offset };
    this.focusSpin = this.spin + wrapAngle(-Math.atan2(x, z) - this.spin);
    this.cameraHeightTarget = slab.y + offset;
  }
  blur() { this.focused = undefined; }

  private listen() {
    document.documentElement.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener(FOCUS_EVENT, ((e: CustomEvent<number>) => this.focus(e.detail)) as EventListener);
    window.addEventListener(BLUR_EVENT, () => this.blur());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('resize', this.resize);
    window.addEventListener('wheel', this.onWheel, { passive: true });
  }

  onWheel = (e: { deltaY: number }) => { this.cameraHeightTarget -= e.deltaY * SCROLL.wheelUnitsPerPx; };

  onKeyDown = (e: { key: string }) => {
    if (e.key === 'm' || e.key === 'M') { this.sound.toggle(!this.sound.enabled); return; }
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
    if (!this.isDragging) return;
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
    this.spinBoost = this.dragVelocity - settings.spin * this.motionScale;
    this.lastMoveTime = undefined;
    document.documentElement.classList.remove('is-dragging');
  };

  private onTap() {
    const target = this.isTouch ? this.pick() : this.hover;
    if (this.isTouch && target?.slab !== this.hover?.slab) { this.hover = target; return; }
    if (target && (this.isTouch || target.slab === this.pressed?.slab)) {
      if (this.focused?.slab === target.slab) { this.blur(); return; }
      this.focus(target.slab.replica.index);
      this.sound.select(Math.max(-1, Math.min(1, (target.slab.box.center.x / 0.8) * 0.5)));
    } else if (this.focused) this.blur();
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
