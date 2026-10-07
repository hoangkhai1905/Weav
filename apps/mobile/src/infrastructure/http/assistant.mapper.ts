import type {
  AssistantConversation,
  AssistantConversationDetail,
  AssistantMessage,
  AssistantStreamEvent,
} from '../../domain/assistant/assistant.types';
import type { SseFrame } from './assistant.dto';
import { mapLayout } from './ai.mapper';
import { arr, bool, oneOf, rec, str } from './mapper-utils';
import { mapWorkflowDefinition } from './workflow.mapper';

function mapConversation(value: unknown): AssistantConversation {
  const r = rec(value, 'conversation');
  return {
    conversationId: str(r, 'conversationId', 'conversation'),
    title: str(r, 'title', 'conversation'),
    createdAt: str(r, 'createdAt', 'conversation'),
    updatedAt: str(r, 'updatedAt', 'conversation'),
  };
}

export function mapConversationList(value: unknown): AssistantConversation[] {
  return arr(rec(value, 'conversations'), 'items', 'conversations').map(mapConversation);
}

function mapMessage(value: unknown): AssistantMessage {
  const r = rec(value, 'message');
  return {
    role: oneOf(r, 'role', ['user', 'assistant'] as const, 'message'),
    content: str(r, 'content', 'message'),
    createdAt: str(r, 'createdAt', 'message'),
  };
}

export function mapConversationDetail(value: unknown): AssistantConversationDetail {
  const r = rec(value, 'conversationDetail');
  return {
    conversationId: str(r, 'conversationId', 'conversationDetail'),
    workspaceId: str(r, 'workspaceId', 'conversationDetail'),
    title: str(r, 'title', 'conversationDetail'),
    messages: arr(r, 'messages', 'conversationDetail').map(mapMessage),
  };
}

/** Maps one SSE frame to a domain event. Unknown event names are ignored (null). */
export function mapAssistantFrame(frame: SseFrame): AssistantStreamEvent | null {
  let payload: unknown = {};
  if (frame.data !== '') {
    try {
      payload = JSON.parse(frame.data);
    } catch {
      return { type: 'error', code: 'INVALID_STREAM', message: 'Malformed assistant event.' };
    }
  }
  try {
    const r = rec(payload, frame.event);
    switch (frame.event) {
      case 'conversation':
        return { type: 'conversation', conversationId: str(r, 'conversationId', 'conversation') };
      case 'delta':
        return { type: 'delta', text: str(r, 'text', 'delta') };
      case 'tool_call':
        return { type: 'tool_call', name: str(r, 'name', 'tool_call'), arguments: r.arguments ?? null };
      case 'tool_result':
        return { type: 'tool_result', name: str(r, 'name', 'tool_result'), ok: bool(r, 'ok', 'tool_result') };
      case 'draft':
        return {
          type: 'draft',
          draft: {
            name: str(r, 'name', 'draft'),
            definition: mapWorkflowDefinition(r.definition),
            layout: mapLayout(r.layout),
          },
        };
      case 'done':
        return { type: 'done' };
      case 'error':
        return { type: 'error', code: str(r, 'code', 'error'), message: str(r, 'message', 'error') };
      default:
        return null;
    }
  } catch {
    return { type: 'error', code: 'INVALID_STREAM', message: 'Malformed assistant event.' };
  }
}
