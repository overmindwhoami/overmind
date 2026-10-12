/**
 * The Overmind's line to Claude, either way it's paid for:
 *   BEDROCK_API_KEY     Claude in Amazon Bedrock (a Bedrock API key; billed on the AWS account), region BEDROCK_REGION
 *                       (default us-east-1); models are called by their US inference profiles (us.anthropic.claude-…)
 *   ANTHROPIC_API_KEY   the Claude API
 * Bedrock is used when its key is set. Without either, every caller falls back to its written voice.
 */
import Anthropic from '@anthropic-ai/sdk';
import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';

export const PROVIDER: 'bedrock' | 'anthropic' | undefined = process.env.BEDROCK_API_KEY ? 'bedrock' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : undefined;
const REGION = process.env.BEDROCK_REGION ?? 'us-east-1';

/** A client for this provider (both serve the same Messages API; the Bedrock client leaves out batches and token counting). */
export function claude(opts: { maxRetries: number; timeout: number }): Anthropic | undefined {
  if (PROVIDER === 'bedrock') return new AnthropicBedrock({ apiKey: process.env.BEDROCK_API_KEY, awsRegion: REGION, ...opts }) as unknown as Anthropic;
  if (PROVIDER === 'anthropic') return new Anthropic(opts);
  return undefined;
}
/** A model as this provider names it: claude-opus-5-5 is us.anthropic.claude-opus-5-5 on Bedrock. */
export const modelId = (m: string) => (PROVIDER === 'bedrock' && !m.includes('anthropic.') ? `us.anthropic.${m}` : m);
/** For /health and the logs: which provider and model, never a key. */
export const describe = (m: string) => (PROVIDER ? `${m} (${PROVIDER === 'bedrock' ? `bedrock ${REGION}` : 'claude api'})` : 'template (no key)');
