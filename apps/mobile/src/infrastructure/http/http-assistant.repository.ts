import type { ApiError } from '../../domain/common/error.types';
import type {
  AssistantChatRequest,
  AssistantConversation,
  AssistantConversationDetail,
  AssistantRepository,
  AssistantStreamEvent,
} from '../../domain/assistant/assistant.types';
import { useAuthStore } from '../../stores/auth.store';
import { expirePersistedAuthSession } from '../auth/auth-session.persistence';
import {
  ASSISTANT_CHAT_TIMEOUT_MS,
  assistantChatUrl,
  buildAssistantChatBody,
  buildConversationListRequest,
  buildConversationMessagesRequest,
  buildDeleteConversationRequest,
} from './assistant.http.contract';
import { mapAssistantFrame, mapConversationDetail, mapConversationList } from './assistant.mapper';
import { createSseParser } from './assistant.sse';
import { requestGateway } from './gateway-request';
import { httpClient } from './http-client';

async function errorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: fall through to the status-only error.
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const nested =
    typeof root.error === 'object' && root.error !== null
      ? (root.error as Record<string, unknown>)
      : {};
  const requestId =
    (typeof root.requestId === 'string' ? root.requestId : undefined) ??
    response.headers.get('x-request-id') ??
    undefined;
  return {
    code: typeof nested.code === 'string' ? nested.code : `HTTP_${response.status}`,
    message: typeof nested.message === 'string' ? nested.message : 'Assistant request failed.',
    status: response.status,
    ...(requestId ? { requestId } : {}),
  };
}

export class HttpAssistantRepository implements AssistantRepository {
  listConversations(
    workspaceId: string,
    query: { limit?: number; before?: string } = {},
  ): Promise<AssistantConversation[]> {
    return requestGateway(buildConversationListRequest(workspaceId, query), mapConversationList);
  }

  getConversation(conversationId: string): Promise<AssistantConversationDetail> {
    return requestGateway(buildConversationMessagesRequest(conversationId), mapConversationDetail);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await requestGateway(buildDeleteConversationRequest(conversationId), () => undefined);
  }

  /**
   * SSE over `expo/fetch` (SDK 57 supports a streaming `response.body`). Chunks are fed to the
   * SSE parser as they arrive. If the runtime gives no readable body, the whole text is read and
   * parsed at once (events then appear together, but the contract is unchanged). Overall
   * deadline 80 s (gateway: 75 s). This is the only place that knows about the transport.
   */
  async chat(
    workspaceId: string,
    request: AssistantChatRequest,
    onEvent: (event: AssistantStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const body = buildAssistantChatBody(workspaceId, request);
    const token = useAuthStore.getState().tokens?.accessToken ?? null;
    if (!token) throw { code: 'UNAUTHORIZED', message: 'Not signed in.' } satisfies ApiError;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ASSISTANT_CHAT_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      // Loaded lazily: expo/fetch needs the native runtime, so node tests importing the factory skip it.
      const { fetch } = await import('expo/fetch');
      const response = await fetch(`${httpClient.defaults.baseURL ?? ''}${assistantChatUrl()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401 && useAuthStore.getState().tokens?.accessToken === token) {
          void expirePersistedAuthSession();
        }
        throw await errorFromResponse(response as unknown as Response);
      }

      const parser = createSseParser((frame) => {
        const event = mapAssistantFrame(frame);
        if (event) onEvent(event);
      });
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.push(decoder.decode());
      } else {
        parser.push(await response.text());
      }
      parser.flush();
    } catch (error) {
      if (controller.signal.aborted) {
        throw (timedOut
          ? { code: 'TIMEOUT', message: 'The assistant took too long to answer.' }
          : { code: 'CANCELED', message: 'Request canceled.' }) satisfies ApiError;
      }
      if (typeof error === 'object' && error !== null && 'code' in error) throw error;
      throw {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network request failed.',
      } satisfies ApiError;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
