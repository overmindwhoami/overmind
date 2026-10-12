/** Postgres store for the lineage: disks and the slots written on them, plus the items already saved (no repeats). */
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

export interface Dice { source: 'curby' | 'drand' | 'local'; round: number; value: string; quantum: boolean; at: string; note?: string }
/** Where an item came from (the site names each one). */
export type Source = 'archive' | 'wayback' | 'arxiv' | 'eprint' | 'news' | 'bitcoin' | 'solana' | 'noaa' | 'wikipedia' | 'loc' | 'gutenberg' | 'github' | 'web';
export interface Item {
  id: string; source: Source; kind: string; title: string; year: number | null; creator: string | null;
  excerpt: string; url: string; media?: string; clip?: string;
  /** A picture at the source, copied into our media for the instrument (sources other than the Archive). */
  image?: string;
}
export interface SlotRow {
  disk: number; k: number; time: string; item: Item | null; note: string; file: string; dice: Dice; model: string;
  /** How far this save moved the Overmind's Q-Day clock, in days (negative is closer); null when it didn't. */
  qday_shift: number | null;
}
export interface DiskRow {
  n: number; seed: number; started_at: string; sealed_at: string | null; fingerprint: string | null; fascination: string; written: number; checks: number;
  seal_tx: string | null; seal_cluster: string | null;
}

export async function migrate() {
  await pool.query(`
    create table if not exists disks (
      n integer primary key,
      seed bigint not null,
      started_at timestamptz not null default now(),
      sealed_at timestamptz,
      fingerprint text,
      fascination text not null,
      dice jsonb not null
    );
    create table if not exists slots (
      disk integer not null references disks(n),
      k integer not null,
      time timestamptz not null default now(),
      item jsonb,
      note text not null,
      file text not null,
      dice jsonb not null,
      model text not null,
      primary key (disk, k)
    );
    create table if not exists seen (
      id text primary key,
      at timestamptz not null default now()
    );
    alter table disks add column if not exists seal_tx text;
    alter table disks add column if not exists seal_cluster text;
    alter table slots add column if not exists qday_shift integer;
    alter table disks add column if not exists checks integer not null default 0;
    create table if not exists qday (
      id integer primary key default 1 check (id = 1),
      estimate date not null,
      updated_at timestamptz not null default now(),
      shift integer,
      reason text
    );
  `);
}

export async function currentDisk(): Promise<DiskRow | undefined> {
  const r = await pool.query(`select d.*, (select count(*)::int from slots s where s.disk = d.n) as written from disks d order by n desc limit 1`);
  return r.rows[0];
}
export async function disks(from: number, to: number): Promise<DiskRow[]> {
  const r = await pool.query(
    `select d.*, (select count(*)::int from slots s where s.disk = d.n) as written from disks d where n between $1 and $2 order by n`, [from, to]);
  return r.rows;
}
export async function slots(n: number): Promise<SlotRow[]> {
  return (await pool.query(`select * from slots where disk = $1 order by k`, [n])).rows;
}
export async function recentNotes(limit = 6): Promise<string[]> {
  return (await pool.query(`select note from slots order by time desc limit $1`, [limit])).rows.map((r) => r.note);
}
/** The latest saves: what came through (title, year) and the note on it, newest first. */
export async function recentSaves(limit = 3): Promise<{ title: string | null; year: string | null; note: string }[]> {
  return (await pool.query(`select item->>'title' as title, item->>'year' as year, note from slots order by time desc limit $1`, [limit])).rows;
}
/** What one disk holds, newest first (the disk a visitor is reading, so the Overmind can talk about it). */
export async function diskSaves(n: number, limit = 8): Promise<{ title: string | null; year: string | null; note: string }[]> {
  return (await pool.query(`select item->>'title' as title, item->>'year' as year, note from slots where disk = $1 order by k desc limit $2`, [n, limit])).rows;
}
export async function createDisk(n: number, seed: number, fascination: string, dice: Dice) {
  await pool.query(`insert into disks (n, seed, fascination, dice) values ($1, $2, $3, $4) on conflict do nothing`, [n, seed, fascination, dice]);
}
export async function writeSlot(s: Omit<SlotRow, 'time'>) {
  const r = await pool.query(`insert into slots (disk, k, item, note, file, dice, model, qday_shift) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [s.disk, s.k, s.item, s.note, s.file, s.dice, s.model, s.qday_shift]);
  if (s.item) await pool.query(`insert into seen (id) values ($1) on conflict do nothing`, [s.item.id]);
  return r.rows[0] as SlotRow;
}
export async function updateSlotMedia(disk: number, k: number, media: { media?: string; clip?: string }) {
  await pool.query(`update slots set item = item || $3::jsonb where disk = $1 and k = $2 and item is not null`, [disk, k, JSON.stringify(media)]);
}
/** One more visitor checked this disk; returns the new count. */
export async function countCheck(n: number): Promise<number> {
  return (await pool.query(`update disks set checks = checks + 1 where n = $1 returning checks`, [n])).rows[0]?.checks ?? 0;
}
export async function sealDisk(n: number, fingerprint: string) {
  await pool.query(`update disks set sealed_at = now(), fingerprint = $2 where n = $1`, [n, fingerprint]);
}
export interface QdayRow { estimate: string; updated_at: string; shift: number | null; reason: string | null }
/** The Overmind's own guess at Q-Day (created from QDAY_START the first time). */
export async function qday(start: string): Promise<QdayRow> {
  await pool.query(`insert into qday (id, estimate) values (1, $1) on conflict (id) do nothing`, [start]);
  return (await pool.query(`select to_char(estimate, 'YYYY-MM-DD') as estimate, updated_at, shift, reason from qday where id = 1`)).rows[0];
}
/** Moves the guess by `days` (negative is closer) and remembers why. */
export async function shiftQday(days: number, reason: string): Promise<QdayRow> {
  return (await pool.query(
    `update qday set estimate = estimate + $1::int, shift = $1, reason = $2, updated_at = now() where id = 1
     returning to_char(estimate, 'YYYY-MM-DD') as estimate, updated_at, shift, reason`, [days, reason])).rows[0];
}

/** Records the on-chain transaction for a sealed disk. */
export async function setSealTx(n: number, tx: string, cluster: string) {
  await pool.query(`update disks set seal_tx = $2, seal_cluster = $3 where n = $1`, [n, tx, cluster]);
}
/** Sealed disks whose fingerprint isn't on chain yet. */
export async function pendingSeals(): Promise<DiskRow[]> {
  return (await pool.query(`select *, 90 as written from disks where sealed_at is not null and seal_tx is null order by n`)).rows;
}
/** Launch: empties the lineage (disks, slots, the seen list). The wallet is kept. Only run on purpose. */
export async function resetLineage() {
  await pool.query(`truncate slots, disks, seen; delete from qday`); // the q-day guess starts over from QDAY_START too
}
export async function isSeen(ids: string[]) {
  if (!ids.length) return new Set<string>();
  const r = await pool.query(`select id from seen where id = any($1)`, [ids]);
  return new Set<string>(r.rows.map((x) => x.id));
}
