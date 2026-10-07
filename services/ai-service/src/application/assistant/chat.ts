import { Logger } from '@nestjs/common';
import { ChatMessage, ChatProvider } from './chat-provider';
import { ASSISTANT_SYSTEM_PROMPT } from './system-prompt';
import { runTool, TOOL_SPECS, ToolContext } from './tools';

export type AssistantEvent =
  | { event: 'delta'; data: { text: string } }
  | { event: 'tool_call'; data: { name: string; arguments: unknown } }
  | { event: 'tool_result'; data: { name: string; ok: boolean } }
  | {
      event: 'draft';
      data: { name: string; definition: unknown; layout: unknown };
    }
  | { event: 'done'; data: Record<string, never> };

export const MAX_TOOL_ROUNDS = 3;
const MAX_CALLS_PER_ROUND = 4;
const MAX_TOOL_RESULT_CHARS = 16_000;
const logger = new Logger('Assistant');

export interface AssistantInput {
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  tools: ToolContext;
  /** Defaults to MAX_TOOL_ROUNDS; the live check uses fewer. */
  maxToolRounds?: number;
}

/**
 * Streams one assistant turn. Up to MAX_TOOL_ROUNDS rounds may call tools; the round after
 * that is sent without tools so the model must answer. Provider errors propagate (AiError).
 */
export async function* runAssistant(
  provider: ChatProvider,
  input: AssistantInput,
  signal: AbortSignal,
): AsyncGenerator<AssistantEvent> {
  const messages: ChatMessage[] = [
    { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
    ...input.messages,
  ];
  const maxRounds = input.maxToolRounds ?? MAX_TOOL_ROUNDS;
  for (let round = 0; round <= maxRounds; round++) {
    const withTools = round < maxRounds;
    let text = '';
    let calls: { id: string; name: string; arguments: string }[] = [];
    for await (const chunk of provider.stream(
      {
        messages,
        tools: withTools ? TOOL_SPECS : undefined,
        maxTokens: input.maxTokens,
      },
      signal,
    )) {
      if (chunk.type === 'delta') {
        text += chunk.text;
        yield { event: 'delta', data: { text: chunk.text } };
      } else {
        calls = chunk.toolCalls;
      }
    }
    if (!withTools || calls.length === 0) {
      yield { event: 'done', data: {} };
      return;
    }
    calls = calls.slice(0, MAX_CALLS_PER_ROUND);
    messages.push({
      role: 'assistant',
      content: text || null,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    });
    for (const call of calls) {
      yield {
        event: 'tool_call',
        data: { name: call.name, arguments: parseArguments(call.arguments) },
      };
      const outcome = await runTool(call.name, call.arguments, input.tools);
      if (signal.aborted) return;
      yield { event: 'tool_result', data: { name: call.name, ok: outcome.ok } };
      if (outcome.draft) yield { event: 'draft', data: outcome.draft };
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: toolMessage(call.name, outcome.data),
      });
    }
  }
}

/** Never truncates mid-JSON: an oversized result becomes a small valid error object. */
function toolMessage(name: string, data: unknown): string {
  const content = JSON.stringify({ untrusted_data: data });
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content;
  logger.warn(`tool result too large: ${name}`);
  return '{"untrusted_data":{"error":"result_too_large"}}';
}

function parseArguments(raw: string): unknown {
  try {
    return raw.trim() === '' ? {} : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}
