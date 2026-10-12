// Checks the Claude key the server would use (Bedrock or the Claude API), one call for each way it talks: the terminal
// (a short reply), the disk notes (a structured choice, on the notes model), and a launch note. Prints which provider and
// model answered, never the key.
//   BEDROCK_API_KEY=… npm run claude:check        (or ANTHROPIC_API_KEY=…)
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { claude, describe, modelId, PROVIDER } from '../src/claude.js';

const CHAT = process.env.CHAT_MODEL ?? 'claude-haiku-5-5', NOTES = process.env.OVERMIND_MODEL ?? 'claude-opus-5-5';
const results: boolean[] = [];
const ok = (what: string, pass: boolean, detail = '') => { results.push(pass); console.log(`  ${pass ? '✓' : '✗'} ${what}${detail ? `: ${detail}` : ''}`); };
console.log(`provider: ${PROVIDER ?? 'none'} · terminal ${describe(CHAT)} · notes ${describe(NOTES)}`);
const c = claude({ maxRetries: 1, timeout: 60_000 });
if (!c) { ok('a key is set', false, 'neither BEDROCK_API_KEY nor ANTHROPIC_API_KEY'); process.exit(1); }
try {
  const t = performance.now();
  const r = await c.messages.create({ model: modelId(CHAT), max_tokens: 60, system: 'You are the Overmind. lowercase, one short sentence.', messages: [{ role: 'user', content: 'hello, are you awake?' }] });
  const text = r.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ');
  ok('the terminal answers', !!text.trim(), `${r.model} in ${Math.round(performance.now() - t)} ms: "${text.trim().slice(0, 90)}"`);
} catch (e) { ok('the terminal answers', false, (e as Error).message.slice(0, 240)); }
try {
  const t = performance.now();
  const r = await c.beta.messages.parse({
    model: modelId(NOTES), max_tokens: 2000, system: 'You are the Overmind, choosing what to keep on a floppy disk before Q-Day. lowercase.',
    messages: [{ role: 'user', content: 'candidates:\n0. Lamport signatures (1979), the first one-time signature\n1. a weather report from 1923\nchoose one and write a short note.' }],
    output_config: { effort: 'low', format: betaZodOutputFormat(z.object({ choice: z.number().int(), note: z.string() })) },
  });
  ok('a disk note, structured, on the notes model', !!r.parsed_output?.note, `${r.model} in ${Math.round(performance.now() - t)} ms: #${r.parsed_output?.choice} "${r.parsed_output?.note.slice(0, 90)}"`);
} catch (e) { ok('a disk note, structured, on the notes model', false, (e as Error).message.slice(0, 240)); }
const failed = results.filter((r) => !r).length;
console.log(failed ? `\nCLAUDE CHECK: ${failed} FAILED` : `\nCLAUDE CHECK PASSED (${results.length})`);
process.exit(failed ? 1 : 0);
