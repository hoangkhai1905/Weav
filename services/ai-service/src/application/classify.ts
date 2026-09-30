import { AiError } from '../domain/errors';
import { CLASSIFY_SYSTEM } from '../prompts/prompts';
import { LlmProvider } from './llm-provider';

export async function classify(
  provider: LlmProvider,
  input: { text: string; categories: string[] },
  signal: AbortSignal,
): Promise<{ category: string; confidence: number }> {
  const output = await provider.completeJson({ system: CLASSIFY_SYSTEM, user: JSON.stringify(input) }, signal);
  const { category, confidence } = output;
  if (typeof category !== 'string' || !input.categories.includes(category)
      || typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1)) {
    throw new AiError('AI_OUTPUT_INVALID');
  }
  return { category, confidence };
}
