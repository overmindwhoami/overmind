/**
 * What visitors are doing, told to everyone in the room: someone opened a disk, checked one, shared one, is talking to
 * the Overmind, is reading the docs. Only the kind and a disk number ever go out (nothing a visitor typed, nothing that names them); each
 * event carries a tag only the sender's own page recognises, so it can leave its own actions out. Repeats from one
 * visitor and floods from one address are dropped.
 */
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { count } from './stats.js';

export type Kind = 'open' | 'check' | 'share' | 'talk' | 'docs' | 'picked' | 'passed' | 'launch';
export interface Activity { kind: Kind; disk?: number; match?: boolean; checks?: number; symbol?: string; by: string; at: number }

export const activityEvents = new EventEmitter();
activityEvents.setMaxListeners(0);
const SALT = randomBytes(16);
/** A visitor's tag: stable while the server runs, meaningless outside it. */
export const tagOf = (visitor: string) => createHash('sha256').update(SALT).update(visitor).digest('hex').slice(0, 12);
/** The visitor behind a request: the id the page sent, else the address it came from. */
export const visitorOf = (v: string | null | undefined, ip: string) => (v && /^[a-z0-9]{6,32}$/i.test(v) ? v : `ip:${ip}`);

const recent: Activity[] = [];
const repeats = new Map<string, number>(); // `${by}:${kind}:${disk}` → last time told
const perIp = new Map<string, number[]>(); // address → times told, the last minute
const quietAt = new Map<Kind, number>(); // the kinds without a disk: one line at a time is plenty

/** Tells the room, unless it's a repeat (the same visitor, kind and disk within a minute) or a flood. */
export function tell(a: Omit<Activity, 'at'>, ip: string): boolean {
  const now = Date.now();
  const key = `${a.by}:${a.kind}:${a.disk ?? ''}`;
  if (now - (repeats.get(key) ?? 0) < 60_000) return false;
  const times = (perIp.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= 8) return false;
  if (a.disk === undefined && now - (quietAt.get(a.kind) ?? 0) < 20_000) return false;
  if (a.disk === undefined) quietAt.set(a.kind, now);
  repeats.set(key, now);
  times.push(now); perIp.set(ip, times);
  if (repeats.size > 20_000) for (const [k, t] of repeats) if (now - t > 60_000) repeats.delete(k);
  if (perIp.size > 20_000) for (const [k, t] of perIp) if (!t.some((x) => now - x < 60_000)) perIp.delete(k);
  if (a.kind !== 'talk' && a.kind !== 'passed') count(a.kind);
  const ev: Activity = { ...a, at: now };
  recent.push(ev);
  if (recent.length > 12) recent.shift();
  activityEvents.emit('activity', ev);
  return true;
}

/** The last few things that happened (the last ten minutes), for someone walking in. */
export const lately = () => recent.filter((a) => Date.now() - a.at < 10 * 60_000).slice(-3);
