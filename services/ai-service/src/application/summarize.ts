import { AiError } from '../domain/errors';
import { truncateGraphemes } from '../domain/text/unicode';
import { SUMMARIZE_SYSTEM } from '../prompts/prompts';
import { LlmProvider } from './llm-provider';

export async function summarize(
  provider: LlmProvider,
  input: { text: string; maxLength: number },
  signal: AbortSignal,
): Promise<{ summary: string; truncated: boolean }> {
  const output = await provider.completeJson({ system: SUMMARIZE_SYSTEM, user: JSON.stringify(input) }, signal);
  if (typeof output.summary !== 'string' || output.summary.trim() === '') throw new AiError('AI_OUTPUT_INVALID');
  const { text, truncated } = truncateGraphemes(output.summary, input.maxLength);
  if (text === '') throw new AiError('AI_OUTPUT_INVALID');
  return { summary: text, truncated };
}
