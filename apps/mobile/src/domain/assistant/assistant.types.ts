import type { WorkflowDefinition } from '../workflow/workflow.types';

export interface AssistantConversation {
  conversationId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface AssistantConversationDetail {
  conversationId: string;
  workspaceId: string;
  title: string;
  messages: AssistantMessage[];
}

export interface AssistantChatRequest {
  conversationId?: string;
  /** 1..4000 characters. */
  message: string;
  timezone?: string;
}

/** A proposal only: the assistant never saves. Persist through the workflow API after the user confirms. */
export interface AssistantDraft {
  name: string;
  definition: WorkflowDefinition;
  layout: Record<string, { x: number; y: number }>;
}

export type AssistantStreamEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; name: string; arguments: unknown }
  | { type: 'tool_result'; name: string; ok: boolean }
  | { type: 'draft'; draft: AssistantDraft }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string };

export interface AssistantRepository {
  listConversations(
    workspaceId: string,
    query?: { limit?: number; before?: string },
  ): Promise<AssistantConversation[]>;
  getConversation(conversationId: string): Promise<AssistantConversationDetail>;
  deleteConversation(conversationId: string): Promise<void>;
  /**
   * Streams the reply (SSE). Resolves after the terminal done/error event.
   * Falls back to reading the whole body when the runtime cannot stream.
   */
  chat(
    workspaceId: string,
    request: AssistantChatRequest,
    onEvent: (event: AssistantStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}
