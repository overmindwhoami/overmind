/**
 * What the instrument looks through: one media source per target, exactly as the reference handles project media.
 *   image     a 640 × 360 canvas until the item's still is decoded, then the still itself
 *   video     a muted, looping, inline clip (preload=metadata) that plays only while its target is locked
 *   pixels    a 28 × 16 copy for the pixel fill, luminance a 96 × 54 sample for the ASCII fill; both follow the
 *             video frame by frame while it plays
 * Items without a picture get the reference's card: the name in 700 92px capitals on black, the source below.
 * Every box of the instrument is a window onto this one shared picture.
 */
import type { Item } from '../archive/types';

export const MEDIA = { still: { width: 640, height: 360 }, sample: { width: 96, height: 54 }, pixels: { width: 28, height: 16 } } as const;
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export interface Source {
  image: HTMLCanvasElement | HTMLImageElement;
  video?: HTMLVideoElement;
  pixels: HTMLCanvasElement;
  pixelsContext: CanvasRenderingContext2D;
  sample: CanvasRenderingContext2D;
  luminance: Float32Array;
  isBright: boolean;
  state: 'idle' | 'loading' | 'ready';
  load: () => Promise<void>;
}

function canvas(w: number, h: number, opts?: CanvasRenderingContext2DSettings) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', opts);
  if (!ctx) throw new Error('2D canvas is required for the instrument media.');
  return { canvas: c, context: ctx };
}

/** The reference's card for media-less entries: black, the name set large in capitals, the source underneath. */
function card(g: CanvasRenderingContext2D, name: string, client: string) {
  const { width: W, height: H } = MEDIA.still;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff'; g.textBaseline = 'top'; g.font = `700 92px ${SANS}`;
  let line = '', y = 36;
  for (const word of name.toUpperCase().split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > W - 64 && line) { g.fillText(line, 32, y); line = word; y += 92; } else line = next;
  }
  g.fillText(line, 32, y);
  g.font = `500 22px ${SANS}`;
  g.fillText(client.toUpperCase(), 34, H - 56);
}

function measure(sample: CanvasRenderingContext2D, out: Float32Array) {
  const { data } = sample.getImageData(0, 0, MEDIA.sample.width, MEDIA.sample.height);
  for (let i = 0; i < out.length; i++) out[i] = ((data[i * 4] ?? 0) * 0.2126 + (data[i * 4 + 1] ?? 0) * 0.7152 + (data[i * 4 + 2] ?? 0) * 0.0722) / 255;
}
export const isPlaying = (s: Source) => !!s.video && s.video.readyState >= 2 && !s.video.paused;
/** While the clip plays, the pixel and ASCII fills follow it frame by frame. */
export function follow(s: Source) {
  if (!s.video || !isPlaying(s)) return;
  s.pixelsContext.drawImage(s.video, 0, 0, MEDIA.pixels.width, MEDIA.pixels.height);
  s.sample.drawImage(s.video, 0, 0, MEDIA.sample.width, MEDIA.sample.height);
  measure(s.sample, s.luminance);
}
function analyse(s: Source) {
  s.pixelsContext.drawImage(s.image, 0, 0, MEDIA.pixels.width, MEDIA.pixels.height);
  s.sample.drawImage(s.image, 0, 0, MEDIA.sample.width, MEDIA.sample.height);
  measure(s.sample, s.luminance);
  s.isBright = s.luminance.reduce((a, b) => a + b, 0) / s.luminance.length > 0.55;
}

/** The source line under a card: who made it, or where it lives. */
export const clientOf = (item: Item | undefined) =>
  !item ? 'Nothing came through' : item.creator ?? (item.source === 'arxiv' ? 'arXiv' : item.source === 'wayback' ? 'Wayback Machine' : 'Internet Archive');

const cache = new Map<string, Source>();
/** The source for an item (one per item, reused). `undefined` gives the empty-slot card, or `card` when given. */
export function sourceFor(item: Item | undefined, card_?: { key: string; name: string; client: string }): Source {
  const still = item?.media ?? item?.thumb;
  // keyed on the media too: a live item's still and loop arrive a little after the item itself
  const key = item ? `${item.id}|${still ?? ''}|${item.clip ?? ''}` : card_?.key ?? '__empty__';
  const hit = cache.get(key);
  if (hit) return hit;
  const blank = canvas(MEDIA.still.width, MEDIA.still.height);
  if (still) { blank.context.fillStyle = '#000'; blank.context.fillRect(0, 0, MEDIA.still.width, MEDIA.still.height); }
  else card(blank.context, item?.title ?? card_?.name ?? 'Nothing came through', item ? clientOf(item) : card_?.client ?? clientOf(item));
  const pixels = canvas(MEDIA.pixels.width, MEDIA.pixels.height);
  const sample = canvas(MEDIA.sample.width, MEDIA.sample.height, { willReadFrequently: true });
  let loading: Promise<void> | undefined;
  const s: Source = {
    image: blank.canvas, isBright: false, luminance: new Float32Array(MEDIA.sample.width * MEDIA.sample.height),
    pixels: pixels.canvas, pixelsContext: pixels.context, sample: sample.context, state: still ? 'idle' : 'ready',
    video: item?.clip ? video(item.clip) : undefined,
    load: () => {
      if (!still) return Promise.resolve();
      loading ??= (async () => {
        s.state = 'loading';
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous'; // remote media is served with CORS, so the fills can read its pixels
          img.src = still;
          await img.decode();
          s.image = img;
          analyse(s);
        } catch { /* keep the black still */ }
        s.state = 'ready';
      })();
      return loading;
    },
  };
  analyse(s);
  cache.set(key, s);
  return s;
}
function video(src: string) {
  const v = document.createElement('video');
  v.loop = true; v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.crossOrigin = 'anonymous'; v.src = src;
  return v;
}

/** The reference streams its media one item at a time in the background; this does the same for what is near. */
const waiting: Source[] = [];
let streaming = false;
export function preload(s: Source) {
  if (s.state !== 'idle' || waiting.includes(s)) return;
  waiting.push(s);
  if (streaming) return;
  streaming = true;
  void (async () => {
    while (waiting.length) await waiting.shift()!.load();
    streaming = false;
  })();
}
