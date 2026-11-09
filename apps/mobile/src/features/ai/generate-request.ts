import type { AiGenerateRequest } from '../../domain/ai/ai.types';

/** The generator builds first: blanks are allowed, so it never sends answers or connections. */
export function buildGenerateRequest(prompt: string, timezone: string): AiGenerateRequest {
  return { prompt: prompt.trim(), timezone, allowBlanks: true };
}

/** A half-made draft belongs to the workspace it was made in: once that workspace is no longer active, forget it. */
export function shouldForgetDraft(stage: 'generate' | 'save', workspaceChanged: boolean): boolean {
  return stage === 'save' && workspaceChanged;
}
