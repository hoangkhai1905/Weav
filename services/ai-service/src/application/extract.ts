import { AiError } from '../domain/errors';
import { checkOutputSchema, matchesOutputSchema } from '../domain/schema/output-schema-profile';
import { EXTRACT_SYSTEM } from '../prompts/prompts';
import { LlmProvider } from './llm-provider';

export async function extract(
  provider: LlmProvider,
  input: { text: string; outputSchema: Record<string, unknown>; instructions?: string },
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!checkOutputSchema(input.outputSchema)) throw new AiError('AI_SCHEMA_INVALID');
  const output = await provider.completeJson({
    system: EXTRACT_SYSTEM,
    user: JSON.stringify({ schema: input.outputSchema, instructions: input.instructions ?? null, text: input.text }),
  }, signal);
  if (!matchesOutputSchema(input.outputSchema, output)) throw new AiError('AI_OUTPUT_INVALID');
  return output;
}
