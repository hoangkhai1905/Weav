import type { LlmProvider } from '../../application/llm-provider';
import { AnthropicProvider } from './anthropic-provider';
import { OpenAiCompatibleProvider } from './openai-compatible-provider';

export interface LlmSelection {
  provider: 'OPENAI' | 'ANTHROPIC' | 'GEMINI';
  apiKey: string;
  model?: string;
}

export interface ByokDefaults {
  openaiModel: string;
  anthropicModel: string;
  geminiModel: string;
  maxTokens: number;
  maxResponseBytes: number;
}

// Fixed in code: a request can pick a provider, never a URL (no SSRF surface).
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai';

/** Builds a one-request provider from the caller's own key. The key lives only in this object. */
export function providerFor(
  llm: LlmSelection,
  defaults: ByokDefaults,
  fetchImpl: typeof fetch = fetch,
): LlmProvider {
  const common = {
    apiKey: llm.apiKey,
    maxTokens: defaults.maxTokens,
    maxResponseBytes: defaults.maxResponseBytes,
  };
  switch (llm.provider) {
    case 'OPENAI':
      return new OpenAiCompatibleProvider(
        {
          ...common,
          model: llm.model ?? defaults.openaiModel,
          baseUrl: OPENAI_BASE_URL,
          tokenParam: 'max_completion_tokens',
          sendTemperature: false,
          userKey: true,
        },
        fetchImpl,
      );
    case 'GEMINI':
      return new OpenAiCompatibleProvider(
        {
          ...common,
          model: llm.model ?? defaults.geminiModel,
          baseUrl: GEMINI_BASE_URL,
          tokenParam: 'max_tokens',
          sendTemperature: true,
          userKey: true,
        },
        fetchImpl,
      );
    case 'ANTHROPIC':
      return new AnthropicProvider(
        { ...common, model: llm.model ?? defaults.anthropicModel },
        fetchImpl,
      );
  }
}
