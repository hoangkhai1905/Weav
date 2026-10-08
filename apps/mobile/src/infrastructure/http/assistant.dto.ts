import type { WorkflowDefinitionDto } from './workflow.dto';

/** /api/v1/assistant. Chat is SSE; the other three routes are JSON. */
export interface AssistantChatRequestDto {
  workspaceId: string;
  conversationId?: string;
  message: string;
  timezone?: string;
}

export interface AssistantConversationDto {
  conversationId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantConversationListDto {
  items: AssistantConversationDto[];
}

export interface AssistantMessageDto {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface AssistantMessagesDto {
  conversationId: string;
  workspaceId: string;
  title: string;
  messages: AssistantMessageDto[];
}

/** One parsed SSE frame: `event: <name>` + `data: <json text>`. */
export interface SseFrame {
  event: string;
  data: string;
}

export interface AssistantDraftDto {
  name: string;
  definition: WorkflowDefinitionDto;
  layout: Record<string, { x: number; y: number }>;
}
