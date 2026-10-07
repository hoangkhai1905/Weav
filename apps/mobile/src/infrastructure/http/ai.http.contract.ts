import type { AxiosRequestConfig } from 'axios';
import type { AiGenerateRequest } from '../../domain/ai/ai.types';
import type { GenerateWorkflowRequestDto } from './ai.dto';
import { isUuid } from './notification.http.contract';
import { workspaceWorkflowsPath } from './workflow.http.contract';

export const AI_PROMPT_MAX_LENGTH = 4000;
/** The gateway deadline is 80 s; the mobile client waits a little longer to see its error. */
export const GENERATE_TIMEOUT_MS = 85_000;

const MAX_ANSWERS = 10;
// Java adds key length + value length + 6 per answer to the prompt and caps the total at 3900.
const MAX_PROMPT_WITH_ANSWERS = 3900;

function codePoints(value: string): number {
  return Array.from(value).length;
}

export function assertGenerateRequest(request: AiGenerateRequest): void {
  const promptLength = codePoints(request.prompt);
  if (typeof request.prompt !== 'string' || promptLength < 1 || promptLength > AI_PROMPT_MAX_LENGTH) {
    throw new Error('Invalid prompt.');
  }
  if (request.timezone !== undefined && (request.timezone.length < 1 || request.timezone.length > 64)) {
    throw new Error('Invalid timezone.');
  }
  if (request.connections) {
    const entries = Object.entries(request.connections);
    if (entries.length > MAX_ANSWERS || entries.some(([key, id]) => key.length > 128 || !isUuid(id))) {
      throw new Error('Invalid connections.');
    }
  }
  if (request.answers) {
    const entries = Object.entries(request.answers);
    let total = promptLength;
    for (const [key, value] of entries) {
      if (key.trim() === '' || key.length > 200 || value.trim() === '') throw new Error('Invalid answers.');
      total += key.length + codePoints(value) + 6;
    }
    if (entries.length > MAX_ANSWERS || total > MAX_PROMPT_WITH_ANSWERS) {
      throw new Error('Answers are too long.');
    }
  }
}

/** POST .../workflows/generate: slow route, so it carries its own timeout. */
export function buildGenerateWorkflowRequest(
  workspaceId: string,
  request: AiGenerateRequest,
  signal?: AbortSignal,
): AxiosRequestConfig<GenerateWorkflowRequestDto> {
  assertGenerateRequest(request);
  return {
    method: 'POST',
    url: `${workspaceWorkflowsPath(workspaceId)}/generate`,
    data: {
      prompt: request.prompt,
      ...(request.timezone ? { timezone: request.timezone } : {}),
      ...(request.connections && Object.keys(request.connections).length > 0
        ? { connections: request.connections }
        : {}),
      ...(request.answers && Object.keys(request.answers).length > 0
        ? { answers: request.answers }
        : {}),
    },
    timeout: GENERATE_TIMEOUT_MS,
    ...(signal ? { signal } : {}),
  };
}
