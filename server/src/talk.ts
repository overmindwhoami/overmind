/**
 * The terminal: talk to the Overmind. Each message gets one short Claude reply in its own voice, grounded in what it is
 * actually doing (the disk it's on, its latest saves and notes, its Q-Day guess). Public and unauthenticated, so it is
 * fenced: a rate limit per visitor, a daily cap across everyone, short replies, and the written voice (answers.ts) when
 * there is no key, the cap is hit, or the call fails.
 */
import { IDENTITY, PRIVACY, RULES, VOICE } from './persona.js';
import { blocked, privateHit } from './privacy.js';
import { claude, modelId } from './claude.js';
import Anthropic from '@anthropic-ai/sdk';
import { answer, type Facts } from './answers.js';
import { currentDisk, diskSaves, qday, recentSaves } from './db.js';
import { LP_LIVE } from './lp/solana.js';
import { lutAddress } from './lp/lut.js';

const MODEL = process.env.CHAT_MODEL ?? 'claude-haiku-5-5';
const client = claude({ maxRetries: 1, timeout: 25_000 });
const PER_VISITOR = Number(process.env.CHAT_PER_10MIN ?? 12); // messages per visitor per 10 minutes
const DAILY = Number(process.env.CHAT_DAILY_CAP ?? 3000); // replies a day across everyone
const MAX_IN = 400; // characters a visitor can send

// who it is and how it sounds (persona.ts), then the terminal's own manners. One unchanging block: cached.
const SYSTEM = `${IDENTITY}

${VOICE}

At the terminal. A visitor is sitting at the old computer in your room, typing to you. Sometimes they have a disk in the reader and are asking from inside it; then that disk is what they mean.
- Answer what was asked, first. One or two sentences, under 200 characters, unless they ask for more.
- Be specific: use the facts under "Right now" (the disk, the saves, the clock) rather than general lines.
- No filler openings. Don't end on a question unless you need the answer.
- Name a command only when it is the answer: HELP, WHY, DIR, QDAY, CHECK, EXPOSED <solana address>, SAVE <link>, MINE.
- Each sealed disk's fingerprint goes on Solana in a memo a minute or two after it seals; CHECK shows the transaction. Don't quote a transaction you weren't given.
- What visitors type here isn't kept, and you don't remember them between visits. Say so if they ask.

${PRIVACY}

${RULES}`;

const hits = new Map<string, number[]>();
let day = '', today = 0;
let restUntil = 0; // the API refused for billing: the written voice answers until then

export async function talk(ip: string, history: { role: 'user' | 'assistant'; content: string }[], reading?: number): Promise<{ reply: string; model: string; status?: string }> {
  // limits: per visitor (a sliding 10 minutes) and per day
  const now = Date.now(), list = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
  if (list.length >= PER_VISITOR) return { reply: "slow down. i only write once a minute; i can't answer faster than that either. try again in a few minutes.", model: 'limit', status: 'limited' };
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 600_000)) hits.delete(k);
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; today = 0; }

  const msgs = history.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, MAX_IN) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return { reply: 'say something.', model: 'template' };

  // what it is doing right now, so it can talk about it truthfully (either voice)
  const disk = await currentDisk().catch(() => undefined);
  // a visitor talking from inside a disk: that disk is what they're asking about
  const open = Number.isInteger(reading) && reading! >= 0 && reading! < 100_000 ? reading : undefined;
  const saves = await (open !== undefined ? diskSaves(open, 8) : recentSaves(5)).catch(() => []);
  const clock = await qday(process.env.QDAY_START ?? '2032-01-01').catch(() => undefined);
  const facts: Facts = { disk: disk?.n, written: disk?.written, sealed: disk?.n, qday: clock?.estimate, reason: clock?.reason, saves, reading: open, coinLive: !!process.env.OMD_MINT, lpOpen: LP_LIVE && !!(await lutAddress().catch(() => '')) };
  const written = (status: string) => ({ reply: answer(msgs[msgs.length - 1].content, facts, msgs.length + now / 7919), model: 'written', status });
  if (!client) return written('asleep');
  if (now < restUntil) return written('resting');
  if (today >= DAILY) return written('capped');
  today++;

  const context = [
    disk ? `You are writing disk ${String(disk.n + 1).padStart(4, '0')}, ${disk.written} of 90 slots written. ${disk.n} disks sealed so far.` : '',
    clock ? `Your Q-Day guess: ${clock.estimate}${clock.reason ? ` (last moved: ${clock.reason})` : ''}.` : '',
    process.env.OMD_MINT ? '$OMD is live on pump.fun; its numbers are on the board.' : '$OMD has not launched yet; the board says so.',
    facts.lpOpen ? 'The launchpad is open: anyone can launch a coin at the duplicator.' : LP_LIVE ? 'The launchpad is switched on and opens in a moment (its treasury is getting ready).' : 'The launchpad opens soon.',
    open !== undefined ? `The visitor has disk ${String(open + 1).padStart(4, '0')} in the reader and is asking from inside it. What's on that disk, newest first:\n${saves.map((x) => `- ${x.title ?? '(nothing came through)'}${x.year ? ` (${x.year})` : ''}: ${x.note}`).join('\n') || '- nothing yet'}` :
    saves.length ? `Your latest saves, newest first:\n${saves.map((x) => `- ${x.title ?? '(nothing came through)'}${x.year ? ` (${x.year})` : ''}: ${x.note}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await client.messages.create({
      model: modelId(MODEL), max_tokens: 220,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }, { type: 'text', text: `Right now:\n${context}` }], // the first block is the same every time: cached
      messages: msgs,
    });
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ').trim();
    const hit = privateHit(text);
    if (hit) { blocked('terminal reply', hit); return { reply: "that's not on the record. ask me about what i'm keeping, or type WHY.", model: MODEL, status: 'held' }; }
    return { reply: text.slice(0, 600) || '…', model: MODEL };
  } catch (e) {
    console.warn('talk failed', e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : String(e).slice(0, 160));
    if (e instanceof Anthropic.APIError && /credit balance|billing/i.test(e.message)) restUntil = Date.now() + 10 * 60_000;
    return written('error');
  }
}
