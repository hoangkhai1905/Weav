import {
  ChatEvent,
  ChatProvider,
  ChatRequest,
  ToolCall,
} from '../../../application/assistant/chat-provider';
import { AiError, isPlainObject } from '../../../domain/errors';

export interface DeepSeekChatConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxResponseBytes: number;
}

const MAX_TOOL_CALLS = 8;
const MAX_ARGUMENT_CHARS = 8000;

/**
 * Assembles OpenAI-style streamed `delta.tool_calls` fragments (index, id, function.name,
 * function.arguments pieces) into whole calls. Fragments of one call share an index.
 */
export class ToolCallAccumulator {
  private readonly calls = new Map<
    number,
    { id: string; name: string; args: string }
  >();

  add(fragments: unknown): void {
    if (!Array.isArray(fragments)) return;
    for (const fragment of fragments) {
      if (!isPlainObject(fragment)) continue;
      const index = typeof fragment.index === 'number' ? fragment.index : 0;
      if (index < 0 || index >= MAX_TOOL_CALLS)
        throw new AiError('AI_OUTPUT_INVALID');
      const call = this.calls.get(index) ?? { id: '', name: '', args: '' };
      if (typeof fragment.id === 'string') call.id = fragment.id;
      const fn = fragment.function;
      if (isPlainObject(fn)) {
        if (typeof fn.name === 'string') call.name += fn.name;
        if (typeof fn.arguments === 'string') call.args += fn.arguments;
      }
      if (call.args.length > MAX_ARGUMENT_CHARS)
        throw new AiError('AI_OUTPUT_INVALID');
      this.calls.set(index, call);
    }
  }

  result(): ToolCall[] {
    return [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({
        id: call.id || `call_${index}`,
        name: call.name,
        arguments: call.args,
      }));
  }
}

/** DeepSeek (OpenAI-compatible) /chat/completions with tools and stream:true. */
export class DeepSeekChatProvider implements ChatProvider {
  constructor(
    private readonly config: DeepSeekChatConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async *stream(
    request: ChatRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          method: 'POST',
          signal,
          redirect: 'error',
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            'content-type': 'application/json',
            accept: 'text/event-stream',
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: request.messages,
            ...(request.tools?.length
              ? {
                  tools: request.tools.map((tool) => ({
                    type: 'function',
                    function: tool,
                  })),
                }
              : {}),
            max_tokens: request.maxTokens,
            temperature: 0,
            stream: true,
          }),
        },
      );
    } catch {
      throw new AiError(
        signal.aborted ? 'AI_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE',
      );
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      if ([401, 402, 403].includes(response.status))
        throw new AiError('AI_PROVIDER_AUTH');
      if (response.status === 429 || response.status >= 500)
        throw new AiError('AI_PROVIDER_UNAVAILABLE');
      throw new AiError('AI_OUTPUT_INVALID');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const tools = new ToolCallAccumulator();
    let buffer = '';
    let total = 0;
    let finished = false;
    try {
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.config.maxResponseBytes)
          throw new AiError('AI_OUTPUT_INVALID');
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            finished = true;
            break;
          }
          const delta = parseChunk(data);
          if (delta.text) yield { type: 'delta', text: delta.text };
          tools.add(delta.toolCalls);
        }
      }
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw new AiError(
        signal.aborted ? 'AI_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE',
      );
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    yield { type: 'end', toolCalls: tools.result() };
  }
}

function parseChunk(data: string): { text?: string; toolCalls?: unknown } {
  let chunk: unknown;
  try {
    chunk = JSON.parse(data);
  } catch {
    throw new AiError('AI_OUTPUT_INVALID');
  }
  const choice =
    isPlainObject(chunk) && Array.isArray(chunk.choices)
      ? (chunk.choices[0] as unknown)
      : undefined;
  const delta = isPlainObject(choice) ? choice.delta : undefined;
  if (!isPlainObject(delta)) return {};
  return {
    text: typeof delta.content === 'string' ? delta.content : undefined,
    toolCalls: delta.tool_calls,
  };
}
