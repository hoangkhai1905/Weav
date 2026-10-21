import { LlmProvider, LlmRequest } from '../../application/llm-provider';
import { AiError, isPlainObject } from '../../domain/errors';
import { parseStrictJson } from '../../domain/json/strict-json';
import { failOnStatus, readCapped } from './provider-http';

export interface OpenAiCompatibleConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxTokens: number;
  maxResponseBytes: number;
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  sendTemperature: boolean;
  /** false keeps the service-owned DeepSeek status mapping. */
  userKey: boolean;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    private readonly config: OpenAiCompatibleConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async completeJson(
    request: LlmRequest,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
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
            accept: 'application/json',
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
            response_format: { type: 'json_object' },
            [this.config.tokenParam]: this.config.maxTokens,
            ...(this.config.sendTemperature ? { temperature: 0 } : {}),
            stream: false,
          }),
        },
      );
    } catch {
      throw new AiError(
        signal.aborted ? 'AI_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE',
      );
    }

    if (response.status !== 200)
      return failOnStatus(response, this.config.userKey);

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
    const choice =
      isPlainObject(envelope) && Array.isArray(envelope.choices)
        ? (envelope.choices as unknown[])[0]
        : undefined;
    const content =
      isPlainObject(choice) && isPlainObject(choice.message)
        ? choice.message.content
        : undefined;
    if (
      !isPlainObject(choice) ||
      choice.finish_reason !== 'stop' ||
      typeof content !== 'string' ||
      content.trim() === '' ||
      content.trimStart().startsWith('```')
    ) {
      throw new AiError('AI_OUTPUT_INVALID');
    }
    let parsed: unknown;
    try {
      parsed = parseStrictJson(Buffer.from(content, 'utf8'), 64);
    } catch {
      throw new AiError('AI_OUTPUT_INVALID');
    }
    if (!isPlainObject(parsed)) throw new AiError('AI_OUTPUT_INVALID');
    return parsed;
  }
}
