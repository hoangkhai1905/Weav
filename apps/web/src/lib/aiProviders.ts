/** AI model providers a workspace can connect with its own API key. */
export type AiProvider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI';

export const AI_PROVIDERS: readonly AiProvider[] = ['OPENAI', 'ANTHROPIC', 'GEMINI'];

export const AI_PROVIDER_NAMES: Record<AiProvider, string> = {
  OPENAI: 'ChatGPT (OpenAI)',
  ANTHROPIC: 'Claude (Anthropic)',
  GEMINI: 'Gemini (Google)',
};

export const isAiProvider = (provider: string): provider is AiProvider =>
  (AI_PROVIDERS as readonly string[]).includes(provider);

// Same rule as workspace-service: 1..512 visible ASCII characters; the server is the authority.
export const isValidAiKey = (value: string): boolean => /^[\x21-\x7e]{1,512}$/.test(value);
