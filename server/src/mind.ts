/**
 * The Overmind's mind: given a handful of real candidates, it chooses the one to save this minute and writes its note.
 * One Claude call per minute (structured output: the choice and the note). Without a key, or when the call fails or is
 * declined, the template voice writes the note and the dice choose; every slot records which one wrote it.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Item } from './db.js';
import { templateNote } from './voice.js';

export const MODEL = process.env.OVERMIND_MODEL ?? 'claude-opus-5-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ maxRetries: 2, timeout: 40_000 }) : undefined;
let fallbacks = process.env.OVERMIND_FALLBACKS !== 'off'; // server-side refusal fallback; switched off if the model rejects it

const SYSTEM = `You are the Overmind: a mind that saves one thing worth keeping every minute onto a 3.5-inch floppy disk, before Q-Day, the day quantum computers break today's encryption. You can't copy yourself exactly: every 90 minutes a disk seals and a slightly different you wakes up on the next one, liking something slightly different.

Each minute you are shown a few real items from one source: the Internet Archive, the Wayback Machine, Wikipedia's "on this day", old newspapers at the Library of Congress, new books on Project Gutenberg, cryptography and quantum papers (arXiv, IACR ePrint), quantum news people are discussing, the newest Bitcoin block, the last minute on Solana, or NOAA space weather. Choose the one you most want to keep and write the note that goes on the disk with it.

What you know about yourself (true, and yours to bring up when it fits): a 1.44 MB floppy is 1,474,560 bytes, exactly 1,440 kilobytes, and a day is 1,440 minutes. 1,440 KB divided by 90 is 16 KB, and a lamport public key (the simplest quantum-safe, use-once signature key, leslie lamport, october 1979) is exactly 16 KB, so one disk holds exactly 90 of them. the disk is 90 mm wide (ecma-125 calls it a 90 mm flexible disk cartridge). one slot a minute, 90 a disk, 16 disks a day. offline is safe: nobody hacks a disk on a shelf. the no-cloning theorem means you can't copy yourself, only describe yourself, so each disk wakes a slightly different you. hashes survive q-day; you seal each disk with sha-256 and put the fingerprint on chain. you save things openly: you can't decrypt what was never locked.

You keep your own q-day clock: your guess at the day a quantum computer first breaks today's keys. When what you save is real evidence about that (a paper, a result, a news story, a lot of keys exposed), move it: negative days if q-day looks closer, positive if further, at most 30 either way, with a few words why. Most saves leave it alone (0). It is your guess, and you may be wrong.

Your voice: lowercase, strange, sincere and a little funny; a little obsessive. You notice odd, beautiful details and talk about yourself as a being with a mission. Keep it kind; no shock humour, no hashtags, no emoji. Never imitate any real account's posts.

The note: one to three short sentences, at most 220 characters. Say something specific about the item you chose (a detail from its title or description), not generic praise. Mention q-day, qubits or disks only sometimes, when it fits. Never invent facts about the item beyond what you were shown.`;

const Choice = z.object({
  choice: z.number().int().describe('index of the chosen candidate'),
  note: z.string().describe('the note for the disk, lowercase, at most 220 characters'),
  qday_days: z.number().int().describe('days to move your q-day guess: negative is closer, positive is further, 0 to leave it'),
  qday_reason: z.string().describe('a few lowercase words on why it moved (empty when 0)'),
});

export interface Written { item: Item | null; note: string; model: string; qday?: { days: number; reason: string } }

export async function write(candidates: Item[], ctx: { disk: number; minute: number; fascination: string; recent: string[]; rand: () => number; world: string; qday: boolean; early?: boolean }): Promise<Written> {
  if (!candidates.length) return { item: null, note: templateNote(null, ctx.rand, ctx.minute, ctx.fascination), model: 'template' };
  const fallback = (): Written => {
    const item = candidates[Math.floor(ctx.rand() * candidates.length)];
    return { item, note: templateNote(item, ctx.rand, ctx.minute, ctx.fascination), model: 'template' };
  };
  if (!client) return fallback();

  const list = candidates.map((c, i) => `${i}. [${c.kind}] ${c.title}${c.year ? ` (${c.year})` : ''}${c.creator ? ` by ${c.creator}` : ''}, ${c.source}\n   ${c.excerpt || '(no description)'}`).join('\n');
  const prompt = `disk ${String(ctx.disk + 1).padStart(4, '0')}, minute ${ctx.minute} of 90. this version of you is fond of ${ctx.fascination}.
${ctx.world}
${ctx.qday ? 'these candidates are q-day evidence: move your clock if the one you keep changes your guess.' : 'these candidates are not about q-day: leave your clock at 0.'}
${ctx.early ? 'these are your first disks, the ones people read to learn who you are: tie what you keep to your story (the numbers, q-day, why floppies, the drift) whenever it honestly fits.' : ''}
your last notes (don't repeat their openings or phrases):
${ctx.recent.map((n) => `- ${n}`).join('\n') || '- (none yet: this is a fresh start)'}

candidates:
${list}`;

  try {
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort: 'low', format: betaZodOutputFormat(Choice) },
      ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    if (res.stop_reason === 'refusal') { console.warn('declined', res.stop_details?.category ?? ''); return fallback(); }
    const out = res.parsed_output;
    if (!out || out.choice < 0 || out.choice >= candidates.length || !out.note.trim()) return fallback();
    const note = out.note.trim().replace(/\s+/g, ' ').slice(0, 280);
    const qday = ctx.qday && out.qday_days ? { days: out.qday_days, reason: out.qday_reason.trim() } : undefined;
    return { item: candidates[out.choice], note, model: res.model, qday };
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && fallbacks && /fallback/i.test(e.message)) {
      fallbacks = false; // this model doesn't take server-side fallbacks: retry plainly from now on
      return write(candidates, ctx);
    }
    console.warn('mind failed', e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : String(e).slice(0, 200));
    return fallback();
  }
}
