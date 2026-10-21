import { LlmProvider, LlmRequest } from '../../application/llm-provider';
import { AiError, isPlainObject } from '../../domain/errors';
import { parseStrictJson } from '../../domain/json/strict-json';
import { failOnStatus, readCapped } from './provider-http';

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  maxResponseBytes: number;
}

// Fixed in code: the base URL is never user input (no SSRF surface).
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const TOOL = 'result';

export class AnthropicProvider implements LlmProvider {
  constructor(
    private readonly config: AnthropicConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async completeJson(
    request: LlmRequest,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(MESSAGES_URL, {
        method: 'POST',
        signal,
        redirect: 'error',
        headers: {
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          tools: [{ name: TOOL, input_schema: { type: 'object' } }],
          tool_choice: { type: 'tool', name: TOOL },
          stream: false,
        }),
      });
    } catch {
      throw new AiError(
        signal.aborted ? 'AI_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE',
      );
    }

    if (response.status !== 200) return failOnStatus(response, true);

    const bytes = await readCapped(
      response,
      signal,
      this.config.maxResponseBytes,
    );
    let envelope: unknown;
    try {
      envelope = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      throw new AiError('AI_OUTPUT_INVALID');
    }
    const block =
      isPlainObject(envelope) &&
      envelope.stop_reason === 'tool_use' &&
      Array.isArray(envelope.content)
        ? (envelope.content as unknown[]).find(
            (b) => isPlainObject(b) && b.type === 'tool_use' && b.name === TOOL,
          )
        : undefined;
    if (!isPlainObject(block) || !isPlainObject(block.input))
      throw new AiError('AI_OUTPUT_INVALID');
    let parsed: unknown;
    try {
      // same depth/duplicate-key guard as the text providers
      parsed = parseStrictJson(
        Buffer.from(JSON.stringify(block.input), 'utf8'),
        64,
      );
    } catch {
      throw new AiError('AI_OUTPUT_INVALID');
    }
    if (!isPlainObject(parsed)) throw new AiError('AI_OUTPUT_INVALID');
    return parsed;
  }
}
