/**
 * Nominations: a visitor at the terminal types SAVE <link> and asks the Overmind to keep something. Links are only
 * taken from curated sources (the Internet Archive, Wikipedia, arXiv, IACR ePrint, Project Gutenberg, the Library of
 * Congress), and what goes on the disk is what the source itself says (its title and description), never the visitor's
 * words. Every so often the archivist weighs the oldest nomination: with Claude it decides like any other candidate;
 * without it, an Archive item has to be at least a month old (so nobody uploads something and nominates it the same
 * day). The visitor who asked hears whether it made it through.
 */
import { pool, type Item } from './db.js';

const UA = { 'User-Agent': 'OvermindArchivist/0.3 (a visitor nominated this; one request)' };
const PER_VISITOR_DAY = 3, PER_IP_DAY = 8, QUEUE_CAP = 300;
const SCREENED = !!process.env.ANTHROPIC_API_KEY; // Claude weighs nominations; without it the curated-source rules do

export async function migrateNominations() {
  await pool.query(`
    create table if not exists nominations (
      id serial primary key,
      url text not null unique,
      item jsonb not null,
      visitor text not null,
      ip text not null,
      status text not null default 'queued',
      disk integer, k integer,
      created_at timestamptz not null default now(),
      decided_at timestamptz
    );
    create index if not exists nominations_status on nominations (status, created_at);
  `);
}

const clean = (s: unknown) => String(Array.isArray(s) ? s[0] : s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
const excerpt = (s: unknown, n = 420) => { const t = clean(s); return t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n)) + '…'; };
const get = async (url: string) => {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10_000), redirect: 'follow' });
  if (!res.ok) throw new Error(String(res.status));
  return res;
};
/** The page's own title and description (og: tags first), read from at most 400 KB of it. */
async function pageMeta(url: string) {
  const res = await get(url);
  const reader = res.body?.getReader();
  let html = '', size = 0;
  while (reader) { const { done, value } = await reader.read(); if (done) break; size += value.length; html += new TextDecoder().decode(value); if (size > 400_000) { void reader.cancel(); break; } }
  const meta = (name: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i'))?.[1];
  return { title: clean(meta('og:title') ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''), description: clean(meta('og:description') ?? meta('description') ?? '') };
}

/** Reads a nominated link into an item, from the source's own record. Throws a visitor-facing reason when it can't. */
export async function resolve(raw: string): Promise<Item & { listedAt?: number }> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error("that isn't a link. try SAVE https://archive.org/details/…"); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error("that isn't a web link.");
  const host = u.hostname.replace(/^www\./, '');
  const path = decodeURIComponent(u.pathname);

  if (host === 'archive.org') {
    const id = path.match(/^\/details\/([^/]+)/)?.[1];
    if (!id) throw new Error('give me an archive.org/details/… link.');
    const m = await (await get(`https://archive.org/metadata/${encodeURIComponent(id)}`)).json() as { metadata?: Record<string, unknown>; is_dark?: boolean };
    const md = m.metadata;
    if (!md || m.is_dark) throw new Error("the archive doesn't have that one.");
    const year = Number(String(md.year ?? md.date ?? '').slice(0, 4));
    return { id, source: 'archive', kind: String(md.mediatype ?? 'item'), title: clean(md.title).slice(0, 140) || id, year: year > 1000 && year < 2100 ? year : null,
      creator: clean(md.creator).slice(0, 80) || null, excerpt: excerpt(md.description), url: `https://archive.org/details/${id}`,
      listedAt: Date.parse(String(md.publicdate ?? md.addeddate ?? '')) || undefined };
  }
  const wiki = host.match(/^([a-z-]{2,12})\.(?:m\.)?wikipedia\.org$/);
  if (wiki) {
    const title = path.match(/^\/wiki\/(.+)$/)?.[1];
    if (!title || /^(Special|User|Talk|User_talk|Wikipedia|File|Template|Category|Help|Portal|Draft):/i.test(title)) throw new Error('give me a wikipedia article.');
    const s = await (await get(`https://${wiki[1]}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)).json() as { title?: string; extract?: string; type?: string; content_urls?: { desktop?: { page?: string } } };
    if (!s.title || s.type === 'disambiguation') throw new Error("that page didn't open as an article.");
    return { id: `wikipedia:${wiki[1]}:${s.title}`, source: 'wikipedia', kind: 'article', title: clean(s.title).slice(0, 140), year: null, creator: 'Wikipedia',
      excerpt: excerpt(s.extract), url: s.content_urls?.desktop?.page ?? u.href };
  }
  if (host === 'arxiv.org') {
    const id = path.match(/^\/(?:abs|pdf)\/([\w./-]+?)(?:v\d+)?(?:\.pdf)?$/)?.[1];
    if (!id) throw new Error('give me an arxiv.org/abs/… link.');
    const xml = await (await get(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`)).text();
    const entry = xml.split('<entry>')[1] ?? '';
    const tag = (t: string) => clean(entry.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? '');
    if (!tag('title')) throw new Error("arxiv doesn't know that paper.");
    return { id: `arxiv:${id}`, source: 'arxiv', kind: 'paper', title: tag('title').slice(0, 160), year: Number(tag('published').slice(0, 4)) || null,
      creator: tag('name') || null, excerpt: excerpt(tag('summary')), url: `https://arxiv.org/abs/${id}` };
  }
  if (host === 'gutenberg.org') {
    const id = path.match(/^\/ebooks\/(\d+)/)?.[1];
    if (!id) throw new Error('give me a gutenberg.org/ebooks/… link.');
    const meta = await pageMeta(`https://www.gutenberg.org/ebooks/${id}`);
    if (!meta.title) throw new Error("gutenberg doesn't have that one.");
    return { id: `gutenberg:${id}`, source: 'gutenberg', kind: 'book', title: meta.title.replace(/\s*\|\s*Project Gutenberg$/i, '').slice(0, 140), year: null, creator: null,
      excerpt: excerpt(meta.description), url: `https://www.gutenberg.org/ebooks/${id}`, image: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg` };
  }
  if (host === 'eprint.iacr.org' && /^\/\d{4}\/\d+/.test(path)) {
    const meta = await pageMeta(u.href);
    if (!meta.title) throw new Error("eprint doesn't have that one.");
    return { id: `eprint:${path.slice(1)}`, source: 'eprint', kind: 'paper', title: meta.title.slice(0, 160), year: Number(path.slice(1, 5)) || null, creator: null,
      excerpt: excerpt(meta.description), url: u.href };
  }
  if (host === 'loc.gov' || host === 'chroniclingamerica.loc.gov') {
    const meta = await pageMeta(u.href);
    if (!meta.title) throw new Error("the library didn't answer for that one.");
    return { id: `loc:${u.href}`, source: 'loc', kind: 'newspaper', title: meta.title.replace(/\s*\|\s*Library of Congress$/i, '').slice(0, 140), year: null, creator: 'Library of Congress',
      excerpt: excerpt(meta.description), url: u.href };
  }
  throw new Error('i only take links from the internet archive, wikipedia, arxiv, iacr eprint, project gutenberg or the library of congress.');
}

/** A visitor's SAVE: checks the limits, reads the link and queues it. Returns what the Overmind says back. */
export async function nominate(url: string, visitor: string, ip: string): Promise<{ ok: boolean; reply: string; title?: string }> {
  const day = await pool.query(`select count(*) filter (where visitor = $1)::int as mine, count(*) filter (where ip = $2)::int as here
    from nominations where created_at > now() - interval '1 day'`, [visitor, ip]);
  if (day.rows[0].mine >= PER_VISITOR_DAY || day.rows[0].here >= PER_IP_DAY) return { ok: false, reply: "you've asked me for three things today. i'm still weighing them. come back tomorrow." };
  const queued = (await pool.query(`select count(*)::int as n from nominations where status = 'queued'`)).rows[0].n;
  if (queued >= QUEUE_CAP) return { ok: false, reply: 'my list is full right now. try again later.' };
  let item: Item & { listedAt?: number };
  try { item = await resolve(url); } catch (e) { return { ok: false, reply: e instanceof Error && !/^\d+$/.test(e.message) ? e.message : "i couldn't open that. check the link?" }; }
  if (!SCREENED && item.source === 'archive' && (!item.listedAt || Date.now() - item.listedAt < 30 * 86_400_000)) {
    return { ok: false, reply: "that one's too new to the archive. i only take items that have been there a month or more." };
  }
  const { listedAt: _, ...stored } = item;
  const r = await pool.query(`insert into nominations (url, item, visitor, ip) values ($1, $2, $3, $4) on conflict (url) do nothing returning id`, [stored.url, stored, visitor, ip]);
  if (!r.rowCount) return { ok: false, reply: 'someone already asked me for that one. it is on my list.' };
  return { ok: true, title: stored.title, reply: `noted: ${stored.title.toLowerCase()}. if it deserves to make it through, i'll keep it, and you'll see it in my log. type MINE to check.` };
}

export interface Nomination { id: number; item: Item; visitor: string }
/** The oldest nomination still waiting. */
export async function nextNomination(): Promise<Nomination | undefined> {
  return (await pool.query(`select id, item, visitor from nominations where status = 'queued' order by created_at limit 1`)).rows[0];
}
export async function decide(id: number, status: 'saved' | 'passed', disk?: number, k?: number) {
  await pool.query(`update nominations set status = $2, disk = $3, k = $4, decided_at = now() where id = $1`, [id, status, disk ?? null, k ?? null]);
}
export async function waiting(): Promise<number> {
  return (await pool.query(`select count(*)::int as n from nominations where status = 'queued'`)).rows[0].n;
}
/** A visitor's own nominations, newest first. */
export async function mine(visitor: string) {
  return (await pool.query(`select item->>'title' as title, status, disk, k, created_at from nominations where visitor = $1 order by created_at desc limit 10`, [visitor])).rows as
    { title: string; status: string; disk: number | null; k: number | null; created_at: string }[];
}
