/** Procedural surface textures for the floppy (generated once at load, deterministic). */
import * as THREE from 'three';

export function rng(seed: number) {
  let s = seed >>> 0;
  return (a = 0, b = 1) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return a + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (b - a);
  };
}

function dataTexture(data: Uint8Array, w: number, h: number, srgb = false) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Tiling height field → tangent-space normal map (+y up). */
function normalsFrom(height: Float32Array, w: number, h: number, strength: number) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = y * w, up = ((y + 1) % h) * w, down = ((y + h - 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const right = x + 1 < w ? x + 1 : 0, left = x > 0 ? x - 1 : w - 1;
      const dx = (height[row + right] - height[row + left]) * strength, dy = (height[up + x] - height[down + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (row + x) * 4;
      out[i] = (0.5 - dx * inv * 0.5) * 255; out[i + 1] = (0.5 - dy * inv * 0.5) * 255; out[i + 2] = (0.5 + inv * 0.5) * 255; out[i + 3] = 255;
    }
  }
  return out;
}

/** Adds a Gaussian bump (radius r px) at integer centre (cx, cy), wrapping. Kernels are cached per 0.1 px of radius. */
const kernels = new Map<number, { R: number; k: Float32Array }>();
function splat(height: Float32Array, w: number, h: number, cx: number, cy: number, r: number, amp: number) {
  const key = Math.round(r * 10);
  let ker = kernels.get(key);
  if (!ker) {
    const rr = key / 10, R = Math.ceil(rr * 2.2), k = new Float32Array((2 * R + 1) ** 2);
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) k[(y + R) * (2 * R + 1) + x + R] = Math.exp(-(x * x + y * y) / (rr * rr));
    ker = { R, k }; kernels.set(key, ker);
  }
  const { R, k } = ker, D = 2 * R + 1, x0 = Math.floor(cx), y0 = Math.floor(cy);
  for (let y = -R; y <= R; y++) {
    const row = ((y0 + y + h) % h) * w;
    for (let x = -R; x <= R; x++) height[row + ((x0 + x + w) % w)] += amp * k[(y + R) * D + x + R];
  }
}

/** Moulded ABS stipple: dense small grains with a few larger ones. */
export function stippleTexture(size = 512, seed = 3501) {
  const r = rng(seed), H = new Float32Array(size * size);
  for (let i = 0; i < (size * size) / 26; i++) splat(H, size, size, r(0, size), r(0, size), r(1.6, 3.2), r(0.35, 1));
  for (let i = 0; i < (size * size) / 420; i++) splat(H, size, size, r(0, size), r(0, size), r(3.4, 5.2), r(0.4, 0.9));
  return dataTexture(normalsFrom(H, size, size, 0.55), size, size);
}

/** Brushed stainless: long streaks along u. Returns a normal map and a roughness map (green channel). */
export function brushedTextures(w = 512, h = 256, seed = 7101) {
  const r = rng(seed), H = new Float32Array(w * h), R = new Float32Array(w * h);
  for (let i = 0; i < 2600; i++) {
    const y = Math.floor(r(0, h)), x0 = Math.floor(r(0, w)), len = Math.floor(r(0.1, 0.9) * w), amp = r(-1, 1) * (r() < 0.08 ? 2.2 : 0.7);
    const rows = r() < 0.15 ? [y, (y + 1) % h] : [y];
    for (const yy of rows) {
      const row = yy * w;
      for (let k = 0; k < len; k++) { // triangular envelope: fades in and out along the stroke
        const env = 1 - Math.abs((2 * k) / len - 1), i2 = row + ((x0 + k) % w);
        H[i2] += amp * env; R[i2] += (amp < 0 ? -amp : amp) * env;
      }
    }
  }
  // sparse fine scratches at random angles (handling wear)
  for (let i = 0; i < 40; i++) {
    const x0 = r(0, w), y0 = r(0, h), a = r(-0.5, 0.5) + (r() < 0.5 ? 0 : Math.PI / 2), len = r(10, 80), amp = r(0.8, 2);
    for (let k = 0; k < len; k++) { const x = Math.floor(x0 + Math.cos(a) * k + w) % w, y = Math.floor(y0 + Math.sin(a) * k + h) % h; H[y * w + x] -= amp; R[y * w + x] += amp * 0.6; }
  }
  const rough = new Uint8Array(w * h * 4);
  let max = 0; for (const v of R) max = Math.max(max, v);
  for (let i = 0; i < w * h; i++) { const v = 150 + (R[i] / max) * 105; rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = v; rough[i * 4 + 3] = 255; }
  return { normal: dataTexture(normalsFrom(H, w, h, 0.35), w, h), roughness: dataTexture(rough, w, h) };
}

/** Anisotropy direction map for turned or spun surfaces: tangential direction around the uv origin (0.5, 0.5). */
export function circularAnisotropy(size = 256) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size - 0.5, v = (y + 0.5) / size - 0.5, l = Math.hypot(u, v) || 1, i = (y * size + x) * 4;
    d[i] = ((-v / l) * 0.5 + 0.5) * 255; d[i + 1] = ((u / l) * 0.5 + 0.5) * 255; d[i + 2] = 255; d[i + 3] = 255;
  }
  const t = dataTexture(d, size, size);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

/** Turned rings (hub) or spun sheen (media): concentric bumps around the uv origin. */
export function ringNormals(size = 512, rings = 90, seed = 1209) {
  const r = rng(seed), H = new Float32Array(size * size);
  const bands = Array.from({ length: rings }, () => ({ at: r(0, 0.5), w: r(0.0008, 0.004), a: r(-1, 1) }));
  // radial profile once, then look it up per pixel
  const N = 4096, profile = new Float32Array(N + 1);
  for (let k = 0; k <= N; k++) { const d = (k / N) * 0.75; let v = 0; for (const b of bands) v += b.a * Math.exp(-(((d - b.at) / b.w) ** 2)); profile[k] = v; }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const f = (Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) / 0.75) * N, k = Math.floor(f);
    H[y * size + x] = profile[k] + (profile[Math.min(k + 1, N)] - profile[k]) * (f - k);
  }
  const t = dataTexture(normalsFrom(H, size, size, 2.5), size, size);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Non-woven rayon liner: a fine felt of short fibres with soft density mottling (photo 08). */
export function linerTexture(size = 512, seed = 4404) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = rng(seed);
  g.fillStyle = '#8c8c8c';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 105; i++) { // density mottling
    const x = r(0, size), y = r(0, size), rad = r(5, 23);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const v = r() < 0.55 ? 255 : 0;
    grad.addColorStop(0, `rgba(${v},${v},${v},${r(0.02, 0.06)})`); grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grad;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) g.fillRect(x - rad + ox, y - rad + oy, rad * 2, rad * 2);
  }
  g.lineCap = 'round';
  for (let i = 0; i < 6500; i++) { // fibres
    const x = r(0, size), y = r(0, size), a = r(0, Math.PI * 2), len = r(2.5, 9), v = r() < 0.75 ? 220 : 60;
    g.strokeStyle = `rgba(${v},${v},${v},${r(0.05, 0.18)})`; g.lineWidth = r(0.35, 0.9);
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + r(-0.7, 0.7)) * len * 0.5, y + Math.sin(a + r(-0.7, 0.7)) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Matte paper tooth for labels (normal map). */
export function paperNormals(size = 256, seed = 8811) {
  const r = rng(seed), H = new Float32Array(size * size);
  for (let i = 0; i < size * 30; i++) {
    const x = r(0, size), y = r(0, size), a = r(0, Math.PI), len = r(3, 14), amp = r(-0.4, 0.4);
    for (let k = 0; k < len; k++) { const px = Math.floor(x + Math.cos(a) * k + size) % size, py = Math.floor(y + Math.sin(a) * k + size) % size; H[py * size + px] += amp; }
  }
  return dataTexture(normalsFrom(H, size, size, 0.6), size, size);
}

/**
 * Moulded marks on both faces as a height-derived normal map; alpha = stipple mask (marks are polished smooth).
 * Layout matches the shell's decal uv: left half Side 1, right half Side 0 (mirrored so it reads from Side 0).
 */
export function faceDecal(px = 1024, mm = { w: 90, h: 94 }) {
  const c = document.createElement('canvas');
  c.width = px * 2; c.height = px;
  const g = c.getContext('2d', { willReadFrequently: true })!; // CPU-backed: read back below
  g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, c.width, c.height);
  const sx = px / mm.w, sy = px / mm.h;
  /** Draw in model millimetres on one face (side 1 or 0), y up. */
  const on = (side: 1 | 0, draw: () => void) => {
    face = side;
    g.save();
    g.translate(side ? px / 2 : px + px / 2, px / 2);
    g.scale(side ? sx : -sx, -sy);
    draw();
    g.restore();
  };
  const raised = 'rgb(235,235,235)', sunk = 'rgb(40,40,40)';
  let face: 1 | 0 = 1;
  const text = (t: string, x: number, y: number, size: number, weight = 700, ls = 0) => {
    g.save(); g.translate(x, y); g.scale(face ? 1 : -1, -1); // Side 0 is read from behind
    g.font = `${weight} ${size}px Inter, "Helvetica Neue", Arial, sans-serif`; g.letterSpacing = `${ls}px`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t, 0, 0); g.restore();
  };
  on(1, () => {
    // insertion arrow
    g.fillStyle = raised;
    g.beginPath(); g.moveTo(-40.5, 41.6); g.lineTo(-38.3, 38.4); g.lineTo(-39.7, 38.4); g.lineTo(-39.7, 33.6); g.lineTo(-41.3, 33.6); g.lineTo(-41.3, 38.4); g.lineTo(-42.7, 38.4); g.closePath(); g.fill();
    // density mark: outlined "HD" in a ring (original)
    g.strokeStyle = raised; g.lineWidth = 0.32;
    g.beginPath(); g.arc(34.8, 37.6, 4.2, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(34.8, 37.6, 3.6, 0, Math.PI * 2); g.stroke();
    g.fillStyle = raised; text('HD', 34.8, 37.4, 3.4, 700, 0.1);
  });
  on(0, () => {
    // plaque with raised lettering (like a moulded country-of-origin mark)
    g.fillStyle = sunk;
    g.beginPath(); g.roundRect(-36, -29.6, 26, 3.4, 1.7); g.fill();
    g.fillStyle = raised; text('REPLICATED ON-CHAIN', -23, -27.9, 1.85, 600, 0.12);
    // write-protect legends beside the slider slot (slot at x −40): padlock closed / open
    const lock = (x: number, y: number, open: boolean) => {
      g.fillStyle = raised; g.fillRect(x - 1.1, y - 1.4, 2.2, 1.7);
      g.strokeStyle = raised; g.lineWidth = 0.35;
      g.beginPath(); g.arc(x + (open ? 0.9 : 0), y + 0.35, 0.75, Math.PI, 0, true); g.stroke();
    };
    lock(-35.4, -37.4, false);
    lock(-35.4, -42.6, true);
    g.fillStyle = raised; g.beginPath(); g.moveTo(-35.4, -39.4); g.lineTo(-34.6, -40.4); g.lineTo(-36.2, -40.4); g.closePath(); g.fill();
    text('2HD', 30.5, 24, 2.6, 700, 0.15);
  });
  // Normals only where marks are: the face is flat almost everywhere, so work in 64 px tiles and skip flat ones.
  const W = c.width, H = c.height, T = 64, nrm = new Uint8Array(W * H * 4);
  new Uint32Array(nrm.buffer).fill(0xffff8080); // flat normal (128, 128, 255), alpha 255
  const src = g.getImageData(0, 0, W, H).data;
  const at = (x: number, y: number) => src[((H - 1 - Math.min(Math.max(y, 0), H - 1)) * W + Math.min(Math.max(x, 0), W - 1)) * 4]; // texture row 0 = canvas bottom
  const tile = new Float32Array((T + 2) * (T + 2));
  for (let ty = 0; ty < H; ty += T) for (let tx = 0; tx < W; tx += T) {
    let flat = true;
    for (let y = ty - 1; y <= ty + T && flat; y++) for (let x = tx - 1; x <= tx + T; x++) if (at(x, y) !== 128) { flat = false; break; }
    if (flat) continue;
    for (let y = 0; y < T + 2; y++) for (let x = 0; x < T + 2; x++) tile[y * (T + 2) + x] = at(tx + x - 1, ty + y - 1) / 255;
    const n = normalsFrom(tile, T + 2, T + 2, 3.2);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const si = (y + 1) * (T + 2) + x + 1, di = ((ty + y) * W + tx + x) * 4, v = tile[si];
      nrm[di] = n[si * 4]; nrm[di + 1] = n[si * 4 + 1]; nrm[di + 2] = n[si * 4 + 2];
      nrm[di + 3] = Math.abs(v - 0.5) > 0.08 ? 0 : 255; // marks are polished: no stipple
    }
  }
  const t = dataTexture(nrm, W, H);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
