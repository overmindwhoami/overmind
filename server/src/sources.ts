/**
 * Where the Overmind looks each minute. The dice pick a "lens", the lens asks one source for a handful of candidates,
 * and items already saved are filtered out. A modest number of requests per round (the Archive is a nonprofit).
 *   archive    a collection of the Internet Archive (software, magazines, manuals, radio, films, newsletters, texts)
 *   onthisday  Archive items dated to today's month and day in a past year
 *   qday       recent arXiv papers on quantum computing and the cryptography it threatens
 *   wayback    an old capture of a web page that mattered, from the Wayback Machine
 */
import type { Item } from './db.js';
import { isSeen } from './db.js';

const UA = { 'User-Agent': 'OvermindArchivist/0.2 (one request a minute; contact via the project site)' };
type Rand = () => number;
const pick = <T,>(r: Rand, list: readonly T[]) => list[Math.floor(r() * list.length)];

const COLLECTIONS: { q: string; kind: string; pages: number }[] = [
  { q: 'collection:softwarelibrary_msdos_games AND mediatype:software', kind: 'software', pages: 40 },
  { q: 'collection:softwarelibrary_msdos AND mediatype:software', kind: 'software', pages: 20 },
  { q: 'collection:softwarelibrary_mac AND mediatype:software', kind: 'software', pages: 15 },
  { q: 'collection:softwarelibrary_apple AND mediatype:software', kind: 'software', pages: 15 },
  { q: 'collection:softwarelibrary_c64 AND mediatype:software', kind: 'software', pages: 15 },
  { q: 'collection:tucows AND mediatype:software', kind: 'software', pages: 20 },
  { q: 'collection:computermagazines AND mediatype:texts', kind: 'magazine', pages: 60 },
  { q: 'collection:manuals AND mediatype:texts', kind: 'manual', pages: 40 },
  { q: 'collection:newsletters AND mediatype:texts', kind: 'newsletter', pages: 20 },
  { q: 'collection:oldtimeradio AND mediatype:audio', kind: 'radio', pages: 30 },
  { q: 'collection:prelinger AND mediatype:movies', kind: 'film', pages: 30 },
  { q: 'collection:bitsavers AND mediatype:texts', kind: 'manual', pages: 20 },
  { q: 'mediatype:texts AND subject:(cryptography OR cipher OR codes)', kind: 'text', pages: 10 },
];
const WAYBACK: [string, string][] = [
  ['bitcoin.org', 'Bitcoin P2P e-cash, the original site'], ['www.geocities.com', 'GeoCities'], ['www.yahoo.com', 'Yahoo! directory'],
  ['www.google.com', 'Google search'], ['www.archive.org', 'The Internet Archive'], ['www.cern.ch', 'CERN'], ['www.nasa.gov', 'NASA'],
  ['www.slashdot.org', 'Slashdot'], ['www.metafilter.com', 'MetaFilter'], ['www.wikipedia.org', 'Wikipedia'], ['www.napster.com', 'Napster'],
  ['www.altavista.com', 'AltaVista'], ['www.netscape.com', 'Netscape'], ['www.space-jam.com', 'Space Jam'], ['www.cypherpunks.to', 'Cypherpunks'],
  ['www.metzdowd.com', 'The cryptography mailing list'], ['www.mozilla.org', 'Mozilla'], ['www.eff.org', 'Electronic Frontier Foundation'],
  ['www.w3.org', 'W3C'], ['www.hotwired.com', 'HotWired'], ['www.theonion.com', 'The Onion'], ['www.ebay.com', 'eBay'], ['www.amazon.com', 'Amazon'],
];

const clean = (s: unknown) => String(Array.isArray(s) ? s[0] : s ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const excerpt = (s: unknown, n = 420) => { const t = clean(s); return t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n)) + '…'; };
const yearOf = (d: { year?: unknown; date?: unknown }) => { const y = Number(String(d.year ?? d.date ?? '').slice(0, 4)); return y > 1000 && y < 2100 ? y : null; };

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

type Doc = { identifier: string; title?: unknown; description?: unknown; creator?: unknown; year?: unknown; date?: unknown };
const fromDoc = (d: Doc, kind: string): Item => ({
  id: d.identifier, source: 'archive', kind, title: clean(d.title).slice(0, 140), year: yearOf(d), creator: clean(d.creator).slice(0, 80) || null,
  excerpt: excerpt(d.description), url: `https://archive.org/details/${d.identifier}`,
});
async function search(q: string, rows: number, page: number, sort = 'downloads desc'): Promise<Doc[]> {
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=description&fl[]=creator&fl[]=year&fl[]=date&rows=${rows}&page=${page}&sort[]=${encodeURIComponent(sort)}&output=json`;
  return (await json<{ response?: { docs?: Doc[] } }>(url)).response?.docs ?? [];
}

async function archive(r: Rand): Promise<Item[]> {
  const c = pick(r, COLLECTIONS);
  const docs = await search(c.q, 30, 1 + Math.floor(r() * c.pages));
  return docs.filter((d) => d.title).map((d) => fromDoc(d, c.kind));
}

async function onThisDay(r: Rand, now: Date): Promise<Item[]> {
  const md = now.toISOString().slice(5, 10);
  for (let tries = 0; tries < 3; tries++) {
    const year = 1925 + Math.floor(r() * 85);
    const q = `date:[${year}-${md} TO ${year}-${md}] AND mediatype:(texts OR audio OR movies) AND -collection:(podcasts OR opensource_audio)`;
    const docs = await search(q, 25, 1);
    const items = docs.filter((d) => d.title).map((d) => fromDoc(d, 'onthisday'));
    if (items.length) return items;
  }
  return [];
}

async function qday(r: Rand): Promise<Item[]> {
  const queries = [
    'cat:quant-ph AND abs:"post-quantum"', 'cat:cs.CR AND abs:quantum', 'abs:"Shor" AND abs:"elliptic"', 'abs:"logical qubits"',
    'abs:"quantum error correction" AND abs:"threshold"', 'abs:"hash-based signature"', 'abs:"lattice" AND abs:"cryptography" AND abs:quantum',
  ];
  const q = pick(r, queries);
  const res = await fetch(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&max_results=25&sortBy=submittedDate&sortOrder=descending`,
    { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`arXiv ${res.status}`);
  const xml = await res.text();
  return xml.split('<entry>').slice(1).map((e) => {
    const get = (tag: string) => (e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [])[1] ?? '';
    const id = get('id').trim().replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
    return {
      id: `arxiv:${id}`, source: 'arxiv' as const, kind: 'paper', title: clean(get('title')).slice(0, 160), year: Number(get('published').slice(0, 4)) || null,
      creator: clean((e.match(/<name>([^<]+)<\/name>/) ?? [])[1]) || null, excerpt: excerpt(get('summary')), url: `https://arxiv.org/abs/${id}`,
    };
  }).filter((i) => i.title);
}

async function wayback(r: Rand): Promise<Item[]> {
  const out: Item[] = [];
  for (let i = 0; i < 3; i++) {
    const [site, title] = pick(r, WAYBACK);
    const year = 1996 + Math.floor(r() * 14);
    const d = await json<{ archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string } } }>(
      `https://archive.org/wayback/available?url=${encodeURIComponent(site)}&timestamp=${year}0601`);
    const c = d.archived_snapshots?.closest;
    if (!c?.available || !c.url || !c.timestamp) continue;
    const y = Number(c.timestamp.slice(0, 4)), date = `${c.timestamp.slice(0, 4)}-${c.timestamp.slice(4, 6)}-${c.timestamp.slice(6, 8)}`;
    out.push({ id: `wayback:${site}:${c.timestamp.slice(0, 8)}`, source: 'wayback', kind: 'web', title, year: y, creator: site,
      excerpt: `${site} as the Wayback Machine captured it on ${date}.`, url: c.url.replace(/^http:/, 'https:') });
  }
  return out;
}

const LENSES = [
  { name: 'archive', w: 0.5, run: (r: Rand) => archive(r) },
  { name: 'onthisday', w: 0.18, run: (r: Rand, now: Date) => onThisDay(r, now) },
  { name: 'qday', w: 0.17, run: (r: Rand) => qday(r) },
  { name: 'wayback', w: 0.15, run: (r: Rand) => wayback(r) },
] as const;

/** Up to `n` unseen candidates from the lens the dice choose (falls back to the archive lens once). */
export async function candidates(r: Rand, now: Date, n = 7): Promise<{ lens: string; items: Item[] }> {
  let u = r(), lens: (typeof LENSES)[number] = LENSES[0];
  for (const l of LENSES) { if (u < l.w) { lens = l; break; } u -= l.w; }
  for (const l of [lens, LENSES[0]]) {
    try {
      const found = await l.run(r, now);
      const seen = await isSeen(found.map((i) => i.id));
      const fresh = found.filter((i) => !seen.has(i.id));
      for (let i = fresh.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [fresh[i], fresh[j]] = [fresh[j], fresh[i]]; }
      if (fresh.length) return { lens: l.name, items: fresh.slice(0, n) };
    } catch (e) { console.warn('lens failed', l.name, String(e).slice(0, 160)); }
  }
  return { lens: lens.name, items: [] };
}
