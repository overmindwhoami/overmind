/**
 * Where the Overmind looks each minute. The dice pick a "lens", the lens asks one source for a handful of candidates,
 * and items already saved are filtered out. One or two requests per round, to sources that need no key.
 *
 * The heart of it (the brief's "Internet Archive" and its neighbours):
 *   archive     an Internet Archive collection: old floppy software, magazines, manuals, radio, films, newsletters
 *   onthisday   Archive items dated to today's month and day in a past year
 *   wayback     an old capture of a web page that mattered (Wayback Machine)
 *   wikipedia   Wikipedia's "on this day": events on today's date, with the article's picture
 *   loc         Library of Congress, Chronicling America: a newspaper printed on today's date a century or so ago
 *   gutenberg   a book Project Gutenberg released today
 * Q-Day watch:
 *   arxiv       recent arXiv papers on quantum computing and the cryptography it threatens
 *   eprint      new cryptography papers on the IACR ePrint archive
 *   news        quantum and post-quantum stories people are discussing (Hacker News)
 *   bitcoin     the newest Bitcoin block: every coin spent reveals the public key that guarded it
 *   solana      the last minute on Solana, where every address is its public key from birth
 *   github      post-quantum code people are writing right now (repositories pushed this month)
 * Flavour:
 *   noaa        space weather alerts (solar storms really do flip bits), with today's picture of the sun
 * The first few disks lean into the lore: more Q-Day watch, GitHub, and a lore lens of floppy and cryptography history.
 */
import type { Item, Source } from './db.js';
import { isSeen } from './db.js';

const UA = { 'User-Agent': 'OvermindArchivist/0.3 (one request a minute; a public archive of things worth keeping)' };
type Rand = () => number;
const pick = <T,>(r: Rand, list: readonly T[]) => list[Math.floor(r() * list.length)];

const clean = (s: unknown) => String(Array.isArray(s) ? s[0] : s ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&[a-z#0-9]+;/g, ' ')
  .replace(/\s+/g, ' ').trim();
const excerpt = (s: unknown, n = 420) => { const t = clean(s); return t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n)) + '…'; };
const yearOf = (d: { year?: unknown; date?: unknown }) => { const y = Number(String(d.year ?? d.date ?? '').slice(0, 4)); return y > 1000 && y < 2100 ? y : null; };
const fmt = (n: number) => n.toLocaleString('en-US');
const mmdd = (now: Date) => now.toISOString().slice(5, 10);

async function get(url: string, timeout = 15_000) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}
const json = async <T,>(url: string, timeout?: number) => (await get(url, timeout)).json() as Promise<T>;
const text = async (url: string, timeout?: number) => (await get(url, timeout)).text();
/** <item> or <entry> blocks of an RSS/Atom feed, with a tag reader. */
const feed = (xml: string, tag = 'item') => xml.split(`<${tag}>`).slice(1).map((e) => ({
  get: (t: string) => (e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) ?? [])[1] ?? '',
  all: (t: string) => [...e.matchAll(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'g'))].map((m) => m[1]),
}));

// ——— the Internet Archive ———
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
  return (await search(c.q, 30, 1 + Math.floor(r() * c.pages))).filter((d) => d.title).map((d) => fromDoc(d, c.kind));
}
async function onThisDay(r: Rand, now: Date): Promise<Item[]> {
  const md = mmdd(now);
  for (let tries = 0; tries < 2; tries++) {
    const year = 1925 + Math.floor(r() * 85);
    const q = `date:[${year}-${md} TO ${year}-${md}] AND mediatype:(texts OR audio OR movies) AND -collection:(podcasts OR opensource_audio)`;
    const items = (await search(q, 25, 1)).filter((d) => d.title).map((d) => fromDoc(d, 'onthisday'));
    if (items.length) return items;
  }
  return [];
}

const WAYBACK: [string, string][] = [
  ['bitcoin.org', 'Bitcoin P2P e-cash, the original site'], ['www.geocities.com', 'GeoCities'], ['www.yahoo.com', 'Yahoo! directory'],
  ['www.google.com', 'Google search'], ['www.archive.org', 'The Internet Archive'], ['www.cern.ch', 'CERN'], ['www.nasa.gov', 'NASA'],
  ['www.slashdot.org', 'Slashdot'], ['www.metafilter.com', 'MetaFilter'], ['www.wikipedia.org', 'Wikipedia'], ['www.napster.com', 'Napster'],
  ['www.altavista.com', 'AltaVista'], ['www.netscape.com', 'Netscape'], ['www.space-jam.com', 'Space Jam'], ['www.cypherpunks.to', 'Cypherpunks'],
  ['www.metzdowd.com', 'The cryptography mailing list'], ['www.mozilla.org', 'Mozilla'], ['www.eff.org', 'Electronic Frontier Foundation'],
  ['www.w3.org', 'W3C'], ['www.hotwired.com', 'HotWired'], ['www.theonion.com', 'The Onion'], ['www.ebay.com', 'eBay'], ['www.amazon.com', 'Amazon'],
];
async function wayback(r: Rand): Promise<Item[]> {
  const [site, title] = pick(r, WAYBACK);
  const year = 1996 + Math.floor(r() * 14);
  const d = await json<{ archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string } } }>(
    `https://archive.org/wayback/available?url=${encodeURIComponent(site)}&timestamp=${year}0601`);
  const c = d.archived_snapshots?.closest;
  if (!c?.available || !c.url || !c.timestamp) return [];
  const date = `${c.timestamp.slice(0, 4)}-${c.timestamp.slice(4, 6)}-${c.timestamp.slice(6, 8)}`;
  return [{ id: `wayback:${site}:${c.timestamp.slice(0, 8)}`, source: 'wayback', kind: 'web', title, year: Number(c.timestamp.slice(0, 4)), creator: site,
    excerpt: `${site} as the Wayback Machine captured it on ${date}.`, url: c.url.replace(/^http:/, 'https:') }];
}

// ——— beyond archive.org ———
type WikiPage = { titles?: { normalized?: string }; extract?: string; content_urls?: { desktop?: { page?: string } };
  thumbnail?: { source?: string; width?: number }; originalimage?: { source?: string; width?: number } };
async function wikipedia(r: Rand, now: Date): Promise<Item[]> {
  const [m, d] = mmdd(now).split('-');
  // the whole day, not just the ~20 selected events: what happened, who was born, who died (hundreds a date)
  type Day = { year: number; text: string; pages: WikiPage[] }[];
  const w = await json<{ selected?: Day; events?: Day; births?: Day; deaths?: Day }>(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/${m}/${d}`);
  const kind = pick(r, ['selected', 'events', 'events', 'births', 'deaths'] as const);
  const list = [...(w[kind] ?? []), ...(w.selected ?? []), ...(w.events ?? [])];
  return list.flatMap((e) => {
    const p = e.pages?.[0], url = p?.content_urls?.desktop?.page, title = p?.titles?.normalized;
    if (!p || !url || !title) return [];
    // a picture the instrument can use: the original if it's a sensible size, else a 960 px rendition
    const big = p.originalimage?.source && (p.originalimage.width ?? 9999) <= 2400 ? p.originalimage.source : p.thumbnail?.source?.replace(/\/\d+px-/, '/960px-');
    return [{ id: `wikipedia:${e.year}:${title}`, source: 'wikipedia' as Source, kind: kind === 'births' ? 'born' : kind === 'deaths' ? 'died' : 'event', title: clean(title).slice(0, 140), year: e.year, creator: 'Wikipedia',
      excerpt: excerpt(`${e.year}: ${e.text} ${p.extract ?? ''}`), url, image: big?.split('?')[0] }];
  });
}

async function loc(r: Rand, now: Date): Promise<Item[]> {
  // Chronicling America: issues printed on today's date in a year the dice choose (most digitised pages are 1880–1925)
  for (let tries = 0; tries < 2; tries++) {
    const year = 1880 + Math.floor(r() * 64), day = `${year}-${mmdd(now)}`;
    const d = await json<{ results?: { title?: string; url?: string; image_url?: string[]; partof?: string[]; description?: string[] }[] }>(
      `https://www.loc.gov/collections/chronicling-america/?dates=${day}/${day}&fo=json&c=12&at=results`, 15_000);
    const issues = (d.results ?? []).filter((x) => x.title && x.url && x.url.includes(`/${day}/ed-`));
    if (!issues.length) continue;
    return issues.map((x) => {
      // "The weekly Copiahan (Hazlehurst, Miss.), October 9, 1880" → the paper is everything before the date
      const paper = clean(x.title).replace(/,\s*[A-Z][a-z]+ \d{1,2}, \d{4}$/, '');
      const place = clean(x.description?.[0] ?? '');
      return {
        id: `loc:${x.url}`, source: 'loc' as Source, kind: 'newspaper', title: clean(x.title).slice(0, 140), year,
        creator: paper || 'Library of Congress',
        excerpt: `The front page of a newspaper printed on ${day}${place ? ` in ${place}` : ''}, kept by the Library of Congress in Chronicling America.`,
        url: x.url!.replace(/^http:/, 'https:'), image: x.image_url?.[x.image_url.length - 1]?.split('#')[0],
      };
    });
  }
  return [];
}

async function gutenberg(r: Rand): Promise<Item[]> {
  const today = await gutenbergToday().catch(() => [] as Item[]);
  // behind today's releases, the catalogue: a page the dice choose of Gutenberg's most-read books
  type Book = { id: number; title: string; authors?: { name: string; birth_year?: number | null; death_year?: number | null }[]; subjects?: string[]; formats?: Record<string, string> };
  const page = await json<{ results?: Book[] }>(`https://gutendex.com/books/?page=${1 + Math.floor(r() * 300)}`, 20_000).catch(() => ({ results: [] as Book[] }));
  const shelf = (page.results ?? []).map((b): Item => {
    const a = b.authors?.[0], name = a?.name?.split(', ').reverse().join(' ') ?? null;
    return { id: `gutenberg:${b.id}`, source: 'gutenberg', kind: 'book', title: clean(b.title).slice(0, 140), year: null, creator: name,
      excerpt: excerpt(`On Project Gutenberg, free for anyone, forever.${a?.birth_year ? ` ${name} lived ${a.birth_year}–${a.death_year ?? '?'}.` : ''} ${(b.subjects ?? []).slice(0, 3).join('; ')}.`),
      url: `https://www.gutenberg.org/ebooks/${b.id}`, image: `https://www.gutenberg.org/cache/epub/${b.id}/pg${b.id}.cover.medium.jpg` };
  });
  return [...today, ...shelf];
}
async function gutenbergToday(): Promise<Item[]> {
  return feed(await text('https://www.gutenberg.org/cache/epub/feeds/today.rss')).flatMap((e) => {
    const link = clean(e.get('link')), id = link.match(/ebooks\/(\d+)/)?.[1];
    if (!id) return [];
    const full = clean(e.get('title')), cut = full.lastIndexOf(' by ');
    const [title, author] = cut > 0 ? [full.slice(0, cut), full.slice(cut + 4)] : [full, undefined];
    return [{ id: `gutenberg:${id}`, source: 'gutenberg' as Source, kind: 'book', title: title.slice(0, 140), year: null, creator: author ?? null,
      excerpt: `Released on Project Gutenberg today, free for anyone, forever. ${clean(e.get('description'))}.`, url: link,
      image: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg` }];
  });
}

// ——— Q-Day watch ———
async function arxiv(r: Rand): Promise<Item[]> {
  const queries = [
    'cat:quant-ph AND abs:"post-quantum"', 'cat:cs.CR AND abs:quantum', 'abs:"Shor" AND abs:"elliptic"', 'abs:"logical qubits"',
    'abs:"quantum error correction" AND abs:"threshold"', 'abs:"hash-based signature"', 'abs:"lattice" AND abs:"cryptography" AND abs:quantum',
    'abs:"RSA-2048" AND abs:quantum', 'abs:"bitcoin" AND abs:quantum', 'abs:"harvest now"',
  ];
  const q = encodeURIComponent(pick(r, queries));
  const page = (start: number) => text(`https://export.arxiv.org/api/query?search_query=${q}&start=${start}&max_results=25&sortBy=submittedDate&sortOrder=descending`, 20_000);
  // a page the dice choose (up to ~200 back); a narrow search has fewer, so an empty page falls back to the newest
  let xml = await page(Math.floor(r() * 8) * 25);
  if (!xml.includes('<entry>')) xml = await page(0);
  return feed(xml, 'entry').map((e) => {
    const id = e.get('id').trim().replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
    return { id: `arxiv:${id}`, source: 'arxiv' as Source, kind: 'paper', title: clean(e.get('title')).slice(0, 160), year: Number(e.get('published').slice(0, 4)) || null,
      creator: clean(e.all('name')[0]) || null, excerpt: excerpt(e.get('summary')), url: `https://arxiv.org/abs/${id}` };
  }).filter((i) => i.title);
}

const QUANTUM = /quantum|qubit|shor|grover|lattice|post-?quantum|pqc|kyber|dilithium|ml-kem|ml-dsa|sphincs|falcon|hash-based|isogen|lwe\b/i;
async function eprint(): Promise<Item[]> {
  const all = feed(await text('https://eprint.iacr.org/rss/rss.xml')).map((e) => {
    const url = clean(e.get('link')), id = url.match(/eprint\.iacr\.org\/(\d{4}\/\d+)/)?.[1];
    return { id: `eprint:${id}`, source: 'eprint' as Source, kind: 'paper', title: clean(e.get('title')).slice(0, 160), year: Number(id?.slice(0, 4)) || null,
      creator: clean(e.all('dc:creator')[0]) || null, excerpt: excerpt(e.get('description')), url };
  }).filter((i) => i.title && !i.id.endsWith('undefined'));
  // the Overmind reads all of cryptography, but leans toward what Q-Day touches
  const quantum = all.filter((i) => QUANTUM.test(`${i.title} ${i.excerpt}`));
  return quantum.length >= 3 ? quantum : all;
}

const Q_NEWS = /quantum|qubit|q-day|shor|post-quantum|pqc|cryptograph|encryption|ml-kem|lattice|harvest now|project eleven/i;
async function news(r: Rand): Promise<Item[]> {
  // a deep page on a narrow topic can be empty, or filter down to nothing: then the first page, then another topic
  for (let tries = 0; tries < 3; tries++) { const found = await newsOnce(r, tries === 1); if (found.length) return found; }
  return [];
}
async function newsOnce(r: Rand, first = false): Promise<Item[]> {
  const q = pick(r, ['quantum computing', 'post-quantum', 'qubits', 'quantum cryptography', 'Q-Day', 'quantum bitcoin', 'Shor algorithm', 'quantum error correction', 'Project Eleven quantum']);
  const recent = r() < 0.5, since = Math.floor(Date.now() / 1000) - 180 * 86400;
  const filters = recent ? `created_at_i>${since},points>5` : 'points>20';
  const d = await json<{ hits: { objectID: string; title?: string; url?: string; author?: string; points?: number; num_comments?: number; created_at?: string; story_text?: string }[] }>(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=${filters}&hitsPerPage=30&page=${first ? 0 : Math.floor(r() * (recent ? 2 : 3))}`);
  // keep it to the q-day beat (the search is generous with near matches)
  return d.hits.filter((h) => h.title && Q_NEWS.test(h.title)).map((h) => {
    const host = h.url ? new URL(h.url).hostname.replace(/^www\./, '') : 'news.ycombinator.com';
    return { id: `news:${h.objectID}`, source: 'news' as Source, kind: 'news', title: clean(h.title).slice(0, 160), year: Number(h.created_at?.slice(0, 4)) || null,
      creator: host, url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      excerpt: excerpt(`${h.story_text ? clean(h.story_text) + ' ' : ''}Posted ${h.created_at?.slice(0, 10)} from ${host}; ${h.points ?? 0} points and ${h.num_comments ?? 0} comments on Hacker News (news.ycombinator.com/item?id=${h.objectID}).`) };
  });
}

type Block = { id: string; height: number; timestamp: number; tx_count: number; extras?: { totalInputs?: number; pool?: { name?: string } } };
async function bitcoin(): Promise<Item[]> {
  const blocks = await json<Block[]>('https://mempool.space/api/v1/blocks');
  return blocks.slice(0, 3).map((b) => {
    const at = new Date(b.timestamp * 1000).toISOString().slice(11, 16), inputs = b.extras?.totalInputs ?? 0;
    return { id: `bitcoin:${b.height}`, source: 'bitcoin' as Source, kind: 'chain', title: `Bitcoin block ${fmt(b.height)}`, year: new Date(b.timestamp * 1000).getUTCFullYear(),
      creator: b.extras?.pool?.name ? `mined by ${b.extras.pool.name}` : 'Bitcoin',
      excerpt: `Mined at ${at} UTC with ${fmt(b.tx_count)} transactions spending ${fmt(inputs)} coins. Spending a coin reveals the public key that guarded it, and a large enough quantum computer could work back from that key.`,
      url: `https://mempool.space/block/${b.id}` };
  });
}

async function solana(): Promise<Item[]> {
  const res = await fetch('https://api.mainnet-beta.solana.com', { method: 'POST', headers: { ...UA, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getRecentPerformanceSamples', params: [1] }) });
  const s = ((await res.json()) as { result?: { slot: number; numTransactions: number; numNonVoteTransactions?: number; samplePeriodSecs: number }[] }).result?.[0];
  if (!s) return [];
  return [{ id: `solana:${s.slot}`, source: 'solana', kind: 'chain', title: `Solana, the minute up to slot ${fmt(s.slot)}`, year: new Date().getUTCFullYear(), creator: 'Solana mainnet',
    excerpt: `${fmt(s.numTransactions)} transactions in ${s.samplePeriodSecs} seconds${s.numNonVoteTransactions ? ` (${fmt(s.numNonVoteTransactions)} of them not votes)` : ''}. On Solana an address is its public key, so every wallet is exposed from the day it's made.`,
    url: `https://explorer.solana.com/block/${s.slot}` }];
}

const GITHUB_TOPICS = ['post-quantum', 'ml-kem', 'ml-dsa', 'slh-dsa', 'sphincs', 'lamport signature', 'winternitz', 'quantum resistant bitcoin', 'kyber', 'dilithium', 'pqc', 'hash-based signatures', 'quantum-safe'];
async function github(r: Rand): Promise<Item[]> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const d = await json<{ items?: { full_name: string; html_url: string; description?: string; stargazers_count: number; created_at: string; pushed_at: string; owner: { login: string } }[] }>(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(`${pick(r, GITHUB_TOPICS)} pushed:>${since}`)}&sort=stars&order=desc&per_page=25&page=${1 + Math.floor(r() * 3)}`);
  return (d.items ?? []).filter((x) => x.description).map((x) => ({
    id: `github:${x.full_name}`, source: 'github' as Source, kind: 'code', title: x.full_name, year: Number(x.created_at.slice(0, 4)), creator: x.owner.login,
    excerpt: excerpt(`${x.description} · ${fmt(x.stargazers_count)} stars · last pushed ${x.pushed_at.slice(0, 10)}.`), url: x.html_url,
    image: `https://opengraph.githubassets.com/1/${x.full_name}`,
  }));
}

/** The lore lens: the Archive's own shelves on floppy disks, cryptography and the early internet. */
const LORE: { q: string; kind: string }[] = [
  { q: 'title:(floppy OR diskette OR microfloppy) AND mediatype:texts', kind: 'manual' },
  { q: 'collection:bitsavers AND title:(floppy OR diskette)', kind: 'manual' },
  { q: 'subject:(cryptography OR "public key" OR encryption) AND mediatype:texts', kind: 'text' },
  { q: 'subject:(cypherpunk OR cypherpunks OR PGP)', kind: 'text' },
  { q: 'title:(quantum) AND mediatype:(texts OR movies) AND year:[1900 TO 2005]', kind: 'text' },
  { q: 'subject:("computer history" OR "history of computing") AND mediatype:(texts OR movies)', kind: 'text' },
  { q: 'title:(backup OR "data storage" OR "magnetic media") AND mediatype:(texts OR movies)', kind: 'manual' },
];
async function lore(r: Rand): Promise<Item[]> {
  const c = pick(r, LORE);
  return (await search(c.q, 30, 1 + Math.floor(r() * 5))).filter((d) => d.title).map((d) => fromDoc(d, c.kind));
}

// ——— flavour ———
async function noaa(): Promise<Item[]> {
  const alerts = await json<{ product_id: string; issue_datetime: string; message: string }[]>('https://services.swpc.noaa.gov/products/alerts.json');
  const since = Date.now() - 3 * 86400_000;
  return alerts.filter((a) => Date.parse(a.issue_datetime.replace(' ', 'T') + 'Z') > since).map((a) => {
    const lines = a.message.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const header = /^(Space Weather Message Code|Serial Number|Issue Time|www\.|NOAA Space Weather Scale|Extends Serial Number|Cancel Serial Number)/i;
    const headline = lines.find((l) => /^(CONTINUED |EXTENDED |CANCEL )?(WATCH|ALERT|WARNING|SUMMARY)\b/i.test(l)) ?? lines.find((l) => !header.test(l)) ?? 'Space weather message';
    const body = lines.filter((l) => !header.test(l) && l !== headline).join(' ');
    return { id: `noaa:${a.product_id}:${a.issue_datetime}`, source: 'noaa' as Source, kind: 'weather', title: clean(headline).slice(0, 140),
      year: Number(a.issue_datetime.slice(0, 4)), creator: 'NOAA Space Weather Prediction Center', excerpt: excerpt(`${a.issue_datetime.slice(0, 16)} UTC. ${body}`),
      url: 'https://www.swpc.noaa.gov/', image: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0193.jpg' };
  });
}

/**
 * The lenses and how often the dice choose each: w normally (archive.org about a quarter, the Q-Day watch about a third),
 * early for the first few disks (the lore: Q-Day watch and GitHub about half, floppy and crypto history a seventh).
 */
const LENSES: { name: string; w: number; early: number; qday?: boolean; run: (r: Rand, now: Date) => Promise<Item[]> }[] = [
  { name: 'archive', w: 0.18, early: 0.14, run: archive },
  { name: 'onthisday', w: 0.04, early: 0.04, run: onThisDay },
  { name: 'wayback', w: 0.03, early: 0.03, run: wayback }, // rate-limited often; when it is, the dice choose again
  { name: 'wikipedia', w: 0.12, early: 0.08, run: wikipedia },
  { name: 'loc', w: 0.08, early: 0.04, run: loc },
  { name: 'gutenberg', w: 0.06, early: 0.02, run: gutenberg },
  { name: 'lore', w: 0, early: 0.14, run: lore },
  { name: 'arxiv', w: 0.13, early: 0.14, qday: true, run: arxiv },
  { name: 'eprint', w: 0.05, early: 0.08, qday: true, run: eprint },
  { name: 'news', w: 0.11, early: 0.10, qday: true, run: news },
  { name: 'bitcoin', w: 0.04, early: 0.05, qday: true, run: bitcoin },
  { name: 'solana', w: 0.03, early: 0.03, qday: true, run: solana },
  { name: 'github', w: 0.05, early: 0.08, qday: true, run: github },
  { name: 'noaa', w: 0.03, early: 0.03, run: noaa },
];
/** Lenses whose finds can move the Q-Day clock. */
export const QDAY_LENSES = new Set(LENSES.filter((l) => l.qday).map((l) => l.name));

/** Kept off the disks: explicit, adult and slur-laden titles (the Archive's software shelves have a few). */
const UNSAFE = /\b(fuck\w*|shit(s|ty|ter|head)?|cunt\w*|nigg\w*|fag(got)?s?|porn\w*|xxx|sex|sexy|sexual|nude|nudity|naked|hentai|erotic\w*|playboy|penthouse|hustler|slut\w*|whore\w*|rape[sd]?|rapist|strip poker|bitch\w*|boobs?|tits)\b|adults? (only|games?|content|entertainment)/i;
const keep = (i: Item) => !UNSAFE.test(`${i.title} ${i.excerpt}`);

function choose(r: Rand, skip: Set<string>, early: boolean) {
  const weight = (l: (typeof LENSES)[number]) => (early ? l.early : l.w);
  const open = LENSES.filter((l) => !skip.has(l.name) && weight(l) > 0);
  const total = open.reduce((a, l) => a + weight(l), 0);
  let u = r() * total;
  for (const l of open) { if (u < weight(l)) return l; u -= weight(l); }
  return open[open.length - 1];
}

const ARCHIVE_FAMILY = new Set(['archive', 'onthisday', 'wayback', 'lore']);
/**
 * Up to `n` unseen candidates from the lens the dice choose. If it fails or has nothing new, the dice choose again among
 * the sources beyond the Archive (it would otherwise win every re-roll, being the deepest), and the Archive is the
 * last resort, so a gap means everything really came up empty.
 */
export async function candidates(r: Rand, now: Date, n = 7, only?: string, early = false): Promise<{ lens: string; items: Item[] }> {
  const tried = new Set<string>();
  for (let attempt = 0; attempt < 5; attempt++) {
    const skip = attempt === 0 ? tried : attempt < 4 ? new Set([...tried, ...ARCHIVE_FAMILY]) : tried;
    const l = only ? LENSES.find((x) => x.name === only)! : attempt === 4 && !tried.has('archive') ? LENSES.find((x) => x.name === 'archive')! : choose(r, skip, early);
    tried.add(l.name);
    try {
      const found = await l.run(r, now);
      const seen = await isSeen(found.map((i) => i.id));
      const fresh = found.filter((i) => !seen.has(i.id) && keep(i));
      for (let i = fresh.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [fresh[i], fresh[j]] = [fresh[j], fresh[i]]; }
      if (fresh.length) return { lens: l.name, items: fresh.slice(0, n) };
    } catch (e) { console.warn('lens failed', l.name, String(e).slice(0, 160)); }
    if (only) break;
  }
  return { lens: [...tried].join('/'), items: [] };
}
export const LENS_NAMES = LENSES.map((l) => l.name);
/** Runs one lens as it is (no seen-filter): how much a source gives right now (npm run lenses). */
export async function probe(name: string, r: Rand, now = new Date()): Promise<Item[]> {
  const l = LENSES.find((x) => x.name === name);
  if (!l) throw new Error(`no lens ${name}`);
  return (await l.run(r, now)).filter(keep);
}
