import { AiError } from '../domain/errors';
import { Capability, GenerationResult, generationResultSchema } from '../domain/workflow-generation/generation-result';
import { GENERATE_SYSTEM } from '../prompts/prompts';
import { LlmProvider } from './llm-provider';

export async function generate(
  provider: LlmProvider,
  input: { prompt: string; timezone?: string; capabilities: Capability[] },
  signal: AbortSignal,
): Promise<GenerationResult> {
  const output = await provider.completeJson({ system: GENERATE_SYSTEM, user: JSON.stringify(input) }, signal);
  const parsed = generationResultSchema(input.capabilities).safeParse(output);
  if (!parsed.success) throw new AiError('AI_OUTPUT_INVALID');
  return parsed.data;
}
