import type { ArgumentsHost } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { AiError } from '../../domain/errors';
import { AiExceptionFilter } from './ai-exception.filter';

const REQUEST_ID = '0b9f1c3e-5d1a-4c8e-9a52-1f3f6f0b7a11';

function host(headers: Record<string, string>, correlationId?: string) {
  const sent: { status?: number; body?: unknown } = {};
  const reply = {
    status: (code: number) => {
      sent.status = code;
      return reply;
    },
    send: (body: unknown) => {
      sent.body = body;
      return reply;
    },
  };
  const request = { url: '/v1/assistant/chat', headers, correlationId };
  const argumentsHost = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { argumentsHost, sent };
}

describe('AiExceptionFilter logging', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs the correlation id and request id with an unexpected failure, and nothing else', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { argumentsHost, sent } = host(
      { 'x-request-id': REQUEST_ID, authorization: 'Bearer secret-token' },
      'corr-123',
    );
    new AiExceptionFilter().catch(
      new Error('boom with a prompt inside'),
      argumentsHost,
    );
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toEqual({
      correlationId: 'corr-123',
      requestId: REQUEST_ID,
      errorClass: 'Error',
    });
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/secret|prompt/);
    expect(sent.status).toBe(500);
    expect(sent.body).toMatchObject({
      error: { code: 'INTERNAL_ERROR', requestId: REQUEST_ID },
    });
  });

  it('logs null ids when the headers are absent or malformed, and does not log expected errors', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const bad = host({ 'x-request-id': 'not-a-uuid' });
    new AiExceptionFilter().catch(new TypeError('x'), bad.argumentsHost);
    expect(error.mock.calls[0][0]).toEqual({
      correlationId: undefined,
      requestId: null,
      errorClass: 'TypeError',
    });
    new AiExceptionFilter().catch(
      new AiError('AI_BUSY'),
      host({}).argumentsHost,
    );
    expect(error).toHaveBeenCalledTimes(1);
  });
});
