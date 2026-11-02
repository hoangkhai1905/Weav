import { AiError } from '../domain/errors';
import {
  Capability,
  GenerationResult,
  generationResultSchema,
} from '../domain/workflow-generation/generation-result';
import {
  GENERATE_SYSTEM,
  GENERATE_ALLOW_BLANKS_RULE,
} from '../prompts/prompts';
import { LlmProvider } from './llm-provider';

export async function generate(
  provider: LlmProvider,
  input: {
    prompt: string;
    timezone?: string;
    allowBlanks?: boolean;
    capabilities: Capability[];
  },
  signal: AbortSignal,
): Promise<GenerationResult> {
  const output = await provider.completeJson(
    {
      system: input.allowBlanks
        ? `${GENERATE_SYSTEM}
${GENERATE_ALLOW_BLANKS_RULE}`
        : GENERATE_SYSTEM,
      user: JSON.stringify(input),
    },
    signal,
  );
  const parsed = generationResultSchema(input.capabilities).safeParse(output);
  if (!parsed.success) throw new AiError('AI_OUTPUT_INVALID');
  return parsed.data;
}
