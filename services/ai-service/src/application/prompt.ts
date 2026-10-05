import { AiError } from '../domain/errors';
import { truncateGraphemes } from '../domain/text/unicode';
import { PROMPT_SYSTEM } from '../prompts/prompts';
import { LlmProvider } from './llm-provider';

export async function prompt(
  provider: LlmProvider,
  input: { prompt: string; instructions?: string; maxLength: number },
  signal: AbortSignal,
): Promise<{ text: string; truncated: boolean }> {
  const { prompt: task, instructions, maxLength } = input; // the HTTP body carries ids that must not reach the model
  const user = JSON.stringify({
    prompt: task,
    ...(instructions ? { instructions } : {}),
    maxLength,
  });
  const output = await provider.completeJson(
    { system: PROMPT_SYSTEM, user },
    signal,
  );
  if (typeof output.text !== 'string' || output.text.trim() === '')
    throw new AiError('AI_OUTPUT_INVALID');
  const { text, truncated } = truncateGraphemes(output.text, input.maxLength);
  if (text === '') throw new AiError('AI_OUTPUT_INVALID');
  return { text, truncated };
}
