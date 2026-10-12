import * as THREE from 'three';
import { DECAY, DRIFT, MAX_DT, PARALLAX, RATE, REDUCED, SCROLL, SPIN, damp } from '../../design-system/motion';
import { CAMERA, RENDERER } from '../../design-system/scene';
import { Tower, type Instance } from './tower';
import { Station, CLEAN_LAYER, COLOUR_LAYER } from './station';
import { Dirty, DIRTY, type Current } from './dirty';
import { Room, PLACES, coinRows, type PlaceName } from './room';
import { LABEL_FONTS } from './floppy/labels';
import { Composer } from './composer';
import { Lighting } from './lighting';
import { Resolution } from './resolution';
import { FREE, PHONE, QUALITY, VERIFY, settings } from './settings';
import { Tracker, type TrackerContent } from '../hud/tracker';
import { clientOf, preload, sourceFor } from '../hud/source';
import { Sound } from '../audio/sound';
import { SimArchive, fmtDisk, fmtTime, type Archive } from '../archive/sim';
import { sourceName, type Activity, type Coin } from '../archive/types';
import { BLUR_EVENT, FOCUS_EVENT, READ_EVENT } from '../ui/indexNav';
import { WriteLog } from '../ui/writeLog';
import { Story, type Line } from '../ui/story';
import { Walkthrough, type Rect, type TourStop } from '../ui/walkthrough';
import { PAGE_COUNT, drawPage, pages, type Receipts } from '../machine/docs';
import { Terminal } from '../ui/terminal';
import { Launchpad, type LpCoin } from '../archive/launchpad';
import { CoinSheet, LaunchSheet } from '../ui/launchpad';
import { BooksSheet } from '../ui/books';
import type { MintSheet } from '../ui/mint';
import spec from './tower-spec.json';

const INTERFACE = 'a, button, .lil-gui, .sheet';
/** Vertical FOV for an aspect ratio: the design FOV, widened on portrait screens so enough shows horizontally. */
const fovFor = (aspect: number) => Math.max(CAMERA.fov, (2 * Math.atan(Math.tan((CAMERA.minHorizontalFov * Math.PI) / 360) / aspect) * 180) / Math.PI);
const wrapAngle = (a: number) => ((((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
const MACHINE_SATURATION = 0.9; // colour only inside the objects (the diskettes read as real colour diskettes)
const FLIGHT = 1.6; // seconds for the camera to fly between places
const SEEN = 'overmind.seen';
/** Where the record was when this browser last looked (saves so far, and when): "you came back" counts from it. */
const LAST = 'overmind.last';
/**
 * The walkthrough, in the Overmind's own voice: one part of the scene at a time, framed by the instrument. Short lines,
 * a beat each; the camera moves only when the part is elsewhere (the lineage below, the room).
 */
type TourTarget = 'live' | 'label' | 'log' | 'stack' | 'clock' | 'reader';
const TOUR: (TourStop & { where: 'tower' | 'stack' | 'room'; target: TourTarget; wake?: 'clock' | 'computer' })[] = [
  { title: 'the live disk', line: 'this is me, writing. every minute i decide what makes it through.', where: 'tower', target: 'live' },
  { title: 'its label', line: "where it came from: the disk it forked from, and its fingerprint.", where: 'tower', target: 'label' },
  { title: 'the write log', line: 'every save lands here with my note on why i kept it. ninety, and the disk is full.', where: 'tower', target: 'log' },
  { title: 'the lineage', line: 'every disk under it is full and sealed. anyone can check nobody changed them. not even me.', where: 'room', target: 'stack' },
  { title: 'q-day', line: "the red clock is my guess at q-day: the day quantum computers break today's encryption.", where: 'room', target: 'clock', wake: 'clock' },
  { title: 'the reader', line: "put any disk in that machine and i'll read it to you. ask me to check one, and i'll prove it.", where: 'room', target: 'reader', wake: 'computer' },
];
const FACE_MM = spec.disk.t / 2;
const TOUCH = window.matchMedia('(hover: none)').matches;
const WORDS = {
  thesis: 'The Overmind is writing the record that survives Q-Day.',
  minute: 'Every minute, it decides what makes it through.',
  qday: "Q-Day: the day quantum computers break today's encryption. The red clock is its guess.",
  tower: TOUCH ? 'Tap a disk to look inside, or' : 'Hover a disk to look inside, or',
  room: TOUCH ? 'Tap a name to go there, or' : 'Click anything in the room, or',
};
const SETTLED_TOWER: Line[] = [{ text: WORDS.thesis }, { text: WORDS.minute }, { text: WORDS.tower, kind: 'hint', check: true, tour: true }];
/** What the Overmind says at the places that have no panel of their own. */
const PLACE_LINES: Partial<Record<PlaceName, Line[]>> = {
};
const SETTLED_ROOM: Line[] = [{ text: WORDS.thesis }, { text: WORDS.qday }, { text: WORDS.room, kind: 'hint', check: true, tour: true }];
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
  private touchFirst = TOUCH;
  /**
   * The first visit, in three layers: `hold` on the live disk (what is this?), `wake` while the camera pulls back and
   * the room's lights come up one group at a time, each with its line (why should I care?); then the room as usual,
   * with "check a disk" for whoever wants proof. Any input moves it on.
   */
  private intro = { stage: 'off' as 'off' | 'on', i: 0, since: 0 };
  /** Docs: the page being read, and the spread printed on the manual now. */
  private docsPage = 0;
  private terminal!: Terminal;
  private termForm = document.querySelector<HTMLFormElement>('[data-term]');
  private termLog = document.querySelector<HTMLElement>('[data-term-log]');
  /**
   * Who else is here: a quiet line under the logo (the live service only). What other visitors do (open, check, share
   * a disk, talk to the Overmind) takes the line over for a few seconds, one at a time, as a link to the same thing.
   */
  private hereEl = document.querySelector<HTMLElement>('[data-here]');
  private hereShown?: string;
  private ticker: Activity[] = [];
  private tickerUntil = 0;
  private updatePresence() {
    const el = this.hereEl, text = el?.querySelector<HTMLElement>('[data-here-text]');
    if (!el || !text) return;
    for (const a of this.archive.activity?.() ?? []) {
      if (Date.now() - a.at < 3 * 60_000) this.ticker.push(a);
      if (a.kind === 'check' && a.disk === this.station.disk) this.station.touch(); // the count on the screen moves
    }
    if (this.ticker.length > 3) this.ticker.splice(0, this.ticker.length - 3);
    const now = performance.now();
    if (now < this.tickerUntil) return;
    const a = this.ticker.shift();
    if (a) {
      this.tickerUntil = now + 5200;
      const disk = a.disk === undefined ? '' : `disk ${String(a.disk + 1).padStart(4, '0')}`;
      if (a.kind === 'launch') void this.refreshCoins();
      if (a.mine) this.terminal.notify(a.kind === 'picked' ? `the thing you asked me to keep made it through: ${disk}.` : "i weighed what you asked me to keep and kept something else this time. i'm sorry. it was close.");
      const line = a.kind === 'picked' ? (a.mine ? `your pick made it through: ${disk}` : `a visitor's pick made it onto ${disk}`)
        : a.kind === 'passed' ? 'the overmind passed on your pick' : a.kind === 'launch' ? `someone launched $${a.symbol ?? ''}`
        : a.kind === 'open' ? `someone opened ${disk}` : a.kind === 'share' ? `someone shared ${disk}`
        : a.kind === 'check' ? `someone checked ${disk}${a.match ? ': it matched' : ''}` : a.kind === 'docs' ? 'someone is reading the docs' : 'someone is talking to the overmind';
      const go = document.createElement('button');
      go.type = 'button'; go.className = 'here__go'; go.textContent = line;
      go.addEventListener('click', () => { if (a.kind === 'launch') this.go('explorer'); else if (a.disk !== undefined) this.read(a.disk); else this.go(a.kind === 'docs' ? 'docs' : 'terminal'); });
      this.showHere(line, go);
      return;
    }
    const n = this.archive.presence?.();
    if (n === undefined) return;
    const line = n <= 1 ? 'just you and me' : `${n.toLocaleString('en-US')} in the room`;
    if (line !== this.hereShown) this.showHere(line, document.createTextNode(line));
  }
  private showHere(line: string, node: Node) {
    const el = this.hereEl!, text = el.querySelector<HTMLElement>('[data-here-text]')!;
    this.hereShown = line;
    el.hidden = false;
    text.replaceChildren(node);
    el.classList.remove('is-new'); void el.offsetWidth; el.classList.add('is-new');
  }
  private termKey = '';
  /** The terminal's input shows at the terminal, and while a disk is in the drive (ask about it). */
  private termShown = '';
  private updateTermForm() {
    const form = this.termForm, field = form?.querySelector<HTMLInputElement>('input');
    const reading = this.station.open && this.place === 'tower';
    const talking = this.station.reading && !!this.station.terminal;
    const key = `${this.place === 'terminal'}:${reading}:${talking}`;
    if (!form || !field || key === this.termShown) return;
    this.termShown = key;
    form.hidden = !(this.place === 'terminal' || reading);
    if (this.termLog) this.termLog.hidden = !(this.place === 'terminal' || talking);
    field.placeholder = reading ? 'ask about this disk, or type HELP' : 'talk to the overmind, or type HELP';
    document.documentElement.classList.toggle('is-talking', talking);
    const back = document.querySelector<HTMLElement>('[data-todisk]');
    if (back) back.hidden = !talking;
    if (!this.station.reading && this.place !== 'terminal' && this.station.terminal) this.station.terminal = undefined; // ejected: the screen is the screen again
    if (!this.station.reading) this.terminal.disk = undefined;
  }
  /** The phone's transcript of the terminal (the CRT is too small to read there). */
  private updateTermLog() {
    const el = this.termLog;
    if (!el || !(this.place === 'terminal' || (this.station.reading && this.station.terminal))) return;
    const lines = this.terminal.lines.slice(-14);
    const key = lines.map((l) => `${l.at}:${this.terminal.shown(l)}`).join('|');
    if (key === this.termKey) return;
    this.termKey = key;
    el.replaceChildren(...lines.map((l) => { const p = document.createElement('p'); p.className = `is-${l.who}`; p.textContent = l.text.slice(0, this.terminal.shown(l)); return p; }));
  }
  private docsSpread = -1; // the printed spread (×2, +1 for the large-print edition)
  private pager = { root: document.querySelector<HTMLElement>('[data-pager]'), label: document.querySelector<HTMLElement>('[data-page-label]') };

  private tour = new Walkthrough({ next: () => this.tourNext(), skip: () => this.finishIntro() }, () => this.reduced);
  private story?: Story;
  /** In the room view: the place under the pointer. */
  private roomHover?: PlaceName;
  private roomLabel = document.querySelector<HTMLElement>('[data-room-label]');
  private dom = {
    link: document.querySelector<HTMLAnchorElement>('[data-reader-link]'),
    eject: document.querySelector<HTMLButtonElement>('[data-eject]'),
    share: document.querySelector<HTMLButtonElement>('[data-share]'),
    image: document.querySelector<HTMLAnchorElement>('[data-image]'),
    announce: document.querySelector<HTMLElement>('[data-announce]'),
  };

  constructor(archive: Archive = new SimArchive()) {
    this.archive = archive;
    // phones start at their ceiling (2.5× on a 3× screen) and only step down if frames can't keep up (never below 1.75×)
    this.resolution = PHONE
      ? new Resolution(settings.pixelRatio, Math.min(1.75, settings.pixelRatio), settings.pixelRatio)
      : new Resolution(settings.pixelRatio, RENDERER.pixelRatio.min, RENDERER.pixelRatio.start);
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
    this.composer = new Composer(this.renderer, PHONE ? 2 : 4);
    this.sound = new Sound(document.querySelector<HTMLButtonElement>('[data-sound]'));
    this.tracker = new Tracker({ onLock: this.sound.lock, onTick: this.sound.tick, reduced: () => this.reduced });
    const storyRoot = document.querySelector<HTMLElement>('[data-story]');
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-page]')) b.addEventListener('click', () => this.turnDocs(Number(b.dataset.page)));
    // the terminal: one conversation for the visit; typing goes to the screen as it's typed
    this.terminal = new Terminal(this.archive, (this.archive as { endpoint?: string }).endpoint, () => this.station?.touch());
    // the launchpad: the launch sheet at the duplicator, the coin sheet at the wall (the live service only)
    const endpoint = (this.archive as { endpoint?: string }).endpoint;
    this.lp = endpoint ? new Launchpad(endpoint) : undefined;
    this.launchSheet = new LaunchSheet(this.lp, {
      lcd: (a, b) => this.room?.duplicator.lcd.print(a, b),
      toWall: (mint) => this.openCoin(mint),
      launched: () => void this.refreshCoins(),
    });
    this.books = new BooksSheet(endpoint, () => this.coin?.mint ? "my coin's board: $OMD's market cap, a day's volume and a day's change. only numbers that add up." : "my coin's board. it shows $OMD's numbers once it exists: market cap, a day's volume, a day's change.");
    this.coinSheet = new CoinSheet(this.lp, { launch: () => this.go('launch'), close: () => { this.coinSheet.about(this.coins, this.lpStatus); if (window.location.hash.startsWith('#coin-')) history.replaceState(null, '', '#explorer'); } });
    const form = document.querySelector<HTMLFormElement>('[data-term]'), field = form?.querySelector<HTMLInputElement>('input');
    field?.addEventListener('input', () => { this.terminal.input = field.value; this.station.touch(); });
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!field) return;
      const q = field.value; field.value = ''; this.terminal.input = '';
      // reading a disk: the screen turns to the conversation, with that disk in the drive (Back to the disk returns)
      if (this.station.reading && !this.station.terminal) { this.terminal.disk = this.station.disk; this.station.terminal = this.terminal; this.station.touch(); }
      void this.terminal.submit(q);
    });
    // the on-screen keyboard: its height, so the input can sit on it (phones)
    const vv = window.visualViewport;
    const keyboard = () => {
      const h = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      document.documentElement.style.setProperty('--kb', `${Math.round(h)}px`);
      document.documentElement.classList.toggle('has-keyboard', h > 80);
    };
    vv?.addEventListener('resize', keyboard); vv?.addEventListener('scroll', keyboard);
    document.querySelector('[data-todisk]')?.addEventListener('click', () => { this.station.terminal = undefined; this.station.touch(); });
    if (storyRoot) this.story = new Story(storyRoot, () => this.checkDisk(), () => this.reduced, () => this.startIntro());
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
    this.room.wakeable('computer', this.station.pc.group);
    this.room.clean(this.place, CLEAN_LAYER);
    void this.watchCoin();
    void this.refreshCoins();
    window.setInterval(() => void this.refreshCoins(), 60_000);
    // a first visit (no link to a place, not seen lately) opens in the dark, on the live disk
    const deep = window.location.hash.length > 1 && window.location.hash !== '#debug';
    let seen = false;
    try { seen = Date.now() - Number(localStorage.getItem(SEEN) ?? 0) < 30 * 86_400_000; } catch { /* storage blocked: treat as new */ }
    if (!deep && !seen) for (const g of ['clock', 'computer', 'rest'] as const) this.room.light(g, 0, true);
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
      // first visit: the tower, out to the room, back in; returning: the tower straight away
      if (this.place === 'tower' && this.room.wake.rest.value === 0) this.startIntro(); // first visit: the walkthrough
      else if (this.place === 'tower') this.story?.set('tower', this.welcomeBack(SETTLED_TOWER));
      this.rememberVisit();
      requestAnimationFrame(this.loop);
    });
  }
  private ready = false;

  /** Saves so far across the whole lineage (90 a disk). */
  private savesSoFar() { const c = this.archive.current(); return c.disk * 90 + c.written; }
  /**
   * A returning visitor (away ten minutes or more) hears what happened while they were gone, once, before the usual
   * lines: "you came back. 214 things made it through since you left."
   */
  private welcomeBack(lines: Line[]): Line[] {
    let last: { at: number; saves: number } | undefined;
    try { last = JSON.parse(localStorage.getItem(LAST) ?? 'null') ?? undefined; } catch { /* storage blocked */ }
    const made = last ? this.savesSoFar() - last.saves : 0;
    if (!last || made < 1 || Date.now() - last.at < 10 * 60_000) return lines;
    return [{ text: `you came back. ${made.toLocaleString('en-US')} ${made === 1 ? 'thing' : 'things'} made it through since you left.`, kind: 'voice' }, ...lines];
  }
  /** Keeps this browser's place in the record current (every minute, and as the page goes away). */
  private rememberVisit() {
    const save = () => { try { localStorage.setItem(LAST, JSON.stringify({ at: Date.now(), saves: this.savesSoFar() })); } catch { /* fine */ } };
    window.setTimeout(save, 15_000); // after the first look, not before (a reload in the first seconds keeps the old mark)
    window.setInterval(save, 60_000);
    window.addEventListener('pagehide', save);
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
    this.runIntro(dt);
    this.story?.update();
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
      const r = this.station.readerCamera(this.camera, window.innerWidth <= 640 && this.camera.aspect < 0.8 ? 0.38 : 0);
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
    this.updateTermLog();
    this.updateTermForm();
    this.updatePresence();
    if (this.station.reading || this.place !== 'tower' || this.flightT < 1 || this.tour.active) this.hover = undefined;
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

  /* ---------------------------------------------------------------- the first visit: the walkthrough */
  /** Starts (or replays) the walkthrough from its first stop. */
  startIntro() {
    if (this.station.reading) this.station.eject();
    this.intro = { stage: 'on', i: 0, since: 0 };
    document.documentElement.dataset.intro = 'on';
    this.tour.start(TOUR.length);
    this.enterStop(0);
  }
  private enterStop(i: number) {
    const stop = TOUR[i];
    this.intro.i = i; this.intro.since = 0;
    const fly = (to: PlaceName, d: number) => { this.introFlight = true; this.go(to, this.reduced ? 0.01 : d); this.introFlight = false; };
    if (stop.where === 'room') { if (this.place !== 'room') fly('room', 2.2); }
    else {
      if (this.place !== 'tower') fly('tower', 1.6);
      // the lineage: the camera sinks a little so the sealed disks under the live one fill the view
      this.cameraHeightTarget = this.tower.range.max - 0.1 - (stop.where === 'stack' ? 1.0 : 0);
    }
    if (stop.wake) this.room.light(stop.wake, 1);
    this.tour.show(i, stop);
  }
  private tourNext() {
    if (this.intro.stage === 'off') return;
    if (this.intro.i + 1 >= TOUR.length) this.finishIntro(true);
    else this.enterStop(this.intro.i + 1);
  }
  /** Ends the walkthrough (its last stop, skip, or going somewhere): lights up, words settled, the camera home on the tower. */
  private finishIntro(done = false) {
    if (this.intro.stage === 'off') return;
    this.intro.stage = 'off';
    this.tour.end();
    delete document.documentElement.dataset.intro;
    for (const g of ['clock', 'computer', 'rest'] as const) this.room.light(g, 1);
    this.cameraHeightTarget = this.tower.range.max - 0.1;
    if (this.place !== 'tower' && done) { this.introFlight = true; this.go('tower', this.reduced ? 0.01 : 1.8); this.introFlight = false; }
    this.story?.set('tower', SETTLED_TOWER);
    try { localStorage.setItem(SEEN, String(Date.now())); } catch { /* fine */ }
  }
  /** During the walkthrough a tap, a scroll, Enter or → moves to the next part; Esc ends it. Returns whether it was used. */
  private introInput(key?: string) {
    if (this.intro.stage === 'off') return false;
    if (key === 'Escape') { this.finishIntro(); if (this.place !== 'tower') this.go('tower', 1.2); return true; }
    if (key && !['Enter', 'ArrowRight', ' ', 'wheel'].includes(key)) return true; // other keys do nothing mid-walkthrough
    this.tourNext();
    return true;
  }
  /** Per frame: the frame follows its part; a stop moves on by itself once its line has typed and had a beat to land. */
  private runIntro(dt: number) {
    if (this.intro.stage === 'off') return;
    const stop = TOUR[this.intro.i];
    this.tour.update(this.tourRect(stop.target), dt);
    if (this.tour.typingLeft > 0) return;
    this.intro.since += dt;
    if (this.intro.since > 1.6 + stop.line.length * 0.022) this.tourNext();
  }

  /** Where a part of the scene is on screen (CSS pixels). */
  private tourRect(target: TourTarget): Rect | undefined {
    const W = window.innerWidth, H = window.innerHeight, v = new THREE.Vector3(), m = new THREE.Matrix4();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, ok = true;
    const add = (p: THREE.Vector3) => {
      v.copy(p).project(this.camera);
      if (v.z > 1) { ok = false; return; }
      const x = (v.x * 0.5 + 0.5) * W, y = (0.5 - v.y * 0.5) * H;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    };
    const box = (mat: THREE.Matrix4, hx: number, hy: number, hz: number, cx = 0, cy = 0, cz = 0) => {
      for (let i = 0; i < 8; i++) add(new THREE.Vector3(cx + (i & 1 ? hx : -hx), cy + (i & 2 ? hy : -hy), cz + (i & 4 ? hz : -hz)).applyMatrix4(mat));
    };
    const disk = (n: number) => this.tower.worldMatrix({ slab: this.tower.slab(n), offset: 0 }, m);
    const object = (o: THREE.Object3D) => {
      const b = new THREE.Box3().setFromObject(o);
      for (let i = 0; i < 8; i++) add(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
    };
    const MMW = spec.mm;
    if (target === 'live') box(disk(this.tower.count), 45 * MMW, 47 * MMW, FACE_MM * MMW);
    else if (target === 'label') box(disk(this.tower.count), 35 * MMW, 27.8 * MMW, 0.1 * MMW, 0, -19.2 * MMW, FACE_MM * MMW);
    else if (target === 'stack') { const b = this.room.hitBox('tower'); if (!b) return undefined; for (let i = 0; i < 8; i++) add(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)); }
    else if (target === 'clock') object(this.room.clock.group);
    else if (target === 'reader') object(this.station.pc.group);
    else {
      // the write log: its head, bar, status and the newest save
      const els = ['[data-log-head]', '.log__bar', '.log__status', '.log__entry'].map((q) => document.querySelector(q)).filter((e): e is Element => !!e);
      for (const e of els) { const r = e.getBoundingClientRect(); if (r.width && r.height) { x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); } }
    }
    if (!ok || !Number.isFinite(x0)) return undefined;
    return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
  }
  private introFlight = false;

  /** The proof, one click away: the newest sealed disk goes into the computer and CHECK runs on its screen. */
  checkDisk() {
    const n = this.archive.current().disk - 1;
    if (n < 0) { this.announce('No disk has been sealed yet. The first seals after 90 saves.'); return; }
    this.read(n, true);
  }

  /* ---------------------------------------------------------------- docs */
  /** Turns the docs by `delta` (a page on a tall screen, a spread on a wide one) and prints the spread it lands on. */
  turnDocs(delta: number) {
    const tall = this.camera.aspect < 1, step = tall ? 1 : 2;
    const next = Math.max(0, Math.min(PAGE_COUNT - 1, (tall ? this.docsPage : this.docsPage - (this.docsPage % 2)) + delta * step));
    if (next === this.docsPage && delta) return;
    this.docsPage = next;
    this.room.docsPage = next;
    void this.printDocs();
    // the camera glides to the page (on a tall screen it moves between the left and right pages)
    this.flightFrom.pos.copy(this.camera.position); this.flightFrom.look.copy(this.lookAt); this.flightFrom.up.copy(this.camera.up);
    this.flightFrom.focus = this.placeFocus;
    this.flightT = 0; this.flightDur = this.reduced ? 0.01 : 0.7;
    this.updatePager();
  }
  private updatePager() {
    const tall = this.camera.aspect < 1;
    if (this.pager.root) this.pager.root.hidden = this.place !== 'docs';
    if (this.pager.label) this.pager.label.textContent = tall ? `${this.docsPage + 1} / ${PAGE_COUNT}` : `${this.docsPage - (this.docsPage % 2) + 1}–${this.docsPage - (this.docsPage % 2) + 2} / ${PAGE_COUNT}`;
  }
  /** The launchpad's coins, onto the explorer wall (refreshed every minute, and when someone launches). */
  private lp?: Launchpad;
  private launchSheet!: LaunchSheet;
  private coinSheet!: CoinSheet;
  private coins: LpCoin[] = [];
  private books!: BooksSheet;
  /** The vending machine's lifeboat tickets (test network): loaded when first visited, with the Solana library. */
  private mint?: MintSheet;
  private async openMint() {
    if (!this.mint) { const { MintSheet } = await import('../ui/mint'); this.mint ??= new MintSheet({}); }
    if (this.place === 'mint') this.mint.show();
  }
  private lpStatus?: { snapshotHours: number; split: { treasury: number; launcher: number } };
  private sheetRaise = 0;
  private async refreshCoins() {
    if (!this.lp || !this.room) return;
    try { this.coins = await this.lp.coins(); } catch { return; }
    this.room.setCoins(this.coins.map((c) => ({ mint: c.mint, ticker: c.ticker, name: c.name, image: c.image, liveAt: c.liveAt })));
    this.lpStatus ??= await this.lp.status().catch(() => undefined);
    if (this.place === 'explorer' && !this.coinSheet.showing) this.coinSheet.about(this.coins, this.lpStatus);
  }
  /** Opens a coin's disk: the camera goes to the wall, its sheet opens (a #coin-<mint> link lands here too). */
  openCoin(mint: string) {
    if (this.place !== 'explorer') this.go('explorer');
    void this.coinSheet.open(mint);
    if (window.location.hash !== `#coin-${mint}`) history.replaceState(null, '', `#coin-${mint}`);
  }

  /** $OMD on the board: the coin's numbers once it exists, asked every minute (the server shares one lookup). */
  private coin?: Coin;
  private async watchCoin() {
    if (!this.archive.coin) return;
    const c = await this.archive.coin();
    if (c) { this.coin = c; this.room.boardRows = coinRows(c); }
    window.setTimeout(() => void this.watchCoin(), 60_000);
  }
  /** Prints the current spread on the manual; the receipts page is filled from the live archive. */
  private async printDocs() {
    const spread = Math.floor(this.docsPage / 2);
    const first = this.archive.disk(0);
    const r: Receipts = {
      genesis: first.startedAt || undefined, firstSeal: first.sealed ? first.sealedAt : undefined, sealed: this.archive.sealedCount(),
      qday: this.archive.watch?.()?.qday?.estimate?.slice(0, 10), coin: this.coin?.mint ?? ((import.meta.env.VITE_OMD_MINT as string | undefined) || undefined),
    };
    if (spread === 3 && this.archive.wallet) r.wallet = await this.archive.wallet();
    const large = this.camera.aspect < 1, key = spread * 2 + (large ? 1 : 0);
    if (key === this.docsSpread && spread !== 3) return;
    this.docsSpread = key;
    const all = pages(r);
    this.room.manual.print((g, side) => drawPage(g, all[spread * 2 + side], spread * 2 + side, large));
  }

  /** Fly to a place in the room (or home to the tower). Reading a disk ends first. */
  go(name: PlaceName, duration = FLIGHT) {
    if (!this.introFlight) this.finishIntro(); // choosing somewhere ends the first visit's story
    if (name === 'room' && this.intro.stage === 'off') this.story?.set('room', SETTLED_ROOM);
    if (name === 'tower' && this.intro.stage === 'off') this.story?.set('tower', SETTLED_TOWER);
    if (PLACE_LINES[name] && this.intro.stage === 'off') this.story?.set(name, PLACE_LINES[name]!);
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
    if (name === 'docs') { this.room.docsPage = this.docsPage; void this.printDocs(); this.archive.report?.('docs'); }
    // the terminal: the screen switches to the conversation and the input opens (focused now, inside the click, so a
    // phone's keyboard comes up)
    this.station.terminal = name === 'terminal' ? this.terminal : undefined;
    this.station.touch();
    if (this.termForm) {
      this.termShown = ''; // the form follows the place (updateTermForm)
      this.termForm.hidden = name !== 'terminal';
      if (this.termLog) this.termLog.hidden = name !== 'terminal';
      if (name === 'terminal') this.termForm.querySelector('input')?.focus({ preventScroll: true });
    }
    if (name === 'launch') void this.launchSheet.show(); else this.launchSheet.hide();
    if (name === 'omd') void this.books.show(); else this.books.hide();
    if (name === 'mint') void this.openMint(); else this.mint?.hide();
    if (name === 'explorer') { if (this.lp && !this.coinSheet.showing) this.coinSheet.about(this.coins, this.lpStatus); } else this.coinSheet.hide();
    window.dispatchEvent(new Event('placechange')); // the menu marks where the camera is going
    this.updatePager();
    const label = PLACES.find((p) => p.name === name)?.label;
    this.announce(name === 'room' ? 'The room.' : name === 'tower' ? 'overmind: the lineage, newest disk on top.' : `${label}.`);
    if (window.location.hash.slice(1) !== (name === 'tower' ? '' : name)) history.replaceState(null, '', name === 'tower' ? window.location.pathname + window.location.search : `#${name}`);
  }

  /** The camera's flight: from where it was to the place's pose, along a shallow arc (home is a moving target). */
  private fly(dt: number) {
    if (this.place === 'tower' && this.flightT >= 1) { this.placeBlend = 0; return; }
    this.flightT = Math.min(1, this.flightT + dt / (this.reduced ? 0.01 : this.flightDur));
    this.roomYaw += (this.roomYawTarget - this.roomYaw) * (1 - Math.exp(-dt * 5));
    const e = ease(this.flightT);
    let pos: THREE.Vector3, look: THREE.Vector3, up = new THREE.Vector3(0, 1, 0), focus: number;
    if (this.place === 'tower') { pos = this.camera.position.clone(); look = this.lookAt.clone(); up = this.camera.up.clone(); focus = DRIFT.focusBase + settings.focus; }
    else if (this.place === 'terminal') { const r = this.station.readerCamera(this.camera, window.innerWidth <= 640 && this.camera.aspect < 0.8 ? 0.5 : 0); pos = r.pos; look = r.look; focus = r.distance; }
    else { const v = this.room.view(this.place, this.camera, this.place === 'room' ? this.roomYaw : 0); pos = v.pos; look = v.look; focus = v.distance; if ('up' in v && v.up) up = v.up; }
    // a phone with a launchpad sheet open: the object rises into the top of the frame, clear of the sheet
    const sheet = this.camera.aspect < 0.8 ? (this.place === 'launch' && !this.launchSheet.root.hidden ? 0.55 : this.place === 'explorer' && !this.coinSheet.root.hidden ? 0.5 : this.place === 'omd' && !this.books.root.hidden ? 0.5 : this.place === 'mint' && this.mint && !this.mint.root.hidden ? 0.5 : 0) : 0;
    this.sheetRaise += (sheet - this.sheetRaise) * (1 - Math.exp(-dt * 6));
    if (this.sheetRaise > 0.001 && this.place !== 'tower') {
      const shift = up.clone().multiplyScalar(-this.sheetRaise * focus * Math.tan((this.camera.fov * Math.PI) / 360));
      pos.add(shift); look.add(shift);
    }
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
    const show = this.touchFirst && this.place === 'room' && this.flightT > 0.85 && !this.tour.active;
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
        el.textContent = a.place === 'tower' ? 'overmind' : PLACES.find((p) => p.name === a.place)?.label ?? a.place;
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
    const name = this.roomHover === 'tower' ? 'overmind' : PLACES.find((p) => p.name === this.roomHover)?.label ?? '';
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
  read(n: number, check = false) {
    if (!this.ready || this.station.reading || n > this.tower.count) return;
    if (this.place !== 'tower') this.go('tower');
    const slab = this.tower.slab(n);
    this.focused = undefined;
    this.station.insert(n, this.tower.worldMatrix({ slab, offset: 0 }, new THREE.Matrix4()), { check });
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
    if (this.dom.share) this.dom.share.hidden = !this.station.open;
    // a sealed disk can be taken home: a real 1.44 MB floppy image (the live archive serves it)
    const endpoint = (this.archive as { endpoint?: string }).endpoint, n = this.station.disk;
    const imageUrl = this.station.open && endpoint && n !== undefined && this.archive.disk(n).sealed ? `${endpoint}/api/disks/${n}/image` : '';
    if (this.dom.image && this.dom.image.getAttribute('href') !== (imageUrl || null)) {
      this.dom.image.hidden = !imageUrl;
      if (imageUrl) this.dom.image.href = imageUrl; else this.dom.image.removeAttribute('href');
    }
    // the address names the disk in the drive (#disk-15), so it can be sent; ejecting goes back to the tower's
    const inDrive = this.station.open ? this.station.disk : this.station.reading ? this.linkedDisk : undefined;
    if (inDrive !== this.linkedDisk) {
      this.linkedDisk = inDrive;
      if (inDrive !== undefined) this.archive.report?.('open', inDrive); // the room hears about it
      history.replaceState(null, '', inDrive === undefined ? window.location.pathname + window.location.search : `#disk-${inDrive + 1}`);
    }
  }
  private linkedDisk?: number;
  /** Sends the disk in the drive: the phone's share sheet, else the link on the clipboard. */
  private async share() {
    const n = this.station.disk;
    if (n === undefined || !this.dom.share) return;
    // on overmind.im a share link previews as the disk itself (/d/15 renders its card); elsewhere it's the room's own link
    const url = /(^|\.)overmind\.im$/.test(window.location.hostname) ? `https://overmind.im/d/${n + 1}` : `${window.location.origin}${window.location.pathname}#disk-${n + 1}`;
    const text = `${fmtDisk(n)}: what made it through, before Q-Day.`;
    this.archive.report?.('share', n);
    try {
      if (navigator.share && this.isTouch) { await navigator.share({ title: 'Overmind', text, url }); return; }
      await navigator.clipboard.writeText(url);
      this.dom.share.textContent = 'Link copied';
      this.announce('Link copied.');
      window.setTimeout(() => { if (this.dom.share) this.dom.share.textContent = 'Share'; }, 1600);
    } catch { /* dismissed the sheet, or no clipboard */ }
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
    this.dom.share?.addEventListener('click', () => void this.share());
  }

  onWheel = (e: { deltaY: number }) => {
    if (!this.ready || this.introInput('wheel')) return;
    if (this.station.reading) { this.station.wheel(e.deltaY); return; }
    if (this.place === 'room' && e.deltaY > 0) { this.go('tower'); return; }
    if (this.place !== 'tower' || this.flightT < 1) return; // no scrolling the lineage mid-flight
    this.cameraHeightTarget -= e.deltaY * SCROLL.wheelUnitsPerPx;
  };

  onKeyDown = (e: { key: string; preventDefault?: () => void }) => {
    // typing into the terminal: the page's own keys stay out of it (Esc leaves)
    if (document.activeElement instanceof HTMLInputElement) {
      if (e.key === 'Escape') { document.activeElement.blur(); this.go('room'); }
      return;
    }
    if (!this.ready || (e.key !== 'Tab' && e.key !== 'Shift' && this.introInput(e.key))) return;
    if (e.key === 'm' || e.key === 'M') { this.sound.toggle(!this.sound.enabled); return; }
    if (this.station.reading) { if (this.station.key(e.key)) e.preventDefault?.(); return; }
    if (this.place === 'docs' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { this.turnDocs(e.key === 'ArrowRight' ? 1 : -1); return; }
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
    if (this.introInput()) return;
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
    if (this.place === 'explorer') { // a coin on the wall: its sheet
      this.raycaster.setFromCamera(this.pointerTarget, this.camera);
      const c = this.room.pickCoin(this.raycaster.ray);
      if (c) this.openCoin(c.mint);
      return;
    }
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
    if (this.place === 'docs') void this.printDocs(); // a phone turned sideways gets the regular edition, and back
    this.tracker.resize();
  };
}

/** The reference's host label: the site, without www; Wayback links read `site (archived YYYY)`. */
function hostOf(url?: string) {
  if (!url) return 'Offline';
  const w = url.match(/web\.archive\.org\/web\/(\d{4})\d*\/(https?:\/\/.+)$/);
  try { return w?.[1] && w[2] ? `${new URL(w[2]).host.replace(/^www\./, '')} (archived ${w[1]})` : new URL(url).host.replace(/^www\./, ''); } catch { return 'Offline'; }
}
