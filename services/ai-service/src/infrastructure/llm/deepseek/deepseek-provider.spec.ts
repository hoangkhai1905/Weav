import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { DeepSeekProvider } from './deepseek-provider';

let server: Server;
let handler: (req: IncomingMessage, res: ServerResponse) => void;
let hits = 0;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((req, res) => { hits++; handler(req, res); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
beforeEach(() => { hits = 0; });

const provider = (maxResponseBytes = 1024 * 1024) =>
  new DeepSeekProvider({ apiKey: 'test-key', model: 'fixture-model', baseUrl, maxTokens: 4096, maxResponseBytes });
const completion = (content: string, finish = 'stop') =>
  JSON.stringify({ choices: [{ finish_reason: finish, message: { role: 'assistant', content } }] });
const reply = (status: number, body: string) => (_: IncomingMessage, res: ServerResponse) => {
  res.writeHead(status, { 'content-type': 'application/json' }).end(body);
};
const run = (p = provider(), signal = AbortSignal.timeout(2000)) =>
  p.completeJson({ system: 'Reply in json.', user: '{}' }, signal).then(() => 'OK', (e) => e.code as string);

describe('DeepSeekProvider', () => {
  it('sends JSON mode without tools or streaming, and returns the parsed object', async () => {
    let sent: { auth?: string; body: Record<string, unknown> } | undefined;
    handler = (req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c)).on('end', () => {
        sent = { auth: req.headers.authorization, body: JSON.parse(raw) };
        reply(200, completion('{"a":1}'))(req, res);
      });
    };
    await expect(provider().completeJson({ system: 's json', user: 'u' }, AbortSignal.timeout(2000))).resolves.toEqual({ a: 1 });
    expect(sent?.auth).toBe('Bearer test-key');
    expect(sent?.body).toMatchObject({ model: 'fixture-model', response_format: { type: 'json_object' }, stream: false, max_tokens: 4096 });
    expect(sent?.body.tools).toBeUndefined();
  });

  it.each([
    [401, 'AI_PROVIDER_AUTH'], [402, 'AI_PROVIDER_AUTH'], [403, 'AI_PROVIDER_AUTH'],
    [429, 'AI_PROVIDER_UNAVAILABLE'], [500, 'AI_PROVIDER_UNAVAILABLE'], [503, 'AI_PROVIDER_UNAVAILABLE'],
    [400, 'AI_OUTPUT_INVALID'],
  ])('maps HTTP %i to %s with exactly one attempt', async (status, code) => {
    handler = reply(status, '{"error":{"message":"provider detail must not leak"}}');
    await expect(run()).resolves.toBe(code);
    expect(hits).toBe(1);
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
    handler = () => { /* never responds */ };
    await expect(run(provider(), AbortSignal.timeout(100))).resolves.toBe('AI_TIMEOUT');
  });

  it('maps a refused connection to AI_PROVIDER_UNAVAILABLE', async () => {
    const dead = new DeepSeekProvider({ apiKey: 'k', model: 'm', baseUrl: 'http://127.0.0.1:1', maxTokens: 10, maxResponseBytes: 10 });
    await expect(run(dead)).resolves.toBe('AI_PROVIDER_UNAVAILABLE');
  });
});
