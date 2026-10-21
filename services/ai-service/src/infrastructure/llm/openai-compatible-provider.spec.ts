import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { AddressInfo } from 'node:net';
import { AiError } from '../../domain/errors';
import { OpenAiCompatibleProvider } from './openai-compatible-provider';

const DEEPSEEK = {
  tokenParam: 'max_tokens',
  sendTemperature: true,
  userKey: false,
} as const;
let server: Server;
let handler: (req: IncomingMessage, res: ServerResponse) => void;
let hits = 0;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(
  () =>
    new Promise<void>((r) => {
      server.closeAllConnections();
      server.close(() => r());
    }),
);
beforeEach(() => {
  hits = 0;
});

const provider = (maxResponseBytes = 1024 * 1024) =>
  new OpenAiCompatibleProvider({
    apiKey: 'test-key',
    model: 'fixture-model',
    baseUrl,
    maxTokens: 4096,
    maxResponseBytes,
    ...DEEPSEEK,
  });
const completion = (content: string, finish = 'stop') =>
  JSON.stringify({
    choices: [
      { finish_reason: finish, message: { role: 'assistant', content } },
    ],
  });
const reply =
  (status: number, body: string) =>
  (_: IncomingMessage, res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(body);
  };
const run = (p = provider(), signal = AbortSignal.timeout(2000)) =>
  p.completeJson({ system: 'Reply in json.', user: '{}' }, signal).then(
    () => 'OK',
    (e: AiError) => e.code as string,
  );

describe('OpenAiCompatibleProvider (DeepSeek defaults)', () => {
  it('sends JSON mode without tools or streaming, and returns the parsed object', async () => {
    let sent: { auth?: string; body: Record<string, unknown> } | undefined;
    handler = (req, res) => {
      let raw = '';
      req
        .on('data', (c) => (raw += c))
        .on('end', () => {
          sent = {
            auth: req.headers.authorization,
            body: JSON.parse(raw) as Record<string, unknown>,
          };
          reply(200, completion('{"a":1}'))(req, res);
        });
    };
    await expect(
      provider().completeJson(
        { system: 's json', user: 'u' },
        AbortSignal.timeout(2000),
      ),
    ).resolves.toEqual({ a: 1 });
    expect(sent?.auth).toBe('Bearer test-key');
    expect(sent?.body).toMatchObject({
      model: 'fixture-model',
      response_format: { type: 'json_object' },
      stream: false,
      max_tokens: 4096,
    });
    expect(sent?.body.tools).toBeUndefined();
  });

  it.each([
    [401, 'AI_PROVIDER_AUTH'],
    [402, 'AI_PROVIDER_AUTH'],
    [403, 'AI_PROVIDER_AUTH'],
    [429, 'AI_PROVIDER_UNAVAILABLE'],
    [500, 'AI_PROVIDER_UNAVAILABLE'],
    [503, 'AI_PROVIDER_UNAVAILABLE'],
    [400, 'AI_OUTPUT_INVALID'],
    [404, 'AI_OUTPUT_INVALID'],
  ])('maps HTTP %i to %s with exactly one attempt', async (status, code) => {
    handler = reply(
      status,
      '{"error":{"message":"provider detail must not leak"}}',
    );
    await expect(run()).resolves.toBe(code);
    expect(hits).toBe(1);
  });

  it('userKey=false does not classify a 400 naming the model or a bad key', async () => {
    for (const body of [
      '{"error":{"message":"The model `x` does not exist"}}',
      '{"error":{"code":"model_not_found"}}',
      '{"error":{"message":"API key not valid."}}',
    ]) {
      handler = reply(400, body);
      await expect(run()).resolves.toBe('AI_OUTPUT_INVALID');
    }
  });

  it.each([
    ['truncated', completion('{"a":1}', 'length')],
    ['content filter', completion('{"a":1}', 'content_filter')],
    ['empty content', completion('')],
    ['code fence', completion('```json\n{"a":1}\n```')],
    ['malformed content', completion('{"a":')],
    ['array content', completion('[1]')],
    ['malformed envelope', '{"choices":'],
  ])('rejects %s as AI_OUTPUT_INVALID', async (_name, body) => {
    handler = reply(200, body);
    await expect(run()).resolves.toBe('AI_OUTPUT_INVALID');
  });

  it('caps the provider body', async () => {
    handler = reply(200, completion(`{"a":"${'x'.repeat(2048)}"}`));
    await expect(run(provider(1024))).resolves.toBe('AI_OUTPUT_INVALID');
  });

  it('maps an abort (deadline or disconnect) to AI_TIMEOUT', async () => {
    handler = () => {
      /* never responds */
    };
    await expect(run(provider(), AbortSignal.timeout(100))).resolves.toBe(
      'AI_TIMEOUT',
    );
  });

  it('maps a refused connection to AI_PROVIDER_UNAVAILABLE', async () => {
    const dead = new OpenAiCompatibleProvider({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'http://127.0.0.1:1',
      maxTokens: 10,
      maxResponseBytes: 10,
      ...DEEPSEEK,
    });
    await expect(run(dead)).resolves.toBe('AI_PROVIDER_UNAVAILABLE');
  });
});

const LEAK = 'sk-LEAKCHECK-1';
const userProvider = (
  fetchImpl: typeof fetch,
  extra: Partial<
    ConstructorParameters<typeof OpenAiCompatibleProvider>[0]
  > = {},
) =>
  new OpenAiCompatibleProvider(
    {
      apiKey: LEAK,
      model: 'm',
      baseUrl: 'https://example.test/v1/',
      maxTokens: 100,
      maxResponseBytes: 1024,
      tokenParam: 'max_tokens',
      sendTemperature: true,
      userKey: true,
      ...extra,
    },
    fetchImpl,
  );
const fakeFetch = (status: number, body = '{}') =>
  (() =>
    Promise.resolve(new Response(body, { status }))) as unknown as typeof fetch;
const runUser = (p: OpenAiCompatibleProvider) =>
  p
    .completeJson({ system: 's json', user: 'u' }, AbortSignal.timeout(2000))
    .then(
      () => 'OK',
      (e: unknown) => {
        expect(String(e)).not.toContain(LEAK);
        return (e as AiError).code;
      },
    );

describe('OpenAiCompatibleProvider (userKey)', () => {
  it.each([
    [401, '{}', 'AI_PROVIDER_AUTH'],
    [402, '{}', 'AI_PROVIDER_AUTH'],
    [403, '{}', 'AI_PROVIDER_AUTH'],
    [429, '{}', 'AI_PROVIDER_RATE_LIMITED'],
    [404, '{}', 'AI_MODEL_NOT_FOUND'],
    [
      400,
      '{"error":{"message":"The model `x` does not exist"}}',
      'AI_MODEL_NOT_FOUND',
    ],
    [400, '{"error":{"message":"bad request"}}', 'AI_OUTPUT_INVALID'],
    [
      400,
      '{"error":{"code":"model_not_found","message":"no access"}}',
      'AI_MODEL_NOT_FOUND',
    ],
    [
      400,
      `{"error":{"message":"Unsupported value: 'temperature' does not support 0 with this model."}}`,
      'AI_OUTPUT_INVALID',
    ],
    [
      400,
      `{"error":{"message":"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."}}`,
      'AI_OUTPUT_INVALID',
    ],
    [
      400,
      '[{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}]',
      'AI_PROVIDER_AUTH',
    ],
    [
      400,
      '{"error":{"message":"API key not valid. Please pass a valid API key."}}',
      'AI_PROVIDER_AUTH',
    ],
    [500, '{}', 'AI_PROVIDER_UNAVAILABLE'],
    [503, '{}', 'AI_PROVIDER_UNAVAILABLE'],
  ])('maps HTTP %i (%s) to %s', async (status, body, code) => {
    await expect(runUser(userProvider(fakeFetch(status, body)))).resolves.toBe(
      code,
    );
  });

  it('only looks at the first 4 KiB of a 400 body', async () => {
    const body = `${' '.repeat(5000)}model`;
    await expect(runUser(userProvider(fakeFetch(400, body)))).resolves.toBe(
      'AI_OUTPUT_INVALID',
    );
  });

  it('keeps the key out of the error when fetch throws it', async () => {
    const throwing = (() =>
      Promise.reject(new Error(`boom ${LEAK}`))) as unknown as typeof fetch;
    await expect(runUser(userProvider(throwing))).resolves.toBe(
      'AI_PROVIDER_UNAVAILABLE',
    );
  });

  it('uses max_completion_tokens and omits temperature when asked', async () => {
    let sent: Record<string, unknown> = {};
    const capture = (_: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve(new Response(completion('{"a":1}')));
    };
    await userProvider(capture, {
      tokenParam: 'max_completion_tokens',
      sendTemperature: false,
    }).completeJson({ system: 's', user: 'u' }, AbortSignal.timeout(2000));
    expect(sent.max_completion_tokens).toBe(100);
    expect(sent).not.toHaveProperty('max_tokens');
    expect(sent).not.toHaveProperty('temperature');
  });
});
