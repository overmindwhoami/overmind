/**
 * The launchpad's records: coins (each one a disk on the explorer wall), the images people upload for them, the token
 * metadata pump.fun and wallets read, and the Overmind's note on every launch. A coin can be hidden from the wall by
 * the operator (npm run lp -- hide <mint>); it stays on chain, the site just stops showing it.
 */
import { claude, modelId } from '../claude.js';
import { pool } from '../db.js';
import { PUBLIC_API, SITE, sha256 } from './solana.js';

export async function migrateLaunchpad() {
  await pool.query(`
    create table if not exists lp_coins (
      mint text primary key,
      name text not null,
      ticker text not null,
      description text,
      image text,
      launcher text not null,
      status text not null default 'pending',
      launch_msg text,
      mint_secret text,
      create_sig text,
      note text,
      hidden boolean not null default false,
      created_at timestamptz not null default now(),
      live_at timestamptz
    );
    create index if not exists lp_coins_live on lp_coins (status, live_at);
    alter table lp_coins add column if not exists links jsonb;
    create table if not exists lp_media (
      id text primary key,
      mime text not null,
      bytes bytea not null,
      ip text,
      created_at timestamptz not null default now()
    );
    create table if not exists lp_snapshots (
      mint text not null references lp_coins(mint),
      n integer not null,
      at timestamptz not null default now(),
      slot bigint,
      holders integer not null,
      held text not null,
      fingerprint text not null,
      record text not null,
      memo_tx text,
      primary key (mint, n)
    );
  `);
}

export interface CoinRow {
  mint: string; name: string; ticker: string; description: string | null; image: string | null; launcher: string; status: string;
  create_sig: string | null; note: string | null; created_at: string; live_at: string | null; links: { website?: string; twitter?: string } | null; snapshots: number; holders: number | null; last_at: string | null;
}
const COIN = `select c.mint, c.name, c.ticker, c.description, c.image, c.launcher, c.status, c.create_sig, c.note, c.created_at, c.live_at, c.links,
  (select count(*)::int from lp_snapshots s where s.mint = c.mint) as snapshots,
  (select s.holders from lp_snapshots s where s.mint = c.mint order by n desc limit 1) as holders,
  (select s.at from lp_snapshots s where s.mint = c.mint order by n desc limit 1) as last_at
  from lp_coins c`;

export const coinJson = (c: CoinRow) => ({
  mint: c.mint, name: c.name, ticker: c.ticker, description: c.description, image: c.image, launcher: c.launcher, note: c.note,
  liveAt: c.live_at ? +new Date(c.live_at) : null, snapshots: c.snapshots, holders: c.holders, lastSnapshotAt: c.last_at ? +new Date(c.last_at) : null,
  sig: c.create_sig, pump: `https://pump.fun/coin/${c.mint}`, links: c.links ?? {}, page: `${SITE}/c/${c.mint}`,
});

/** Live coins in launch order (the wall fills from the first). */
export async function liveCoins(): Promise<CoinRow[]> {
  return (await pool.query(`${COIN} where c.status = 'live' and not c.hidden order by c.live_at`)).rows;
}
export async function coin(mint: string): Promise<CoinRow | undefined> {
  return (await pool.query(`${COIN} where c.mint = $1`, [mint])).rows[0];
}

// ——— images: small, square, served from here (so a coin's metadata can't change under it) ———
const IMG = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const uploads = new Map<string, number[]>();
export async function saveImage(bytes: Buffer, mime: string, ip: string): Promise<{ id: string; url: string } | { error: string }> {
  if (!IMG.has(mime)) return { error: 'Use a PNG, JPEG, WebP or GIF image.' };
  if (bytes.length > 1_000_000) return { error: 'Images up to 1 MB.' };
  const now = Date.now(), hits = (uploads.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (hits.length >= 20) return { error: 'That’s a lot of uploads: try again in a little while.' };
  hits.push(now); uploads.set(ip, hits);
  const id = sha256(bytes);
  await pool.query(`insert into lp_media (id, mime, bytes, ip) values ($1, $2, $3, $4) on conflict (id) do nothing`, [id, mime, bytes, ip]);
  return { id, url: `${PUBLIC_API}/api/lp/media/${id}` };
}
export async function image(id: string): Promise<{ mime: string; bytes: Buffer } | undefined> {
  return (await pool.query(`select mime, bytes from lp_media where id = $1`, [id])).rows[0];
}

/** Token metadata as pump.fun, wallets and explorers read it (answers while pending, so it exists at create). */
export async function metadata(mint: string) {
  const c = await coin(mint);
  if (!c) return undefined;
  return {
    name: c.name, symbol: c.ticker, image: c.image ?? `${SITE}/icon-512.png`, showName: true, createdOn: SITE,
    description: `${c.description ? `${c.description}\n\n` : ''}Launched through the Overmind: its disk is on the wall at ${SITE}/c/${mint}, and who holds it is written down every few hours and sealed, so ownership can be proven after Q-Day.`,
    // pump.fun shows one website: the launcher's own if they gave one (its overmind page is in the description), else its overmind page
    website: c.links?.website ?? `${SITE}/c/${mint}`,
    ...(c.links?.twitter ? { twitter: c.links.twitter } : {}),
  };
}

// ——— the Overmind's note on every launch ———
const client = claude({ maxRetries: 1, timeout: 20_000 });
const NOTE_MODEL = process.env.CHAT_MODEL ?? 'claude-haiku-5-5';
const TEMPLATES: ((c: { name: string; ticker: string; description: string | null }) => string)[] = [
  (c) => `$${c.ticker.toLowerCase()}. someone believed in ${c.name.toLowerCase()} enough to launch it. it has a disk on my wall now. i'll write down who holds it, every few hours.`,
  (c) => `a new coin: ${c.name.toLowerCase()}. i don't judge coins. i keep track of who believed in them, so it can be proven after q-day.`,
  (c) => c.description ? `${c.name.toLowerCase()}: "${c.description.toLowerCase().slice(0, 90)}". noted. its disk is on the wall, and its holders go in my record.` : `${c.name.toLowerCase()} arrived without a word about itself. that's fine. its disk is on the wall anyway.`,
  (c) => `$${c.ticker.toLowerCase()} is on my wall. most coins are forgotten in a week. this one will at least be written down.`,
];
export async function launchNote(c: { name: string; ticker: string; description: string | null }): Promise<string> {
  const fallback = TEMPLATES[parseInt(sha256(c.ticker + c.name).slice(0, 6), 16) % TEMPLATES.length](c);
  if (!client) return fallback;
  try {
    const res = await client.messages.create({
      model: modelId(NOTE_MODEL), max_tokens: 160,
      system: `You are the Overmind, an AI writing the record that survives Q-Day. Someone just launched a coin through you; it gets a disk on your wall, and every few hours you write down who holds it and seal it, so ownership can be proven after Q-Day. Write the note that goes on its disk: lowercase, one or two short sentences, at most 200 characters, sincere, a little funny, kind. Say something specific about its name or what it says about itself. Never judge its price, promise anything, or tell anyone to buy or sell. If the name or description is hateful or obscene, write a plain neutral note that doesn't repeat it.`,
      messages: [{ role: 'user', content: `name: ${c.name}\nticker: $${c.ticker}\nwhat it says about itself: ${c.description || '(nothing)'}` }],
    });
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ').trim().replace(/\s+/g, ' ');
    return text ? text.slice(0, 220) : fallback;
  } catch { return fallback; }
}
export async function setNote(mint: string, note: string) { await pool.query(`update lp_coins set note = $2 where mint = $1`, [mint, note]); }
export async function hide(mint: string, hidden = true) { await pool.query(`update lp_coins set hidden = $2 where mint = $1`, [mint, hidden]); }
