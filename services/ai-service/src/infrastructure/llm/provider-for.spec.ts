import { AnthropicProvider } from './anthropic-provider';
import { OpenAiCompatibleProvider } from './openai-compatible-provider';
import { ByokDefaults, providerFor } from './provider-for';

const defaults: ByokDefaults = {
  openaiModel: 'o-default',
  anthropicModel: 'a-default',
  geminiModel: 'g-default',
  maxTokens: 1024,
  maxResponseBytes: 1024 * 1024,
};
const signal = new AbortController().signal;
const request = { system: 's', user: 'u' };

/** Runs one call through the provider and returns what it sent. */
async function sent(
  llm: Parameters<typeof providerFor>[0],
): Promise<{ url: string; init: RequestInit; body: Record<string, unknown> }> {
  let captured: { url: string; init: RequestInit } | undefined;
  const fetchImpl: typeof fetch = (url, init = {}) => {
    captured = { url: url as string, init };
    return Promise.resolve(new Response('{}', { status: 500 }));
  };
  await providerFor(llm, defaults, fetchImpl)
    .completeJson(request, signal)
    .catch(() => undefined);
  const { url, init } = captured as { url: string; init: RequestInit };
  const body = JSON.parse(init.body as string) as Record<string, unknown>;
  return { url, init, body };
}

describe('providerFor', () => {
  it('builds OpenAI on the OpenAI base URL with the default model', async () => {
    const llm = { provider: 'OPENAI', apiKey: 'sk-1' } as const;
    expect(providerFor(llm, defaults)).toBeInstanceOf(OpenAiCompatibleProvider);
    const { url, init, body } = await sent(llm);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer sk-1',
    );
    expect(body.model).toBe('o-default');
    expect(body.max_completion_tokens).toBe(1024);
    expect(body).not.toHaveProperty('temperature');
  });

  it('builds Gemini on the Gemini base URL', async () => {
    const { url, body } = await sent({
      provider: 'GEMINI',
      apiKey: 'g-1',
      model: 'gemini-custom',
    });
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );
    expect(body.model).toBe('gemini-custom');
    expect(body.max_tokens).toBe(1024);
    expect(body.temperature).toBe(0);
  });

  it('builds Anthropic with the default model', async () => {
    const llm = { provider: 'ANTHROPIC', apiKey: 'a-1' } as const;
    expect(providerFor(llm, defaults)).toBeInstanceOf(AnthropicProvider);
    const { url, body } = await sent(llm);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(body.model).toBe('a-default');
  });

  it('uses the user-key status mapping (429 -> AI_PROVIDER_RATE_LIMITED)', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('{}', { status: 429 }))) as typeof fetch;
    await expect(
      providerFor(
        { provider: 'OPENAI', apiKey: 'k' },
        defaults,
        fetchImpl,
      ).completeJson(request, signal),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_RATE_LIMITED' });
  });
});
