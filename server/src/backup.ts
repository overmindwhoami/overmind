/**
 * The nightly backup: the whole record (disks, slots, nominations, launched coins and their snapshots, the Q-Day
 * clock), one JSON line per row, gzipped, into the bucket at backups/YYYY-MM-DD.jsonl.gz. Private: never served.
 * Secrets (wallet keys) are not in it; the database keeps those.
 */
import { gzipSync } from 'node:zlib';
import { pool } from './db.js';
import { putPrivate } from './media.js';

const TABLES: [string, string][] = [
  ['disks', 'select n, seed, started_at, sealed_at, fingerprint, fascination, checks, seal_tx, seal_cluster from disks order by n'],
  ['slots', 'select * from slots order by disk, k'],
  ['qday', 'select * from qday'],
  ['nominations', 'select id, url, item, status, disk, k, created_at, decided_at from nominations order by id'],
  ['lp_coins', 'select mint, name, ticker, description, image, launcher, status, create_sig, note, hidden, created_at, live_at from lp_coins order by created_at'],
  ['lp_snapshots', 'select mint, n, at, slot, holders, held, fingerprint, record, memo_tx from lp_snapshots order by mint, n'],
];

export async function backup(): Promise<{ key: string; rows: number; bytes: number }> {
  const lines: string[] = [JSON.stringify({ backup: 'overmind', at: new Date().toISOString() })];
  for (const [table, sql] of TABLES) {
    const rows = await pool.query(sql).then((r) => r.rows, () => [] as unknown[]); // a table that doesn't exist yet is skipped
    for (const row of rows) lines.push(JSON.stringify({ table, row }));
  }
  const body = gzipSync(Buffer.from(lines.join('\n') + '\n'));
  const key = `backups/${new Date().toISOString().slice(0, 10)}.jsonl.gz`;
  await putPrivate(key, body, 'application/gzip');
  return { key, rows: lines.length - 1, bytes: body.length };
}

/** Once a day (checked hourly; the day it last ran is remembered in the database). */
export function scheduleBackups() {
  const run = async () => {
    const day = new Date().toISOString().slice(0, 10);
    const last = (await pool.query(`select value from settings where key = 'backup_day'`).catch(() => ({ rows: [] }))).rows[0]?.value;
    if (last === day) return;
    const b = await backup();
    await pool.query(`insert into settings (key, value) values ('backup_day', $1) on conflict (key) do update set value = excluded.value`, [day]);
    console.log(`backup ${b.key}: ${b.rows} rows, ${(b.bytes / 1024).toFixed(0)} KB`);
  };
  setTimeout(() => void run().catch((e) => console.warn('backup failed', (e as Error).message)), 10 * 60_000);
  setInterval(() => void run().catch((e) => console.warn('backup failed', (e as Error).message)), 60 * 60_000);
}
