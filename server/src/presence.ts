/**
 * Who's in the room: one per visitor, counted from the open event streams (every page holds one). A visitor is the id
 * their browser sends (?v=), so two tabs are one person; streams without one count alone. Changes are settled for a
 * moment before they go out, so a reload doesn't flicker the number for everyone.
 */
import { EventEmitter } from 'node:events';
import { peak, seen } from './stats.js';

const open = new Map<string, number>(); // visitor → open streams
export const presenceEvents = new EventEmitter();
presenceEvents.setMaxListeners(0);
let anon = 0, told = 0, timer: NodeJS.Timeout | undefined;

export const here = () => open.size;

/** A stream opened; returns its goodbye. */
export function arrive(id: string | null): () => void {
  const v = id && /^[a-z0-9]{6,32}$/i.test(id) ? id : `anon-${++anon}`;
  open.set(v, (open.get(v) ?? 0) + 1);
  if (id) seen(v);
  peak(open.size);
  changed();
  return () => {
    const n = (open.get(v) ?? 1) - 1;
    if (n > 0) open.set(v, n); else open.delete(v);
    changed();
  };
}

function changed() {
  clearTimeout(timer);
  timer = setTimeout(() => { if (open.size !== told) { told = open.size; presenceEvents.emit('presence', { here: told }); } }, 1500);
}
