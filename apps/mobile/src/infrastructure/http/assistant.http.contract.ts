import type { AxiosRequestConfig } from 'axios';
import type { AssistantChatRequest } from '../../domain/assistant/assistant.types';
import type { AssistantChatRequestDto } from './assistant.dto';
import { isUuid } from './notification.http.contract';

export const ASSISTANT_PATH = '/api/v1/assistant';
/** Gateway stream deadline is 75 s. */
export const ASSISTANT_CHAT_TIMEOUT_MS = 80_000;
export const ASSISTANT_MESSAGE_MAX_LENGTH = 4000;

export function buildAssistantChatBody(
  workspaceId: string,
  request: AssistantChatRequest,
): AssistantChatRequestDto {
  if (!isUuid(workspaceId)) throw new Error('Invalid workspace id.');
  if (request.conversationId !== undefined && !isUuid(request.conversationId)) {
    throw new Error('Invalid conversation id.');
  }
  const length = Array.from(request.message ?? '').length;
  if (length < 1 || length > ASSISTANT_MESSAGE_MAX_LENGTH) throw new Error('Invalid message.');
  if (request.timezone !== undefined && (request.timezone.length < 1 || request.timezone.length > 64)) {
    throw new Error('Invalid timezone.');
  }
  return {
    workspaceId,
    ...(request.conversationId ? { conversationId: request.conversationId } : {}),
    message: request.message,
    ...(request.timezone ? { timezone: request.timezone } : {}),
  };
}

/** Chat is SSE, so it is sent with fetch (see http-assistant.repository), not axios. */
export function assistantChatUrl(): string {
  return `${ASSISTANT_PATH}/chat`;
}

export function buildConversationListRequest(
  workspaceId: string,
  query: { limit?: number; before?: string } = {},
): AxiosRequestConfig {
  if (!isUuid(workspaceId)) throw new Error('Invalid workspace id.');
  if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 50)) {
    throw new Error('Invalid limit.');
  }
  // `before` is the previous page's last `updatedAt` (ISO date-time with offset).
  if (query.before !== undefined && Number.isNaN(Date.parse(query.before))) {
    throw new Error('Invalid before.');
  }
  return {
    url: `${ASSISTANT_PATH}/conversations`,
    params: {
      workspaceId,
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.before !== undefined ? { before: query.before } : {}),
    },
  };
}

export function buildConversationMessagesRequest(conversationId: string): AxiosRequestConfig {
  if (!isUuid(conversationId)) throw new Error('Invalid conversation id.');
  return { url: `${ASSISTANT_PATH}/conversations/${conversationId}/messages` };
}

export function buildDeleteConversationRequest(conversationId: string): AxiosRequestConfig {
  if (!isUuid(conversationId)) throw new Error('Invalid conversation id.');
  return { method: 'DELETE', url: `${ASSISTANT_PATH}/conversations/${conversationId}` };
}
