/**
 * Split-flap modules (the $OMD board, docs/reference-room/board): each shows one character as two half flaps, the top
 * half standing above the hinge and the bottom half hanging below it. To change, the module steps through its
 * character drum in order, one flap at a time: the top flap falls toward the viewer, its back carrying the next
 * character's lower half, and lands over the bottom half. Millimetres; a module's origin is its hinge line, centre.
 */
import * as THREE from 'three';
import { roundRect } from './pcParts';

/** The drum's order: a module passes through every character between its current one and its target. */
export const DRUM = ' $ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,+-%:/'; // $ right after blank: the $OMD row turns over at once
const SPLIT = 2.2; // gap at the hinge line (mm)

/** One canvas of glyph cells, all the same size and aspect as the module face that shows them. */
export class FlapAtlas {
  readonly texture: THREE.CanvasTexture;
  readonly cols: number;
  readonly rows: number;
  constructor(readonly w: number, readonly h: number, { cell = 192, weight = 700, size = 0.6, condense = 1, bold = 0 } = {}) {
    this.cols = 8;
    this.rows = Math.ceil(DRUM.length / this.cols);
    const cw = cell, ch = Math.round((cell * h) / w);
    const c = document.createElement('canvas');
    c.width = cw * this.cols; c.height = ch * this.rows;
    const g = c.getContext('2d')!;
    g.fillStyle = '#101010'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#ece7da'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = `${weight} ${Math.round(ch * size)}px Inter, "Helvetica Neue", Arial, sans-serif`;
    const cap = g.measureText('H').actualBoundingBoxAscent;
    for (let i = 0; i < DRUM.length; i++) {
      const x = (i % this.cols) * cw, y = Math.floor(i / this.cols) * ch;
      // a faint print of wear: flaps are matte, slightly lighter toward the edges
      const grd = g.createRadialGradient(x + cw / 2, y + ch / 2, ch * 0.1, x + cw / 2, y + ch / 2, ch * 0.75);
      grd.addColorStop(0, '#0e0e0e'); grd.addColorStop(1, '#191919');
      g.fillStyle = grd; g.fillRect(x + 1, y + 1, cw - 2, ch - 2);
      g.save();
      g.translate(x + cw / 2, y + ch / 2 + cap / 2);
      g.scale(condense, 1);
      g.fillStyle = g.strokeStyle = '#ece7da';
      g.lineWidth = ch * bold; g.lineJoin = 'round';
      g.fillText(DRUM[i], 0, 0);
      if (bold) g.strokeText(DRUM[i], 0, 0);
      g.restore();
    }
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.generateMipmaps = true;
  }
  /** Texture coordinate for glyph `i` at a point of the face (gx, gy in mm, origin at the face centre). */
  uv(i: number, gx: number, gy: number): [number, number] {
    const col = i % this.cols, row = Math.floor(i / this.cols);
    const u = (col + gx / this.w + 0.5) / this.cols;
    const v = 1 - (row + 0.5 - gy / this.h) / this.rows;
    return [u, v];
  }
}

/** A half-face mesh whose texture follows a character: `flip` maps local y to the glyph's lower half (the back of a falling flap). */
class Half {
  readonly mesh: THREE.Mesh;
  private gx: Float32Array;
  private gy: Float32Array;
  private uv: THREE.BufferAttribute;
  char = -1;
  constructor(private atlas: FlapAtlas, upper: boolean, material: THREE.Material, back = false) {
    const { w, h } = atlas, r = Math.min(w, h) * 0.04;
    // the outer corners are round, the hinge edge square
    const y0 = SPLIT / 2, y1 = h / 2;
    const pts = roundRect(w, y1 - y0 + r, r, 0, (y0 - r + y1) / 2).map(([x, y]) => [x, Math.max(y, y0)] as [number, number]);
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, upper ? y : -y)));
    const g = new THREE.ShapeGeometry(shape, 6);
    if (back) { // face −z: reverse winding, and the glyph is read upside down (local y = s shows glyph y = −s)
      const idx = Array.from(g.index!.array);
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    const p = g.getAttribute('position');
    this.gx = new Float32Array(p.count); this.gy = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) { this.gx[i] = p.getX(i); this.gy[i] = back ? -p.getY(i) : p.getY(i); }
    this.uv = g.getAttribute('uv') as THREE.BufferAttribute;
    this.mesh = new THREE.Mesh(g, material);
  }
  show(i: number) {
    if (i === this.char) return;
    this.char = i;
    for (let k = 0; k < this.gx.length; k++) { const [u, v] = this.atlas.uv(i, this.gx[k], this.gy[k]); this.uv.setXY(k, u, v); }
    this.uv.needsUpdate = true;
  }
}

const fall = (t: number) => Math.PI * Math.min(1, t * t * (1.55 - 0.55 * t));

/** One module's visible faces and its flip state. Add `group` to the scene; it sits with its hinge at the origin. */
export class FlapModule {
  readonly group = new THREE.Group();
  readonly meshes: THREE.Mesh[];
  cur = 0;
  target = 0;
  private t = 0;
  private wait = 0;
  private top: Half;
  private bottom: Half;
  private front: Half;
  private back: Half;
  private pivot = new THREE.Group();
  constructor(atlas: FlapAtlas, material: THREE.Material, private dur = 0.085) {
    this.top = new Half(atlas, true, material);
    this.bottom = new Half(atlas, false, material);
    this.front = new Half(atlas, true, material);
    this.back = new Half(atlas, true, material, true);
    this.back.mesh.position.z = -0.25;
    this.pivot.position.z = 0.7;
    this.pivot.add(this.front.mesh, this.back.mesh);
    this.pivot.visible = false;
    this.group.add(this.top.mesh, this.bottom.mesh, this.pivot);
    this.meshes = [this.top.mesh, this.bottom.mesh, this.front.mesh, this.back.mesh];
    this.rest();
  }
  /** Sets the character to flip to (unknown characters show blank). `delay` holds the first flap (a cascade across a row). */
  set(ch: string, delay = 0) {
    const i = Math.max(0, DRUM.indexOf(ch.toUpperCase()));
    if (i === this.target) return;
    if (this.cur === this.target && this.t === 0) this.wait = delay;
    this.target = i;
  }
  /** Shows a character at once, no flipping. */
  jump(ch: string) { this.cur = this.target = Math.max(0, DRUM.indexOf(ch.toUpperCase())); this.t = 0; this.rest(); }
  get busy() { return this.cur !== this.target || this.t > 0; }

  private rest() {
    this.top.show(this.cur); this.bottom.show(this.cur);
    this.pivot.visible = false;
  }
  update(dt: number) {
    if (!this.busy) return;
    if (this.wait > 0) { this.wait -= dt; return; }
    const next = (this.cur + 1) % DRUM.length;
    if (this.t === 0) {
      this.top.show(next); this.bottom.show(this.cur);
      this.front.show(this.cur); this.back.show(next);
      this.pivot.visible = true;
    }
    this.t += dt / this.dur;
    this.pivot.rotation.x = fall(this.t);
    if (this.t >= 1) { this.cur = next; this.t = 0; this.rest(); }
  }
}
