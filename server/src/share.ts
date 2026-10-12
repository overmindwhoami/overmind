/**
 * Share cards: a disk or a coin, as a link that previews on X, Telegram and the rest. overmind.im/d/15 and
 * overmind.im/c/<mint> are routed here (CloudFront sends /d/* and /c/* to this server); each answers with a page whose
 * Open Graph tags carry a 1200×630 picture of that disk or coin, and which sends a person straight on into the room.
 */
import sharp from 'sharp';
import type { DiskRow, SlotRow } from './db.js';
import { MARK } from './mark.js';

const SITE = process.env.PUBLIC_SITE_URL ?? 'https://overmind.im';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(' ', n - 1) > n * 0.6 ? s.lastIndexOf(' ', n - 1) : n - 1)}…`);
/** Wraps text into lines of at most `n` characters (the card's type is monospaced enough for that to hold). */
const wrap = (s: string, n: number, max: number) => {
  const out: string[] = []; let line = '';
  for (const w of s.split(/\s+/)) { const t = line ? `${line} ${w}` : w; if (t.length > n && line) { out.push(line); line = w; } else line = t; if (out.length >= max) break; }
  if (line && out.length < max) out.push(line);
  if (out.length === max && s.length > out.join(' ').length) out[max - 1] = cut(out[max - 1], n - 1);
  return out;
};

/** The page a link previews as: OG tags for crawlers, a redirect for people. */
export function sharePage(o: { title: string; description: string; image: string; to: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}"><meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.description)}">
<meta property="og:image" content="${esc(o.image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(o.to)}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${esc(o.to)}"><link rel="canonical" href="${esc(o.to)}"></head>
<body style="background:#000;color:#f2f2f2;font-family:monospace"><p><a style="color:inherit" href="${esc(o.to)}">${esc(o.title)}</a></p><script>location.replace(${JSON.stringify(o.to)})</script></body></html>`;
}

const frame = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#050505"/><rect x="0.5" y="0.5" width="1199" height="629" fill="none" stroke="#222"/>
<g transform="translate(64 54) scale(${(36 / MARK.rows).toFixed(3)})" fill="#f2f2f2" shape-rendering="crispEdges">${MARK.cells}</g>
<text x="${64 + Math.round((36 / MARK.rows) * MARK.cols) + 20}" y="84" font-family="Menlo, monospace" font-size="30" font-weight="700" letter-spacing="6" fill="#f2f2f2">OVERMIND</text>
<text x="1136" y="84" font-family="Menlo, monospace" font-size="22" fill="#8a8a8a" text-anchor="end">overmind.im</text>
${inner}
<text x="64" y="582" font-family="Menlo, monospace" font-size="22" fill="#8a8a8a">the record that survives q-day</text></svg>`;

/** A sealed (or writing) disk's card: its number, how full, its fingerprint, and its latest save with the note. */
export async function diskCard(d: DiskRow, slots: SlotRow[]): Promise<Buffer> {
  const name = `DISK ${String(d.n + 1).padStart(4, '0')}`;
  const last = [...slots].reverse().find((s) => s.item) ?? slots[slots.length - 1];
  const title = last?.item?.title ?? 'nothing came through';
  const note = wrap(last?.note ?? '', 52, 3);
  const inner = `
<text x="64" y="200" font-family="Menlo, monospace" font-size="92" font-weight="700" fill="#f2f2f2">${esc(name)}</text>
<text x="64" y="252" font-family="Menlo, monospace" font-size="26" fill="#8a8a8a">${d.sealed_at ? `sealed · sha256 ${esc((d.fingerprint ?? '').slice(0, 24))}…` : `writing now · ${d.written} of 90`}</text>
<rect x="64" y="284" width="${Math.round((Math.min(90, d.written) / 90) * 1072)}" height="6" fill="#f2f2f2"/><rect x="64" y="284" width="1072" height="6" fill="none" stroke="#333"/>
<text x="64" y="356" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="#f2f2f2">${esc(cut(title, 56))}</text>
${note.map((l, i) => `<text x="64" y="${404 + i * 38}" font-family="Menlo, monospace" font-size="27" fill="#cfcfcf">${i === 0 ? '&gt; ' : '  '}${esc(l)}</text>`).join('')}`;
  return sharp(Buffer.from(frame(inner))).png().toBuffer();
}

/** A coin's card: its picture, ticker and name, and the Overmind's note on it. */
export async function coinCard(c: { ticker: string; name: string; note: string | null; holders: number | null }, picture?: Buffer): Promise<Buffer> {
  const note = wrap(c.note ?? 'its disk is on my wall.', 40, 4);
  const inner = `
<rect x="64" y="140" width="300" height="300" fill="#1a1a1a"/>
<text x="400" y="220" font-family="Helvetica, Arial, sans-serif" font-size="76" font-weight="700" fill="#f2f2f2">$${esc(cut(c.ticker, 10))}</text>
<text x="400" y="268" font-family="Menlo, monospace" font-size="28" fill="#8a8a8a">${esc(cut(c.name, 40))}${c.holders ? ` · ${c.holders} holders, sealed` : ''}</text>
${note.map((l, i) => `<text x="400" y="${334 + i * 38}" font-family="Menlo, monospace" font-size="27" fill="#cfcfcf">${i === 0 ? '&gt; ' : '  '}${esc(l)}</text>`).join('')}`;
  const base = sharp(Buffer.from(frame(inner)));
  if (!picture) return base.png().toBuffer();
  const pic = await sharp(picture).resize(300, 300, { fit: 'cover' }).png().toBuffer().catch(() => undefined);
  return pic ? base.composite([{ input: pic, left: 64, top: 140 }]).png().toBuffer() : base.png().toBuffer();
}

export const shareUrls = { site: SITE };
