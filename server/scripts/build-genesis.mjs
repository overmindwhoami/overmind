// Resolves the genesis hour (genesis/hour-one.mjs) into items with verified links, excerpts and pictures, and writes
// src/genesis.ts. Run before launch: `npm run genesis`. Prints a line per minute; fails if a reference can't resolve.
import { writeFileSync } from 'node:fs';
import { HOUR_ONE } from '../genesis/hour-one.mjs';

const UA = { 'User-Agent': 'OvermindArchivist/0.3 (genesis build; one request per item)' };
const BROWSER = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36' };
const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const cut = (s, n = 420) => { const t = clean(s); return t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n)) + '…'; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (r.ok) return r.json();
    if ((r.status !== 429 && r.status < 500) || attempt >= 4) throw new Error(`${r.status} ${url}`);
    await sleep(4000 * (attempt + 1)); // rate-limited: wait and try again
  }
}

async function ogImage(url) {
  if (/\.pdf($|\?)/.test(url)) return undefined;
  try {
    const r = await fetch(url, { headers: BROWSER, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return undefined;
    const html = await r.text();
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
    return m ? new URL(m[1].replace(/&amp;/g, '&'), url).href : undefined;
  } catch { return undefined; }
}
async function status(url) {
  try { return (await fetch(url, { headers: BROWSER, redirect: 'follow', signal: AbortSignal.timeout(20000) })).status; } catch { return 0; }
}

async function resolve(e) {
  if (e.wiki) {
    const s = await json(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(e.wiki)}`);
    const img = s.originalimage?.source && (s.originalimage.width ?? 9999) <= 2400 ? s.originalimage.source : s.thumbnail?.source?.replace(/\/\d+px-/, '/960px-');
    return { id: `wikipedia:${s.title}`, source: 'wikipedia', kind: 'lore', title: s.title, year: e.year ?? null, creator: 'Wikipedia', excerpt: cut(s.extract), url: s.content_urls.desktop.page, image: img };
  }
  if (e.arxiv) {
    const xml = await (await fetch(`https://export.arxiv.org/api/query?id_list=${e.arxiv}`, { headers: UA, signal: AbortSignal.timeout(30000) })).text();
    const entry = xml.split('<entry>')[1] ?? '';
    const get = (t) => (entry.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) ?? [])[1] ?? '';
    const names = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
    if (!get('title')) throw new Error(`arXiv ${e.arxiv} not found`);
    return { id: `arxiv:${e.arxiv}`, source: 'arxiv', kind: 'paper', title: clean(get('title')), year: e.year ?? Number(get('published').slice(0, 4)),
      creator: names.length > 1 ? `${names[0]} et al.` : names[0] ?? null, excerpt: cut(get('summary')), url: `https://arxiv.org/abs/${e.arxiv}` };
  }
  if (e.github) {
    const r = await json(`https://api.github.com/repos/${e.github}`);
    return { id: `github:${e.github}${e.url ? `#${e.url.split('/').pop()}` : ''}`, source: 'github', kind: 'code', title: e.title ?? r.full_name,
      year: e.year ?? Number(r.created_at.slice(0, 4)), creator: r.owner.login, url: e.url ?? r.html_url,
      excerpt: cut(`${r.description ?? ''} ${r.stargazers_count ? `· ${r.stargazers_count.toLocaleString('en-US')} stars on GitHub` : ''}`),
      image: `https://opengraph.githubassets.com/1/${e.github}` };
  }
  if (e.archive) {
    const m = (await json(`https://archive.org/metadata/${e.archive}`)).metadata ?? {};
    const kind = { texts: 'manual', software: 'software', movies: 'film', audio: 'radio', collection: 'software' }[m.mediatype] ?? 'text';
    return { id: e.archive, source: 'archive', kind, title: clean(Array.isArray(m.title) ? m.title[0] : m.title).slice(0, 140), year: e.year ?? (Number(String(m.year ?? m.date ?? '').slice(0, 4)) || null),
      creator: clean(Array.isArray(m.creator) ? m.creator[0] : m.creator).slice(0, 80) || null, excerpt: cut(Array.isArray(m.description) ? m.description[0] : m.description), url: `https://archive.org/details/${e.archive}` };
  }
  const w = e.web ?? e.bitcoin ?? e.wayback;
  const source = e.web ? 'web' : e.bitcoin ? 'bitcoin' : 'wayback';
  return { id: e.bitcoin ? 'bitcoin:0' : `${source}:${w.url}`, source, kind: e.bitcoin ? 'chain' : e.wayback ? 'web' : 'lore', title: w.title, year: w.year, creator: w.creator ?? null,
    excerpt: w.excerpt, url: w.url, image: e.web ? await ogImage(w.url) : undefined };
}

const out = [];
for (const [i, e] of HOUR_ONE.entries()) {
  const item = await resolve(e);
  if (!item.excerpt) item.excerpt = '';
  if (!item.image) delete item.image;
  const code = await status(item.url);
  out.push({ item, note: e.note, ...(e.qday ? { qday: e.qday } : {}) });
  console.log(`${String(i + 1).padStart(2)} ${String(code).padEnd(3)} [${item.source}] ${item.title.slice(0, 64)}${item.image ? ' · picture' : ''}${e.qday ? ` · q-day ${e.qday.days}d` : ''}`);
  await sleep(900); // gentle
}
writeFileSync(new URL('../src/genesis.ts', import.meta.url), `// Generated by scripts/build-genesis.mjs from genesis/hour-one.mjs. Do not edit by hand: edit the script and rebuild.
import type { Item } from './db.js';

/** The genesis hour: the first ${out.length} saves of disk 0001, written before launch. */
export const GENESIS: { item: Item; note: string; qday?: { days: number; reason: string } }[] = ${JSON.stringify(out, null, 2)};
`);
console.log(`\nwrote src/genesis.ts (${out.length} saves)`);
