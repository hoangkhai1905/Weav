import type { AiGenerateRequest } from '../../domain/ai/ai.types';

/** The generator builds first: blanks are allowed, so it never sends answers or connections. */
export function buildGenerateRequest(prompt: string, timezone: string): AiGenerateRequest {
  return { prompt: prompt.trim(), timezone, allowBlanks: true };
}
