/** OpenAI-compatible chat message (the subset the assistant uses). */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Omitted/empty on the last round: the model must answer in text. */
  tools?: ChatToolSpec[];
  maxTokens: number;
}

/** A tool call after its streamed argument chunks were assembled. */
export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON text as the model produced it; validated by the tool, never trusted. */
  arguments: string;
}

export type ChatEvent =
  { type: 'delta'; text: string } | { type: 'end'; toolCalls: ToolCall[] };

/** Outbound port: one streamed model call. Throws AiError on any failure. */
export interface ChatProvider {
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}
