import { tr } from '../lib/i18n/tr';
import { useAuthStore } from '../store/useAuthStore';
import { apiBaseUrl } from './workflow-v1.api';

export const isAssistantMockMode = import.meta.env.VITE_API_MODE === 'mock';

export class AssistantApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message = code) {
    super(message);
    this.name = 'AssistantApiError';
    this.status = status;
    this.code = code;
  }
}

export interface AssistantConversation {
  conversationId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface AssistantChatRequest {
  workspaceId: string;
  conversationId?: string;
  message: string;
  timezone?: string;
}

export type AssistantEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string; ok: boolean }
  | { type: 'draft'; name: string; definition: unknown; layout: Record<string, unknown> }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Splits an SSE buffer into complete `{event, data}` frames (blank-line separated; `data:` lines
 * may repeat and are joined with \n). Returns the unparsed tail to prepend to the next chunk.
 */
export function parseSseFrames(buffer: string): { frames: Array<{ event: string; data: string }>; rest: string } {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  const frames = parts.flatMap((block) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    return data.length ? [{ event, data: data.join('\n') }] : [];
  });
  return { frames, rest };
}

function toEvent(frame: { event: string; data: string }): AssistantEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(frame.data);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  switch (frame.event) {
    case 'conversation':
      return typeof data.conversationId === 'string' ? { type: 'conversation', conversationId: data.conversationId } : null;
    case 'delta':
      return typeof data.text === 'string' ? { type: 'delta', text: data.text } : null;
    case 'tool_call':
      return typeof data.name === 'string' ? { type: 'tool_call', name: data.name } : null;
    case 'tool_result':
      return typeof data.name === 'string' ? { type: 'tool_result', name: data.name, ok: data.ok === true } : null;
    case 'draft':
      return typeof data.name === 'string' && isRecord(data.definition)
        ? { type: 'draft', name: data.name, definition: data.definition, layout: isRecord(data.layout) ? data.layout : {} }
        : null;
    case 'done':
      return { type: 'done' };
    case 'error':
      return {
        type: 'error',
        code: typeof data.code === 'string' ? data.code : 'INTERNAL_ERROR',
        message: typeof data.message === 'string' ? data.message : '',
      };
    default:
      return null;
  }
}

async function toApiError(response: Response): Promise<AssistantApiError> {
  let code = '';
  let message = '';
  try {
    const payload: unknown = await response.json();
    const envelope = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
    if (typeof envelope?.code === 'string') code = envelope.code;
    if (typeof envelope?.message === 'string') message = envelope.message;
  } catch {
    // Non-JSON error body: fall back to the status.
  }
  return new AssistantApiError(response.status, code || `HTTP_${response.status}`, message);
}

/** Authenticated fetch with the shared one-shot 401 refresh + retry. Throws AssistantApiError when not ok. */
async function fetchAuthed(path: string, init: RequestInit): Promise<Response> {
  const once = async (): Promise<Response> => {
    const token = localStorage.getItem('weav_token');
    if (!token) throw new AssistantApiError(401, 'UNAUTHENTICATED', tr('msg.your_session_has_expired_sign_in_again'));
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
    try {
      return await fetch(`${apiBaseUrl()}${path}`, { ...init, headers, redirect: 'error', cache: 'no-store' });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new AssistantApiError(0, 'NETWORK_ERROR');
    }
  };
  const token = localStorage.getItem('weav_token');
  let response = await once();
  if (response.status === 401
    && (localStorage.getItem('weav_token') !== token || await useAuthStore.getState().handleUnauthorized())) {
    response = await once();
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchAuthed(path, {
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const assistantApi = {
  async listConversations(workspaceId: string, before?: string): Promise<AssistantConversation[]> {
    const query = new URLSearchParams({ workspaceId, limit: '20', ...(before ? { before } : {}) });
    const payload = await requestJson<{ items?: AssistantConversation[] }>(`/api/v1/assistant/conversations?${query}`);
    return Array.isArray(payload.items) ? payload.items : [];
  },

  async getMessages(conversationId: string): Promise<{ title: string; messages: AssistantHistoryMessage[] }> {
    const payload = await requestJson<{ title?: string; messages?: AssistantHistoryMessage[] }>(
      `/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}/messages`,
    );
    return { title: payload.title ?? '', messages: Array.isArray(payload.messages) ? payload.messages : [] };
  },

  deleteConversation(conversationId: string): Promise<void> {
    return requestJson<void>(`/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
  },

  /** Streams one chat turn; resolves when the stream ends. Pre-stream failures reject with AssistantApiError. */
  async chat(body: AssistantChatRequest, signal: AbortSignal, onEvent: (event: AssistantEvent) => void): Promise<void> {
    const response = await fetchAuthed('/api/v1/assistant/chat', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Accept: 'text/event-stream' },
      signal,
    });
    if (!response.body) throw new AssistantApiError(502, 'INTERNAL_ERROR');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const parsed = parseSseFrames(done ? `${buffer}\n\n` : buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) {
        const event = toEvent(frame);
        if (event) onEvent(event);
      }
      if (done) return;
    }
  },
};
