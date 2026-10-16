import { Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  attachRequestContext,
  REQUEST_CONTEXT,
  type RequestContextCarrier,
} from './request-context';
import {
  buildUpstreamHeaders,
  createProxyFail,
  failOutcomeUnknown,
  logUpstreamFailure,
  readBearerAuthorization,
  startUpstreamCall,
} from './upstream-proxy';

function fakeReply(sent = false) {
  const headers: Record<string, string> = {};
  const reply = {
    sent,
    headers,
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    header(name: string, value: string) {
      headers[name] = value;
      return reply;
    },
    code(status: number) {
      reply.statusCode = status;
      return reply;
    },
    send(body: unknown) {
      reply.body = body;
      return reply;
    },
  };
  return reply;
}

describe('readBearerAuthorization', () => {
  it('accepts a bounded Bearer token only', () => {
    expect(readBearerAuthorization({ authorization: 'Bearer abc' })).toBe(
      'Bearer abc',
    );
    expect(readBearerAuthorization({ authorization: 'bearer abc' })).toBe(
      'bearer abc',
    );
    expect(readBearerAuthorization({})).toBeUndefined();
    expect(readBearerAuthorization({ authorization: 'Basic abc' })).toBe(
      undefined,
    );
    expect(readBearerAuthorization({ authorization: 'Bearer a b' })).toBe(
      undefined,
    );
    expect(
      readBearerAuthorization({ authorization: `Bearer ${'a'.repeat(8190)}` }),
    ).toBeUndefined();
  });
});

describe('buildUpstreamHeaders', () => {
  const traceparent = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;

  it('forwards ids, a valid traceparent and the token', () => {
    expect(
      buildUpstreamHeaders(
        { headers: { traceparent, 'user-agent': 'ua' } },
        'req-1',
        { authorization: 'Bearer t' },
      ),
    ).toEqual({
      accept: 'application/json',
      authorization: 'Bearer t',
      'x-correlation-id': 'req-1',
      'x-request-id': 'req-1',
      traceparent,
    });
  });

  it('drops an invalid traceparent and honours a custom accept', () => {
    expect(
      buildUpstreamHeaders({ headers: { traceparent: 'nope' } }, 'req-1', {
        accept: 'text/event-stream',
      }),
    ).toEqual({
      accept: 'text/event-stream',
      'x-correlation-id': 'req-1',
      'x-request-id': 'req-1',
    });
  });

  it('adds user-agent and client forwarding headers only for a client method', () => {
    const request = {
      headers: {
        'user-agent': 'u'.repeat(600),
        'idempotency-key': 'key-12345',
      },
      ip: '10.0.0.9',
    };
    const post = buildUpstreamHeaders(request, 'r', { clientMethod: 'POST' });
    expect(post['user-agent']).toHaveLength(512);
    expect(post['x-forwarded-for']).toBe('10.0.0.9');
    expect(post['idempotency-key']).toBe('key-12345');
    const get = buildUpstreamHeaders(request, 'r', { clientMethod: 'GET' });
    expect(get['idempotency-key']).toBeUndefined();
    expect(buildUpstreamHeaders(request, 'r')['x-forwarded-for']).toBe(
      undefined,
    );
  });
});

describe('createProxyFail', () => {
  const carrier = (raw?: object): RequestContextCarrier => ({ raw });

  it('sends the gateway error envelope with no-store', () => {
    const reply = fakeReply();
    const fail = createProxyFail(
      carrier({}),
      reply as unknown as FastifyReply,
      'req-1',
    );
    fail(503, 'SERVICE_UNAVAILABLE', 'down');
    expect(reply.statusCode).toBe(503);
    expect(reply.body).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'down', details: [] },
      status: 503,
      requestId: 'req-1',
    });
    expect(reply.headers).toMatchObject({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Request-ID': 'req-1',
      'X-Correlation-ID': 'req-1',
    });
  });

  it('sends nothing once the reply is sent or the client is gone', () => {
    for (const [sent, raw] of [
      [true, {}],
      [false, { aborted: true }],
      [false, { destroyed: true }],
    ] as const) {
      const reply = fakeReply(sent);
      const fail = createProxyFail(
        carrier(raw),
        reply as unknown as FastifyReply,
        'req-1',
      );
      expect(fail(503, 'X', 'y')).toBeUndefined();
      expect(reply.statusCode).toBeUndefined();
    }
  });

  it('can skip the closed-client guard and the no-store header', () => {
    const reply = fakeReply(true);
    const fail = createProxyFail(
      carrier({ aborted: true }),
      reply as unknown as FastifyReply,
      'req-1',
      { skipWhenClosed: false, noStore: false },
    );
    fail(502, 'BAD_GATEWAY', 'bad');
    expect(reply.statusCode).toBe(502);
    expect(reply.headers['Cache-Control']).toBeUndefined();
  });

  it('maps a timed-out write to the outcome-unknown 504', () => {
    const reply = fakeReply();
    const fail = createProxyFail(
      carrier({}),
      reply as unknown as FastifyReply,
      'req-1',
    );
    failOutcomeUnknown(fail);
    expect(reply.statusCode).toBe(504);
    expect((reply.body as { error: { code: string } }).error.code).toBe(
      'UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN',
    );
  });
});

describe('upstream call logging', () => {
  afterEach(() => jest.restoreAllMocks());

  it('marks the request upstream and logs name and latency without a body or url', () => {
    const request: RequestContextCarrier = {};
    attachRequestContext(request, 'req-9');
    const call = startUpstreamCall(request, 'workflow', 'req-9');
    expect(request[REQUEST_CONTEXT]?.upstream).toBe('workflow');

    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    logUpstreamFailure(new Logger('t'), call, 'Workflow upstream failed');
    logUpstreamFailure(new Logger('t'), call, 'Workspace upstream failed', 'x');
    expect(error.mock.calls[0][0]).toMatch(
      /^Workflow upstream failed requestId=req-9 upstream=workflow latencyMs=\d+$/,
    );
    expect(error.mock.calls[1][0]).toMatch(/latencyMs=\d+ error=x$/);
  });
});
