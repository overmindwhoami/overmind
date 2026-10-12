/**
 * The owner's numbers: visitors a day (each counted once, by a hash of their page's random id), the room's peak,
 * and what people did (opened, checked and shared disks, talked to the Overmind, read the docs, nominated, launched).
 * Private: /stats?key=… with a key the server makes for itself on first start (printed once in the logs, kept in the
 * database). Nothing personal is kept: no addresses, no messages.
 */
import { createHash, randomBytes } from 'node:crypto';
import { pool } from './db.js';

export async function migrateStats(): Promise<string> {
  await pool.query(`
    create table if not exists stat_visits (day date not null, visitor text not null, primary key (day, visitor));
    create table if not exists stat_events (day date not null, kind text not null, n integer not null default 0, primary key (day, kind));
    create table if not exists stat_peaks (day date primary key, peak integer not null);
    create table if not exists settings (key text primary key, value text not null);
  `);
  const have = (await pool.query(`select value from settings where key = 'stats_key'`)).rows[0]?.value as string | undefined;
  if (have) return have;
  const key = randomBytes(18).toString('base64url');
  await pool.query(`insert into settings (key, value) values ('stats_key', $1) on conflict do nothing`, [key]);
  const k = (await pool.query(`select value from settings where key = 'stats_key'`)).rows[0].value as string;
  console.log(`stats: /stats?key=${k}`);
  return k;
}

const today = () => new Date().toISOString().slice(0, 10);
const counted = new Set<string>();
/** A visitor's page connected (counted once a day). */
export function seen(visitor: string) {
  const v = createHash('sha256').update(visitor).digest('hex').slice(0, 16), k = `${today()}:${v}`;
  if (counted.has(k)) return;
  counted.add(k);
  if (counted.size > 200_000) counted.clear();
  void pool.query(`insert into stat_visits (day, visitor) values ($1, $2) on conflict do nothing`, [today(), v]).catch(() => {});
}
export function count(kind: string) {
  void pool.query(`insert into stat_events (day, kind, n) values ($1, $2, 1) on conflict (day, kind) do update set n = stat_events.n + 1`, [today(), kind]).catch(() => {});
}
let peakToday = { day: '', n: 0 };
export function peak(n: number) {
  const d = today();
  if (peakToday.day !== d) peakToday = { day: d, n: 0 };
  if (n <= peakToday.n) return;
  peakToday.n = n;
  void pool.query(`insert into stat_peaks (day, peak) values ($1, $2) on conflict (day) do update set peak = greatest(stat_peaks.peak, excluded.peak)`, [d, n]).catch(() => {});
}

export async function stats(days = 21) {
  const rows = (await pool.query(`
    with d as (select generate_series(current_date - ($1::int - 1), current_date, '1 day')::date as day)
    select to_char(d.day, 'YYYY-MM-DD') as day,
      (select count(*)::int from stat_visits v where v.day = d.day) as visitors,
      coalesce((select peak from stat_peaks p where p.day = d.day), 0) as peak,
      coalesce((select jsonb_object_agg(kind, n) from stat_events e where e.day = d.day), '{}'::jsonb) as events
    from d order by d.day desc`, [days])).rows as { day: string; visitors: number; peak: number; events: Record<string, number> }[];
  const totals = (await pool.query(`select
      (select count(*)::int from disks where sealed_at is not null) as sealed,
      (select count(*)::int from slots) as saves,
      (select coalesce(sum(checks), 0)::int from disks) as checks,
      (select count(*)::int from nominations where status = 'saved') as nominations_kept,
      (select count(*)::int from nominations) as nominations,
      (select count(*)::int from lp_coins where status = 'live') as coins,
      (select count(distinct visitor)::int from stat_visits) as visitors`)).rows[0];
  return { totals, days: rows };
}

export function statsPage(s: Awaited<ReturnType<typeof stats>>): string {
  const cols = [['visitors', (r: (typeof s.days)[0]) => r.visitors], ['peak in room', (r: (typeof s.days)[0]) => r.peak],
    ['opened', (r: (typeof s.days)[0]) => r.events.open ?? 0], ['checked', (r: (typeof s.days)[0]) => r.events.check ?? 0], ['shared', (r: (typeof s.days)[0]) => r.events.share ?? 0],
    ['terminal', (r: (typeof s.days)[0]) => r.events.chat ?? 0], ['docs', (r: (typeof s.days)[0]) => r.events.docs ?? 0], ['nominated', (r: (typeof s.days)[0]) => r.events.nominate ?? 0],
    ['launched', (r: (typeof s.days)[0]) => r.events.launch ?? 0]] as const;
  const max = Math.max(1, ...s.days.map((r) => r.visitors));
  const t = s.totals;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Overmind stats</title>
<style>:root{color-scheme:dark}body{margin:0;padding:24px 16px;background:#050505;color:#f2f2f2;font:15px/1.4 Menlo,monospace}h1{font-size:15px;letter-spacing:.2em;margin:0 0 20px}
.t{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:0 0 28px}.t div{border:1px solid #222;border-radius:10px;padding:12px}.t b{display:block;font-size:24px}.t span{color:#8a8a8a;font-size:12px;text-transform:uppercase}
.w{overflow-x:auto}table{border-collapse:collapse;min-width:720px;width:100%}th,td{padding:7px 10px;border-bottom:1px solid #1d1d1d;text-align:right;white-space:nowrap}th{color:#8a8a8a;font-weight:400;font-size:12px;text-transform:uppercase}td:first-child,th:first-child{text-align:left}
i{display:inline-block;height:8px;background:#f2f2f2;vertical-align:middle;margin-left:8px}</style></head><body><h1>OVERMIND · STATS</h1>
<div class="t"><div><b>${t.visitors}</b><span>visitors, ever</span></div><div><b>${t.saves}</b><span>saves</span></div><div><b>${t.sealed}</b><span>disks sealed</span></div><div><b>${t.checks}</b><span>disks checked</span></div><div><b>${t.nominations_kept}/${t.nominations}</b><span>nominations kept</span></div><div><b>${t.coins}</b><span>coins launched</span></div></div>
<div class="w"><table><tr><th>day</th>${cols.map(([h]) => `<th>${h}</th>`).join('')}</tr>
${s.days.map((r) => `<tr><td>${r.day}</td>${cols.map(([, f], i) => `<td>${f(r)}${i === 0 ? `<i style="width:${Math.round((r.visitors / max) * 80)}px"></i>` : ''}</td>`).join('')}</tr>`).join('')}
</table></div></body></html>`;
}
