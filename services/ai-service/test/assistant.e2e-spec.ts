import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createAiApp } from '../src/app';
import { loadAiConfig } from '../src/config/ai-config';
import { AiError } from '../src/domain/errors';
import { ServiceJwtVerifier } from '../src/infrastructure/auth/service-jwt-verifier';
import { UserJwtVerifier } from '../src/infrastructure/auth/user-jwt-verifier';
import { signJwt, testKeys } from './support/jwt';
import {
  call,
  end,
  ScriptedChatProvider,
  text,
  type Round,
} from './support/scripted-chat-provider';

const keys = testKeys();
const nowS = () => Math.floor(Date.now() / 1000);
const WS = randomUUID();
const WF = randomUUID();
const EX = randomUUID();
const userToken = (extra: Record<string, unknown> = {}) =>
  signJwt(keys.privateKey, {
    sub: randomUUID(),
    sid: randomUUID(),
    jti: randomUUID(),
    iss: 'weav-identity',
    aud: 'weav-api',
    iat: nowS(),
    nbf: nowS(),
    exp: nowS() + 900,
    token_use: 'access',
    system_role: 'USER',
    user_status: 'ACTIVE',
    ...extra,
  });

let workflowApi: Server;
let workflowUrl: string;
let workspaceApi: Server;
let workspaceUrl: string;
let workspaceRequests: { url: string; headers: IncomingHttpHeaders }[];
let workflowRequests: { url: string; headers: IncomingHttpHeaders }[];
let app: NestFastifyApplication;
let baseUrl: string;
let provider: ScriptedChatProvider;

beforeAll(async () => {
  workflowApi = createServer((request, response) => {
    workflowRequests.push({ url: request.url ?? '', headers: request.headers });
    response.setHeader('content-type', 'application/json');
    if (request.url?.endsWith('/workflows/generate'))
      response.end(
        JSON.stringify({
          status: 'ready',
          name: 'Digest',
          definition: { nodes: [{ id: 'n1', type: 'trigger.manual' }] },
          layout: { n1: { x: 0, y: 0 } },
        }),
      );
    else if (request.url?.includes('/executions/'))
      response.end(
        JSON.stringify({
          status: 'FAILED',
          nodes: [
            {
              nodeId: 'n1',
              nodeType: 'action.http',
              status: 'FAILED',
              error: { code: 'HTTP_500', message: 'upstream failed' },
            },
          ],
        }),
      );
    else
      response.end(
        JSON.stringify({
          items: [
            {
              workflowId: WF,
              name: 'Daily',
              status: 'PUBLISHED',
              updatedAt: 'u',
            },
          ],
        }),
      );
  });
  await new Promise<void>((resolve) =>
    workflowApi.listen(0, '127.0.0.1', resolve),
  );
  workflowUrl = `http://127.0.0.1:${(workflowApi.address() as AddressInfo).port}`;
  workspaceApi = createServer((request, response) => {
    workspaceRequests.push({
      url: request.url ?? '',
      headers: request.headers,
    });
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        items: [
          {
            userId: randomUUID(),
            email: 'secret.person@example.test',
            displayName: 'Dana',
            role: 'OWNER',
            canPublishWorkflow: true,
            canManageWorkflowState: true,
            joinedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            active: true,
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) =>
    workspaceApi.listen(0, '127.0.0.1', resolve),
  );
  workspaceUrl = `http://127.0.0.1:${(workspaceApi.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => workflowApi.close(() => resolve()));
  await new Promise<void>((resolve) => workspaceApi.close(() => resolve()));
});

async function start(rounds: Round[], env: Record<string, string> = {}) {
  workflowRequests = [];
  workspaceRequests = [];
  provider = new ScriptedChatProvider(rounds);
  app = await createAiApp({
    config: loadAiConfig({
      AI_ASSISTANT_ENABLED: 'true',
      AI_WORKFLOW_API_URL: workflowUrl,
      AI_WORKSPACE_API_URL: workspaceUrl,
      DEEPSEEK_API_KEY: 'k',
      DEEPSEEK_MODEL: 'm',
      AI_REQUEST_TIMEOUT_MS: '5000',
      ...env,
    }),
    provider: {
      completeJson: () => Promise.resolve({ summary: 'ok' }),
    },
    verifier: ServiceJwtVerifier.fromJwks(keys.jwks),
    assistant: {
      provider,
      verifier: new UserJwtVerifier(
        {
          jwksUri: 'http://identity.test/jwks',
          issuer: 'weav-identity',
          audience: 'weav-api',
          clockSkewSeconds: 30,
        },
        (async () => new Response(keys.jwks)) as unknown as typeof fetch,
      ),
    },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
}
afterEach(() => app.close());

const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    workspaceId: WS,
    messages: [{ role: 'user', content: 'what failed?' }],
    ...extra,
  });
const post = (
  path: string,
  payload: string,
  token?: string,
  signal?: AbortSignal,
) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: payload,
  });
const chat = (payload = body(), token: string | undefined = userToken()) =>
  post('/v1/assistant/chat', payload, token);

function parseSse(raw: string) {
  return raw
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const [event, data] = block.split('\n');
      return {
        event: event.replace('event: ', ''),
        data: JSON.parse(data.replace('data: ', '')) as Record<string, unknown>,
      };
    });
}

describe('POST /v1/assistant/chat', () => {
  it('streams delta, tool_call, tool_result, delta, done in order, calling the workflow API with the user token', async () => {
    await start([
      [text('Checking. '), end(call('c1', 'list_workflows', {}))],
      [
        end(
          call('c2', 'explain_run_failure', {
            workflowId: WF,
            executionId: EX,
          }),
        ),
      ],
      [text('Run failed at n1.'), end()],
    ]);
    const token = userToken();
    const res = await chat(body(), token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const events = parseSse(await res.text());
    expect(events.map((e) => e.event)).toEqual([
      'delta',
      'tool_call',
      'tool_result',
      'tool_call',
      'tool_result',
      'delta',
      'done',
    ]);
    expect(events[1].data).toEqual({ name: 'list_workflows', arguments: {} });
    expect(events[2].data).toEqual({ name: 'list_workflows', ok: true });
    expect(workflowRequests.map((r) => r.url)).toEqual([
      `/workspaces/${WS}/workflows?page=0&size=50`,
      `/workspaces/${WS}/workflows/${WF}/executions/${EX}?logPage=0&logSize=1`,
    ]);
    expect(
      workflowRequests.every(
        (r) => r.headers.authorization === `Bearer ${token}`,
      ),
    ).toBe(true);
  });

  it('build_workflow: emits a draft event with the full draft, then done; nothing is saved', async () => {
    await start([
      [end(call('c1', 'build_workflow', { prompt: 'make a digest' }))],
      [text('Review the draft.'), end()],
    ]);
    const events = parseSse(await (await chat()).text());
    expect(events.map((e) => e.event)).toEqual([
      'tool_call',
      'tool_result',
      'draft',
      'delta',
      'done',
    ]);
    expect(events[2].data).toEqual({
      name: 'Digest',
      definition: { nodes: [{ id: 'n1', type: 'trigger.manual' }] },
      layout: { n1: { x: 0, y: 0 } },
    });
    // The model only saw the summary, not the definition.
    expect(JSON.stringify(provider.requests[1].messages)).not.toContain(
      'layout',
    );
    expect(workflowRequests.map((r) => r.url)).toEqual([
      `/workspaces/${WS}/workflows/generate`,
    ]);
  });

  it('list_members: no email appears in any SSE event or model message', async () => {
    await start([
      [end(call('c1', 'list_members', {}))],
      [text('Dana is the owner.'), end()],
    ]);
    const token = userToken();
    const raw = await (await chat(body(), token)).text();
    expect(raw).not.toContain('secret.person');
    expect(parseSse(raw).map((e) => e.event)).toEqual([
      'tool_call',
      'tool_result',
      'delta',
      'done',
    ]);
    expect(JSON.stringify(provider.requests[1].messages)).toContain('Dana');
    expect(JSON.stringify(provider.requests[1].messages)).not.toContain(
      'secret.person',
    );
    expect(workspaceRequests.map((r) => r.url)).toEqual([
      `/workspaces/${WS}/members?page=0&size=50`,
    ]);
    expect(workspaceRequests[0].headers.authorization).toBe(`Bearer ${token}`);
  });

  it('reports provider failures as a stable error event, no internals', async () => {
    await start([new AiError('AI_PROVIDER_UNAVAILABLE')]);
    const events = parseSse(await (await chat()).text());
    expect(events).toEqual([
      {
        event: 'error',
        data: {
          code: 'AI_PROVIDER_UNAVAILABLE',
          message: 'The AI provider is temporarily unavailable.',
        },
      },
    ]);
  });

  it('rejects missing, service and invalid tokens with 401 before anything else', async () => {
    await start([]);
    const service = signJwt(keys.privateKey, {
      iss: 'weav-workflow',
      aud: 'weav-ai',
      scope: 'ai:summarize',
      workspace_id: WS,
      request_id: randomUUID(),
      mode: 'execution',
      iat: nowS(),
      exp: nowS() + 60,
    });
    for (const token of [
      undefined,
      service,
      'garbage',
      userToken({ iss: 'x' }),
    ])
      expect((await post('/v1/assistant/chat', body(), token)).status).toBe(
        401,
      );
    expect(provider.requests).toHaveLength(0);
  });

  it('keeps the service-JWT routes closed to user tokens', async () => {
    await start([]);
    const res = await post(
      '/v1/summarize',
      JSON.stringify({ text: 'x' }),
      userToken(),
    );
    expect(res.status).toBe(401);
  });

  it.each([
    [
      'too many messages',
      {
        messages: Array.from({ length: 21 }, () => ({
          role: 'user',
          content: 'x',
        })),
      },
    ],
    [
      'overlong message',
      { messages: [{ role: 'user', content: 'x'.repeat(4001) }] },
    ],
    [
      'last message not from the user',
      { messages: [{ role: 'assistant', content: 'x' }] },
    ],
    ['system role', { messages: [{ role: 'system', content: 'x' }] }],
    ['bad workspace', { workspaceId: 'nope' }],
    ['unknown field', { extra: 1 }],
  ])('rejects %s with 400', async (_name, extra) => {
    await start([]);
    expect((await chat(body(extra))).status).toBe(400);
    expect(provider.requests).toHaveLength(0);
  });

  it('rate-limits per user', async () => {
    await start([], { AI_ASSISTANT_RATE_LIMIT_PER_MINUTE: '1' });
    const token = userToken({ sub: randomUUID() });
    expect((await chat(body(), token)).status).toBe(200);
    expect((await chat(body(), token)).status).toBe(429);
    expect((await chat(body(), userToken())).status).toBe(200);
  });

  it('has its own concurrency pool: a full assistant pool does not block service-JWT routes', async () => {
    await start([[text('partial')]], { AI_ASSISTANT_MAX_CONCURRENT: '1' });
    provider.hang = true;
    const abort = new AbortController();
    const first = await post(
      '/v1/assistant/chat',
      body(),
      userToken(),
      abort.signal,
    );
    await first.body!.getReader().read();
    // Pool of 1 is full: another user's stream is refused as busy.
    expect((await chat(body(), userToken())).status).toBe(429);
    // A workflow-service operation is still admitted.
    const requestId = randomUUID();
    const serviceToken = signJwt(keys.privateKey, {
      iss: 'weav-workflow',
      aud: 'weav-ai',
      scope: 'ai:summarize',
      workspace_id: WS,
      request_id: requestId,
      mode: 'execution',
      execution_id: randomUUID(),
      node_execution_id: randomUUID(),
      iat: nowS(),
      exp: nowS() + 60,
      jti: randomUUID(),
    });
    const res = await fetch(`${baseUrl}/v1/summarize`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${serviceToken}`,
        'x-request-id': requestId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        requestId,
        workspaceId: WS,
        operation: 'summarize',
        text: 'hello',
        maxLength: 10,
      }),
    });
    expect(res.status).toBe(200);
    abort.abort();
  });

  it('aborts the upstream model call when the client disconnects', async () => {
    await start([[text('partial')]]);
    provider.hang = true;
    const abort = new AbortController();
    const res = await post(
      '/v1/assistant/chat',
      body(),
      userToken(),
      abort.signal,
    );
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('event: delta');
    abort.abort();
    await reader.cancel().catch(() => undefined);
    for (let i = 0; i < 50 && !provider.aborted; i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(provider.aborted).toBe(true);
  });
});

describe('assistant flag off', () => {
  it('does not register the route: same answer as an unknown route', async () => {
    await start([], { AI_ASSISTANT_ENABLED: 'false' });
    const off = await chat();
    const unknown = await post('/v1/assistant/nope', body(), userToken());
    expect(off.status).toBe(unknown.status);
    expect(off.status).toBeGreaterThanOrEqual(400);
    expect(provider.requests).toHaveLength(0);
  });
});
