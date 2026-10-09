/**
 * The Overmind's station: the clear 80s computer that sits behind the tower, writing the live disk on its screen.
 * Click a disk and it lifts out of the stack, flies into the drive, and the camera goes to the screen to read it:
 * the directory first, then any entry. Eject sends it back to its place in the stack.
 */
import * as THREE from 'three';
import { buildPC } from '../machine/pc';
import { SCREEN } from '../machine/pcSpec';
import { ROWS, SCREEN_PX, ScreenRenderer, type Hit } from '../machine/screen';
import type { Machine } from '../machine/geom';
import { MM, type FloppyKit } from './floppy/kit';
import type { GlassUniforms } from './floppy/materials';
import type { Archive } from '../archive/sim';
import type { Slot } from '../archive/types';
import { sourceFor, isPlaying } from '../hud/source';

/** Objects on this layer keep (mild) colour through the post chain. */
export const COLOUR_LAYER = 1;
type Phase = 'idle' | 'fly' | 'insert' | 'read' | 'eject' | 'return';
const FLY = 1.35, INSERT = 0.7, EJECT = 0.5, RETURN = 1.15;
const ease = (t: number) => t * t * (3 - 2 * t);

export class Station {
  readonly root = new THREE.Group();
  readonly pc: Machine;
  readonly screen = new ScreenRenderer();
  phase: Phase = 'idle';
  disk?: number;
  view: 'dir' | 'entry' = 'dir';
  selected = 0;
  scroll = 0;
  /** 0 = in the background, 1 = camera at the screen. */
  blend = 0;
  private t = 0;
  private start = new THREE.Matrix4();
  private liveKey = '';
  private liveSince = 0;
  private redraw = 0;

  constructor(kit: FloppyKit, glass: GlassUniforms, private archive: Archive) {
    this.pc = buildPC(kit.textures, glass, 'clear', { screen: this.screen.texture });
    const scaled = new THREE.Group();
    scaled.scale.setScalar(MM);
    scaled.add(this.pc.group);
    this.root.add(scaled);
    this.pc.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.frustumCulled = false; });
    // the colour mask only needs the machine's silhouette: a few boxes, drawn on the colour layer alone
    const proxy = new THREE.Group();
    for (const [w, h, d, x, y, z] of [[396, 96, 330, 0, 53, 0], [216, 34, 200, 0, 118, -33], [322, 250, 41, 0, 260, 75], [316, 236, 200, 0, 258, -40], [165, 160, 44, 0, 240, -192], [460, 34, 181, 0, 18, 259]] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
      m.position.set(x, y, z);
      m.layers.set(COLOUR_LAYER);
      proxy.add(m);
    }
    scaled.add(proxy);
  }

  get reading() { return this.phase !== 'idle'; }
  get open() { return this.phase === 'read'; }

  /** Background pose: behind the tower and to the right, facing the viewer, following the camera height. */
  place(height: number, aspect: number) {
    const portrait = aspect < 1;
    this.root.position.set(portrait ? 0.7 : 3.3 * Math.min(1, aspect / 1.5), height + (portrait ? -3.1 : -2.45), portrait ? -11 : -9.4);
    this.root.rotation.set(0, portrait ? -0.1 : -0.38, 0);
    this.root.updateMatrixWorld(true);
  }

  /** Where the camera stands to read the screen (fits the picture with a margin). */
  readerCamera(camera: THREE.PerspectiveCamera) {
    const centre = this.root.localToWorld(new THREE.Vector3(SCREEN.x * MM, SCREEN.y * MM, SCREEN.z * MM));
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    const t = Math.tan((camera.fov * Math.PI) / 360);
    const d = Math.max((SCREEN.h * MM * 1.22) / 2 / t, (SCREEN.w * MM * 1.12) / 2 / (t * camera.aspect));
    return { pos: centre.clone().addScaledVector(normal, d), look: centre, distance: d };
  }

  /** World matrix of a disk sitting in the drive, `out` of the slot by `s` (0 = fully in, 1 = at the slot). */
  private slotMatrix(s: number) {
    const local = this.pc.disk(s), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    local.decompose(p, q, sc);
    return new THREE.Matrix4().compose(p.multiplyScalar(MM), q, new THREE.Vector3(1, 1, 1)).premultiply(new THREE.Matrix4().compose(this.root.position, this.root.quaternion, new THREE.Vector3(1, 1, 1)));
  }

  insert(n: number, worldMatrix: THREE.Matrix4) {
    if (this.phase !== 'idle') return;
    this.disk = n; this.start.copy(worldMatrix); this.phase = 'fly'; this.t = 0;
    this.view = 'dir'; this.selected = Math.max(0, this.archive.disk(n).written - 1); this.scroll = Math.max(0, this.selected - ROWS + 1);
  }
  eject() { if (this.phase === 'read' || this.phase === 'insert') { this.phase = 'eject'; this.t = 0; } }

  /**
   * Advance the animation. `home` gives the disk's current world matrix in the stack (it turns with the tower).
   * Returns the lifted disk's world matrix and shutter opening while it is out of the stack.
   */
  update(dt: number, home: (n: number) => THREE.Matrix4): { matrix: THREE.Matrix4; open: number } | undefined {
    this.t += dt;
    const target = this.phase === 'idle' || this.phase === 'return' ? 0 : 1;
    this.blend += (target - this.blend) * (1 - Math.exp(-dt * 2.6));
    if (Math.abs(this.blend - target) < 1e-3) this.blend = target;
    let out: { matrix: THREE.Matrix4; open: number } | undefined;
    if (this.disk !== undefined) {
      if (this.phase === 'fly') {
        const e = ease(Math.min(1, this.t / FLY));
        out = { matrix: arc(this.start, this.slotMatrix(1), e, 0.9), open: 0 };
        if (this.t >= FLY) { this.phase = 'insert'; this.t = 0; }
      } else if (this.phase === 'insert') {
        const e = ease(Math.min(1, this.t / INSERT));
        out = { matrix: this.slotMatrix(1 - e), open: e };
        if (this.t >= INSERT) { this.phase = 'read'; this.t = 0; }
      } else if (this.phase === 'read') {
        out = { matrix: this.slotMatrix(0), open: 1 };
      } else if (this.phase === 'eject') {
        const e = ease(Math.min(1, this.t / EJECT));
        out = { matrix: this.slotMatrix(e), open: 1 - e };
        if (this.t >= EJECT) { this.phase = 'return'; this.t = 0; this.start.copy(this.slotMatrix(1)); }
      } else if (this.phase === 'return') {
        const e = ease(Math.min(1, this.t / RETURN));
        out = { matrix: arc(this.start, home(this.disk), e, 0.7), open: 0 };
        if (this.t >= RETURN) { this.phase = 'idle'; this.disk = undefined; out = undefined; }
      }
    }
    this.drawScreen(dt);
    return out;
  }

  /* ---------------------------------------------------------------- screen */
  private drawScreen(dt: number) {
    const clock = this.archive.now();
    this.redraw -= dt;
    if (this.disk !== undefined && this.phase !== 'return') {
      const disk = this.archive.disk(this.disk);
      if (this.phase === 'fly' || this.phase === 'insert') { if (this.redraw <= 0) { this.screen.draw({ mode: 'load', disk, t: this.phase === 'fly' ? this.t / FLY * 0.6 : 0.6 + (this.t / INSERT) * 0.4, clock }); this.redraw = 1 / 20; } return; }
      if (this.redraw > 0) return;
      const slots = this.archive.written(this.disk);
      this.selected = Math.min(this.selected, Math.max(0, slots.length - 1));
      if (this.view === 'entry' && slots[this.selected]) this.screen.draw({ mode: 'entry', disk, slot: slots[this.selected], source: this.play(sourceFor(slots[this.selected].item)), clock });
      else this.screen.draw({ mode: 'dir', disk, slots, selected: this.selected, scroll: this.scroll, clock });
      this.redraw = this.view === 'entry' && this.playing && isPlaying(this.playing) ? 1 / 15 : 0.25;
      return;
    }
    // live: the page being saved and the note typing in the writer window
    const cur = this.archive.current(), disk = this.archive.disk(cur.disk);
    const slot = cur.written > 0 ? this.archive.slot(cur.disk, cur.written - 1) : undefined;
    const key = `${cur.disk}:${cur.written}`;
    if (key !== this.liveKey) { this.liveKey = key; this.liveSince = performance.now(); this.redraw = 0; }
    const typed = slot ? Math.min(1, (performance.now() - this.liveSince) / (slot.note.length * 38 + 400)) : 1;
    if (this.redraw > 0) return;
    const source = slot ? this.play(sourceFor(slot.item)) : undefined;
    this.screen.draw({ mode: 'live', disk, slot, typed, source, clock });
    this.redraw = typed < 1 || (source && isPlaying(source)) ? 1 / 15 : 0.5;
  }

  /** The monitor plays the clip of whatever it shows (and pauses the one it showed before). */
  private playing?: ReturnType<typeof sourceFor>;
  private play(s: ReturnType<typeof sourceFor>) {
    if (s !== this.playing) {
      this.playing?.video?.pause();
      this.playing = s;
      void s.load();
      s.video?.play().catch(() => {});
    }
    return s;
  }

  /** Canvas pixel under a ray on the tube, if it hits. */
  screenPoint(ray: THREE.Raycaster) {
    const mesh = this.pc.screenMesh;
    if (!mesh) return undefined;
    const hit = ray.intersectObject(mesh, false)[0];
    if (!hit?.uv) return undefined;
    return { x: hit.uv.x * SCREEN_PX.w, y: (1 - hit.uv.y) * SCREEN_PX.h };
  }
  hitAt(ray: THREE.Raycaster): Hit | undefined {
    const p = this.screenPoint(ray);
    return p ? this.screen.hitAt(p.x, p.y) : undefined;
  }
  /** Whether a ray touches the machine at all (clicks elsewhere eject). */
  touches(ray: THREE.Raycaster) { return ray.intersectObject(this.pc.group, true).length > 0; }

  /** The slot the reader has selected (for the DOM link and announcements). */
  selection(): Slot | undefined {
    if (this.disk === undefined || this.phase !== 'read') return undefined;
    return this.archive.written(this.disk)[this.selected];
  }
  act(hit: Hit) {
    if (hit.kind === 'row' && hit.index !== undefined) { if (this.view === 'dir' && this.selected === hit.index) this.view = 'entry'; else { this.selected = hit.index; this.view = 'entry'; } }
    else if (hit.kind === 'back') this.view = 'dir';
    else if (hit.kind === 'eject') this.eject();
    else if (hit.kind === 'link') { const s = this.selection(); if (s?.item) window.open(s.item.url, '_blank', 'noopener'); }
    this.redraw = 0;
  }
  key(key: string) {
    if (this.phase !== 'read') return false;
    const n = this.disk === undefined ? 0 : this.archive.written(this.disk).length;
    if (key === 'Escape') { if (this.view === 'entry') this.view = 'dir'; else this.eject(); }
    else if (key === 'ArrowDown') { this.selected = Math.min(n - 1, this.selected + 1); this.view = 'dir'; }
    else if (key === 'ArrowUp') { this.selected = Math.max(0, this.selected - 1); this.view = 'dir'; }
    else if (key === 'Enter') { if (this.view === 'entry') this.act({ kind: 'link' }); else this.view = 'entry'; }
    else if (key === 'Backspace') this.view = 'dir';
    else return false;
    if (this.selected < this.scroll) this.scroll = this.selected;
    if (this.selected >= this.scroll + ROWS) this.scroll = this.selected - ROWS + 1;
    this.redraw = 0;
    return true;
  }
  wheel(dy: number) {
    if (this.phase !== 'read' || this.view !== 'dir' || this.disk === undefined) return;
    const n = this.archive.written(this.disk).length;
    this.scroll = Math.max(0, Math.min(Math.max(0, n - ROWS), this.scroll + Math.sign(dy) * 2));
    this.redraw = 0;
  }
}

/** Interpolate two world matrices along an arc that rises by `lift` world units at the middle. */
function arc(a: THREE.Matrix4, b: THREE.Matrix4, t: number, lift: number) {
  const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), s = new THREE.Vector3(), pb = new THREE.Vector3(), qb = new THREE.Quaternion();
  a.decompose(pa, qa, s); b.decompose(pb, qb, s);
  const p = pa.clone().lerp(pb, t);
  p.y += Math.sin(Math.PI * t) * lift;
  return new THREE.Matrix4().compose(p, qa.slerp(qb, t), new THREE.Vector3(1, 1, 1));
}
