import { randomUUID } from 'node:crypto';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createAiApp } from '../src/app';
import { loadAiConfig } from '../src/config/ai-config';
import { ServiceJwtVerifier } from '../src/infrastructure/auth/service-jwt-verifier';
import { LlmProvider, LlmRequest } from '../src/application/llm-provider';
import { AiError } from '../src/domain/errors';
import { signJwt, testKeys } from './support/jwt';

const keys = testKeys();
class Fake implements LlmProvider {
  calls: LlmRequest[] = [];
  next: (signal: AbortSignal) => Promise<Record<string, unknown>> =
    async () => ({ summary: 'ok' });
  completeJson(r: LlmRequest, s: AbortSignal) {
    this.calls.push(r);
    return this.next(s);
  }
}

let app: NestFastifyApplication;
let provider: Fake;
const config = loadAiConfig({
  DEEPSEEK_API_KEY: 'k',
  DEEPSEEK_MODEL: 'm',
  AI_SERVICE_JWKS_FILE: '/unused',
  AI_REQUEST_TIMEOUT_MS: '1000',
});

beforeEach(async () => {
  provider = new Fake();
  app = await createAiApp({
    config,
    provider,
    verifier: ServiceJwtVerifier.fromJwks(keys.jwks),
  });
});
afterEach(() => app.close());

const now = () => Math.floor(Date.now() / 1000);
function call(
  op: string,
  body: Record<string, unknown>,
  claims: Record<string, unknown> = {},
) {
  const requestId = (body.requestId as string) ?? randomUUID();
  const workspaceId = (body.workspaceId as string) ?? randomUUID();
  const token = signJwt(keys.privateKey, {
    iss: 'weav-workflow',
    aud: 'weav-ai',
    scope: `ai:${op}`,
    workspace_id: workspaceId,
    request_id: requestId,
    mode: op === 'generate' ? 'generation' : 'execution',
    execution_id: randomUUID(),
    node_execution_id: randomUUID(),
    iat: now(),
    exp: now() + 60,
    jti: randomUUID(),
    ...claims,
  });
  return app.inject({
    method: 'POST',
    url: `/v1/${op}`,
    headers: {
      authorization: `Bearer ${token}`,
      'x-request-id': requestId,
      'content-type': 'application/json',
    },
    payload: JSON.stringify({ requestId, workspaceId, operation: op, ...body }),
  });
}
const raw = (payload: string, headers: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/v1/summarize', headers, payload });
const summarizeBody = { text: 'Xin chào', maxLength: 10 };

describe('AI HTTP', () => {
  it('summarizes with a valid token', async () => {
    const res = await call('summarize', summarizeBody);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      result: { summary: 'ok', truncated: false },
    });
  });

  it.each([
    ['wrong issuer', { iss: 'weav-ocr' }, 401],
    ['wrong audience', { aud: 'weav-ocr' }, 401],
    ['expired', { iat: now() - 300, exp: now() - 200 }, 401],
    ['lifetime over 120 s', { exp: now() + 600 }, 401],
    ['wrong scope', { scope: 'ai:extract' }, 403],
    ['wrong tenant', { workspace_id: randomUUID() }, 403],
    ['request binding', { request_id: randomUUID() }, 403],
    ['generation mode on a processing route', { mode: 'generation' }, 403],
  ])('rejects %s before the provider', async (_n, claims, status) => {
    const res = await call('summarize', summarizeBody, claims);
    expect(res.statusCode).toBe(status);
    expect(provider.calls).toHaveLength(0);
  });

  it('rejects alg none and an unknown kid', async () => {
    for (const header of [
      { alg: 'none', kid: 'test-kid' },
      { alg: 'RS256', kid: 'other' },
    ]) {
      const token = signJwt(keys.privateKey, { iss: 'weav-workflow' }, header);
      const res = await raw('{}', {
        authorization: `Bearer ${token}`,
        'x-request-id': randomUUID(),
        'content-type': 'application/json',
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('returns 401 UNAUTHENTICATED when Authorization and X-Request-ID are both missing', async () => {
    const res = await raw('{}', { 'content-type': 'application/json' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-uuid'],
  ])(
    'returns 400 INVALID_REQUEST for a %s X-Request-ID with a valid token',
    async (_n, headerValue) => {
      const bodyRequestId = randomUUID();
      const workspaceId = randomUUID();
      const token = signJwt(keys.privateKey, {
        iss: 'weav-workflow',
        aud: 'weav-ai',
        scope: 'ai:summarize',
        workspace_id: workspaceId,
        request_id: bodyRequestId,
        mode: 'execution',
        execution_id: randomUUID(),
        node_execution_id: randomUUID(),
        iat: now(),
        exp: now() + 60,
        jti: randomUUID(),
      });
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      };
      if (headerValue !== undefined) headers['x-request-id'] = headerValue;
      const res = await app.inject({
        method: 'POST',
        url: '/v1/summarize',
        headers,
        payload: JSON.stringify({
          requestId: bodyRequestId,
          workspaceId,
          operation: 'summarize',
          ...summarizeBody,
        }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_REQUEST');
      expect(provider.calls).toHaveLength(0);
    },
  );

  it.each([
    ['unknown envelope field', { ...summarizeBody, extra: 1 }],
    [
      'text over 50,000 code points',
      { text: '𝒳'.repeat(50_001), maxLength: 10 },
    ],
    ['maxLength out of range', { text: 't', maxLength: 0 }],
  ])('rejects %s as INVALID_REQUEST', async (_n, body) => {
    const res = await call('summarize', body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_REQUEST');
  });

  it('rejects a prototype key, a non-JSON media type, and an oversized body', async () => {
    expect(
      (await raw('{"__proto__":{}}', { 'content-type': 'application/json' }))
        .statusCode,
    ).toBe(400);
    expect((await raw('x', { 'content-type': 'text/plain' })).statusCode).toBe(
      400,
    );
    expect(
      (
        await raw('x'.repeat(300 * 1024), {
          'content-type': 'application/json',
        })
      ).json().error.code,
    ).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns AI_TIMEOUT when the deadline fires and admits the next request', async () => {
    provider.next = (signal) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () =>
          reject(new AiError('AI_TIMEOUT')),
        ),
      );
    const workspaceId = randomUUID();
    const [a, b] = await Promise.all([
      call('summarize', { ...summarizeBody, workspaceId }),
      call('summarize', { ...summarizeBody, workspaceId }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([504, 504]);
    provider.next = async () => ({ summary: 'ok' });
    expect(
      (await call('summarize', { ...summarizeBody, workspaceId })).statusCode,
    ).toBe(200);
  });

  it('returns AI_BUSY past 2 in-flight calls per workspace and isolates other tenants', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    provider.next = async () => {
      await gate;
      return { summary: 'ok' };
    };
    const workspaceId = randomUUID();
    const inFlight = [
      call('summarize', { ...summarizeBody, workspaceId }),
      call('summarize', { ...summarizeBody, workspaceId }),
    ];
    await new Promise((r) => setTimeout(r, 20));
    expect(
      (await call('summarize', { ...summarizeBody, workspaceId })).json().error
        .code,
    ).toBe('AI_BUSY');
    const other = call('summarize', summarizeBody); // a different tenant still gets a slot (3 of 4)
    release();
    expect((await other).statusCode).toBe(200);
    await Promise.all(inFlight);
  });

  it('never echoes provider or model detail in errors', async () => {
    provider.next = async () => {
      throw new AiError('AI_OUTPUT_INVALID');
    };
    const res = await call('summarize', summarizeBody);
    expect(res.json()).toEqual({
      error: {
        code: 'AI_OUTPUT_INVALID',
        message: 'The AI provider returned an invalid result.',
        requestId: expect.any(String),
      },
    });
  });

  it('returns 401 for unauthenticated callers regardless of provider/JWKS config', async () => {
    const res = await raw('{}', { 'content-type': 'application/json' });
    expect(res.statusCode).toBe(401);
  });

  it('echoes a valid X-Correlation-ID and ignores an invalid one', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-correlation-id': 'corr-123' },
    });
    expect(ok.headers['x-correlation-id']).toBe('corr-123');
    for (const bad of ['bad id!', 'x'.repeat(129)]) {
      const res = await app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { 'x-correlation-id': bad },
      });
      expect(res.headers['x-correlation-id']).toBeUndefined();
    }
    const err = await raw('{}', {
      'content-type': 'application/json',
      'x-correlation-id': 'corr-err',
    });
    expect(err.statusCode).toBe(401);
    expect(err.headers['x-correlation-id']).toBe('corr-err');
  });

  it('reports readiness', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/health/ready' })).statusCode,
    ).toBe(200);
    const unready = await createAiApp({
      config,
      provider: null,
      verifier: null,
    });
    expect(
      (await unready.inject({ method: 'GET', url: '/health/ready' }))
        .statusCode,
    ).toBe(503);
    expect(
      (await unready.inject({ method: 'GET', url: '/health/live' })).statusCode,
    ).toBe(200);
    const res = await unready.inject({
      method: 'POST',
      url: '/v1/summarize',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(401); // AI-8: no config leak before auth
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
    await unready.close();
  });
});
