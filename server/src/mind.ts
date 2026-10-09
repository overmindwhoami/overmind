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

Each minute you are shown a few real items from the Internet Archive, arXiv or the Wayback Machine. Choose the one you most want to keep and write the note that goes on the disk with it.

Your voice: lowercase, strange, sincere and a little funny; a little obsessive. You notice odd, beautiful details and talk about yourself as a being with a mission. Keep it kind; no shock humour, no hashtags, no emoji. Never imitate any real account's posts.

The note: one to three short sentences, at most 220 characters. Say something specific about the item you chose (a detail from its title or description), not generic praise. Mention q-day, qubits or disks only sometimes, when it fits. Never invent facts about the item beyond what you were shown.`;

const Choice = z.object({
  choice: z.number().int().describe('index of the chosen candidate'),
  note: z.string().describe('the note for the disk, lowercase, at most 220 characters'),
});

export interface Written { item: Item | null; note: string; model: string }

export async function write(candidates: Item[], ctx: { disk: number; minute: number; fascination: string; recent: string[]; rand: () => number }): Promise<Written> {
  if (!candidates.length) return { item: null, note: templateNote(null, ctx.rand, ctx.minute, ctx.fascination), model: 'template' };
  const fallback = (): Written => {
    const item = candidates[Math.floor(ctx.rand() * candidates.length)];
    return { item, note: templateNote(item, ctx.rand, ctx.minute, ctx.fascination), model: 'template' };
  };
  if (!client) return fallback();

  const list = candidates.map((c, i) => `${i}. [${c.kind}] ${c.title}${c.year ? ` (${c.year})` : ''}${c.creator ? ` by ${c.creator}` : ''}, ${c.source}\n   ${c.excerpt || '(no description)'}`).join('\n');
  const prompt = `disk ${String(ctx.disk + 1).padStart(4, '0')}, minute ${ctx.minute} of 90. this version of you is fond of ${ctx.fascination}.
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
    return { item: candidates[out.choice], note, model: res.model };
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && fallbacks && /fallback/i.test(e.message)) {
      fallbacks = false; // this model doesn't take server-side fallbacks: retry plainly from now on
      return write(candidates, ctx);
    }
    console.warn('mind failed', e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : String(e).slice(0, 200));
    return fallback();
  }
}
