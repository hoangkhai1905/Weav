import { AiError } from '../../domain/errors';
import { AnthropicProvider } from './anthropic-provider';

const LEAK = 'sk-LEAKCHECK-1';
const provider = (fetchImpl: typeof fetch, maxResponseBytes = 1024 * 1024) =>
  new AnthropicProvider(
    { apiKey: LEAK, model: 'claude-x', maxTokens: 100, maxResponseBytes },
    fetchImpl,
  );
const fakeFetch = (status: number, body: unknown = {}) =>
  (() =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      }),
    )) as unknown as typeof fetch;
const toolUse = (input: unknown, stop = 'tool_use') => ({
  stop_reason: stop,
  content: [{ type: 'tool_use', name: 'result', input }],
});
const run = (p: AnthropicProvider) =>
  p
    .completeJson({ system: 'sys', user: 'usr' }, AbortSignal.timeout(2000))
    .then(
      () => 'OK',
      (e: unknown) => {
        expect(String(e)).not.toContain(LEAK);
        return (e as AiError).code;
      },
    );

describe('AnthropicProvider', () => {
  it('anthropicSendsMessagesRequest', async () => {
    let call: { url: string; init: RequestInit } | undefined;
    const capture = (url: string, init: RequestInit) => {
      call = { url, init };
      return Promise.resolve(new Response(JSON.stringify(toolUse({ a: 1 }))));
    };
    await expect(
      provider(capture).completeJson(
        { system: 'sys', user: 'usr' },
        AbortSignal.timeout(2000),
      ),
    ).resolves.toEqual({ a: 1 });
    expect(call?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call?.init.redirect).toBe('error');
    expect(call?.init.headers).toMatchObject({
      'x-api-key': LEAK,
      'anthropic-version': '2023-06-01',
    });
    expect(JSON.parse(call?.init.body as string)).toMatchObject({
      model: 'claude-x',
      max_tokens: 100,
      system: 'sys',
      messages: [{ role: 'user', content: 'usr' }],
      tools: [{ name: 'result', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'result' },
    });
  });

  it.each([
    [401, 'AI_PROVIDER_AUTH'],
    [402, 'AI_PROVIDER_AUTH'],
    [403, 'AI_PROVIDER_AUTH'],
    [429, 'AI_PROVIDER_RATE_LIMITED'],
    [404, 'AI_MODEL_NOT_FOUND'],
    [500, 'AI_PROVIDER_UNAVAILABLE'],
    [529, 'AI_PROVIDER_UNAVAILABLE'],
  ])('anthropicMapsStatuses %i -> %s', async (status, code) => {
    await expect(run(provider(fakeFetch(status)))).resolves.toBe(code);
  });

  it('maps a 400 naming the model to AI_MODEL_NOT_FOUND, other 400 to AI_OUTPUT_INVALID', async () => {
    await expect(
      run(provider(fakeFetch(400, '{"error":{"message":"model: nope"}}'))),
    ).resolves.toBe('AI_MODEL_NOT_FOUND');
    await expect(
      run(provider(fakeFetch(400, '{"error":{"message":"bad"}}'))),
    ).resolves.toBe('AI_OUTPUT_INVALID');
  });

  it.each([
    [
      'anthropicRejectsNonJsonText',
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"a":1}' }],
      },
    ],
    ['truncated', toolUse({ a: 1 }, 'max_tokens')],
    ['array input', toolUse([1])],
    ['malformed envelope', '{"content":'],
  ])('%s -> AI_OUTPUT_INVALID', async (_n, body) => {
    await expect(run(provider(fakeFetch(200, body)))).resolves.toBe(
      'AI_OUTPUT_INVALID',
    );
  });

  it('caps the provider body', async () => {
    await expect(
      run(provider(fakeFetch(200, toolUse({ a: 'x'.repeat(2048) })), 1024)),
    ).resolves.toBe('AI_OUTPUT_INVALID');
  });

  it('keyNeverInErrorMessage when fetch throws it', async () => {
    const throwing = (() =>
      Promise.reject(new Error(`boom ${LEAK}`))) as unknown as typeof fetch;
    await expect(run(provider(throwing))).resolves.toBe(
      'AI_PROVIDER_UNAVAILABLE',
    );
  });
});
