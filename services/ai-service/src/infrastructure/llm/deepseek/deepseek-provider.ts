import { LlmProvider, LlmRequest } from '../../../application/llm-provider';
import { AiError, isPlainObject } from '../../../domain/errors';
import { parseStrictJson } from '../../../domain/json/strict-json';

export interface DeepSeekConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxTokens: number;
  maxResponseBytes: number;
}

export class DeepSeekProvider implements LlmProvider {
  constructor(private readonly config: DeepSeekConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  async completeJson(request: LlmRequest, signal: AbortSignal): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        signal,
        redirect: 'error',
        headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
          response_format: { type: 'json_object' },
          max_tokens: this.config.maxTokens,
          temperature: 0,
          stream: false,
        }),
      });
    } catch {
      throw new AiError(signal.aborted ? 'AI_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE');
    }

    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      if ([401, 402, 403].includes(response.status)) throw new AiError('AI_PROVIDER_AUTH');
      if (response.status === 429 || response.status >= 500) throw new AiError('AI_PROVIDER_UNAVAILABLE');
      throw new AiError('AI_OUTPUT_INVALID');
    }

    const bytes = await this.readCapped(response, signal);
    let envelope: unknown;
    try {
      envelope = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      throw new AiError('AI_OUTPUT_INVALID');
    }
    const choice = isPlainObject(envelope) && Array.isArray(envelope.choices) ? envelope.choices[0] : undefined;
    const content = isPlainObject(choice) && isPlainObject(choice.message) ? choice.message.content : undefined;
    if (!isPlainObject(choice) || choice.finish_reason !== 'stop' || typeof content !== 'string'
        || content.trim() === '' || content.trimStart().startsWith('```')) {
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

  private async readCapped(response: Response, signal: AbortSignal): Promise<Uint8Array> {
    if (!response.body) throw new AiError('AI_OUTPUT_INVALID');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.config.maxResponseBytes) {
          await reader.cancel().catch(() => undefined);
          throw new AiError('AI_OUTPUT_INVALID');
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw new AiError(signal.aborted ? 'AI_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE');
    }
    return Buffer.concat(chunks);
  }
}
