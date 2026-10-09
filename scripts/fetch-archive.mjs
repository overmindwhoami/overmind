// Collects a pool of real Internet Archive and arXiv items for the simulated Overmind (phase 1), politely.
// Output: src/data/archive-pool.json (metadata, links, short excerpts) and public/archive/thumbs/<id>.jpg (small previews).
// Run once: node scripts/fetch-archive.mjs   (thumbnails are resized by scripts/thumbs.py afterwards)
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = resolve(root, 'scripts/.cache/thumbs');
mkdirSync(RAW, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'OvermindArchivist/0.1 (research prototype; gentle crawler)' };

const QUERIES = [
  ['software', 'collection:softwarelibrary_msdos_games AND mediatype:software', 150],
  ['software', 'collection:softwarelibrary_msdos AND mediatype:software', 60],
  ['software', 'collection:softwarelibrary_mac AND mediatype:software', 60],
  ['software', 'collection:tucows AND mediatype:software', 40],
  ['magazine', 'collection:computermagazines AND mediatype:texts', 90],
  ['magazine', 'collection:byte-magazine AND mediatype:texts', 30],
  ['manual', 'collection:manuals AND mediatype:texts AND (subject:computer OR subject:modem OR subject:software)', 60],
  ['newsletter', 'collection:newsletters AND mediatype:texts', 40],
  ['radio', 'collection:oldtimeradio AND mediatype:audio', 50],
  ['film', 'collection:prelinger AND mediatype:movies', 50],
  ['text', 'mediatype:texts AND subject:cryptography AND date:[1900-01-01 TO 2005-12-31]', 30],
  ['text', 'mediatype:texts AND (subject:"floppy disk" OR subject:"floppy disks")', 20],
];
const clean = (s = '') => String(Array.isArray(s) ? s[0] : s).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const excerpt = (s, n = 260) => { const t = clean(s); if (t.length <= n) return t; const cut = t.slice(0, n); return cut.slice(0, cut.lastIndexOf(' ')) + '…'; };

const pool = [], seen = new Set();
for (const [kind, q, rows] of QUERIES) {
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=date&fl[]=year&fl[]=description&fl[]=creator&rows=${rows}&page=1&sort[]=downloads+desc&output=json`;
  try {
    const res = await fetch(url, { headers: UA });
    const docs = (await res.json()).response?.docs ?? [];
    let n = 0;
    for (const d of docs) {
      if (!d.identifier || seen.has(d.identifier) || !d.title) continue;
      seen.add(d.identifier);
      const year = d.year ? Number(String(d.year).slice(0, 4)) : d.date ? Number(String(d.date).slice(0, 4)) : null;
      pool.push({ id: d.identifier, source: 'archive', kind, title: clean(d.title).slice(0, 120), year, creator: clean(d.creator).slice(0, 60) || null, excerpt: excerpt(d.description), url: `https://archive.org/details/${d.identifier}` });
      n++;
    }
    console.log(kind, q.slice(0, 50), n);
  } catch (e) { console.log('failed', q, e.message); }
  await sleep(1500);
}

// arXiv: quantum computing and post-quantum cryptography papers (links and abstract excerpts)
for (const q of ['all:"post-quantum cryptography"', 'all:"Shor" AND all:"elliptic curve"', 'all:"quantum error correction" AND all:"logical qubits"', 'all:"hash-based signatures"']) {
  try {
    const res = await fetch(`http://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&max_results=25&sortBy=submittedDate&sortOrder=descending`, { headers: UA });
    const xml = await res.text();
    let n = 0;
    for (const entry of xml.split('<entry>').slice(1)) {
      const get = (tag) => (entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [])[1] ?? '';
      const id = get('id').trim().replace('http://arxiv.org/abs/', '').replace(/v\d+$/, '');
      if (!id || seen.has('arxiv:' + id)) continue;
      seen.add('arxiv:' + id);
      pool.push({ id: 'arxiv:' + id, source: 'arxiv', kind: 'paper', title: clean(get('title')).slice(0, 140), year: Number(get('published').slice(0, 4)), creator: clean((entry.match(/<name>([^<]+)<\/name>/) ?? [])[1]) || null, excerpt: excerpt(get('summary')), url: `https://arxiv.org/abs/${id}` });
      n++;
    }
    console.log('arxiv', q, n);
  } catch (e) { console.log('arxiv failed', q, e.message); }
  await sleep(3500); // arXiv asks for at least 3 s between requests
}

// Old web pages via the Wayback Machine (hand-picked; the snapshot URLs resolve to the nearest capture)
const WAYBACK = [
  ['bitcoin.org', 2009, 'Bitcoin P2P e-cash paper, the original site'], ['www.geocities.com', 1997, 'GeoCities neighbourhoods directory'],
  ['www.yahoo.com', 1996, 'Yahoo! directory front page'], ['www.google.com', 1998, 'Google search, beta'], ['www.amazon.com', 1999, "Earth's biggest bookstore"],
  ['www.apple.com', 1997, 'Apple, think different'], ['www.cern.ch', 1996, 'CERN, where the web was born'], ['www.archive.org', 1997, 'The Internet Archive, first front page'],
  ['www.nasa.gov', 1996, 'NASA home page'], ['www.whitehouse.gov', 1996, 'The White House, with a guestbook'], ['www.slashdot.org', 1998, 'News for nerds'],
  ['www.metafilter.com', 2000, 'Community weblog'], ['www.wikipedia.org', 2001, 'Wikipedia, the first months'], ['www.napster.com', 2000, 'Napster'],
  ['www.hotmail.com', 1997, 'Free web-based email'], ['www.altavista.com', 1998, 'AltaVista search'], ['www.netscape.com', 1997, 'Netscape Netcenter'],
  ['www.space-jam.com', 1996, 'Space Jam, still online'], ['www.cypherpunks.to', 1999, 'Cypherpunks'], ['www.metzdowd.com', 2008, 'The cryptography mailing list'],
];
for (const [site, y, title] of WAYBACK) pool.push({ id: `wayback:${site}:${y}`, source: 'wayback', kind: 'web', title, year: y, creator: site, excerpt: `${site}, as captured in ${y}.`, url: `https://web.archive.org/web/${y}/http://${site}/` });

writeFileSync(resolve(root, 'src/data/archive-pool.json'), JSON.stringify(pool, null, 0));
console.log('pool', pool.length);

// Thumbnails, a few at a time
const archive = pool.filter((p) => p.source === 'archive');
let ok = 0;
for (let i = 0; i < archive.length; i += 4) {
  await Promise.all(archive.slice(i, i + 4).map(async (p) => {
    const out = resolve(RAW, p.id.replace(/[^\w.-]/g, '_') + '.img');
    if (existsSync(out)) { ok++; return; }
    try {
      const res = await fetch(`https://archive.org/services/img/${p.id}`, { headers: UA });
      if (res.ok) { writeFileSync(out, Buffer.from(await res.arrayBuffer())); ok++; }
    } catch { /* keep going */ }
  }));
  await sleep(700);
}
console.log('thumbs', ok, '/', archive.length);
