import { BadRequestException, HttpException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import {
  attachRequestContext,
  type RequestContextCarrier,
} from './request-context';
import { GatewayExceptionFilter } from './gateway-exception.filter';

function createHost(request: RequestContextCarrier) {
  const reply = {
    code: jest.fn().mockReturnThis(),
    header: jest.fn().mockReturnThis(),
    send: jest.fn<void, [Record<string, unknown>]>(),
  };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;

  return { host, reply };
}

describe('GatewayExceptionFilter', () => {
  it('returns the gateway error envelope and both correlation headers', () => {
    const request: RequestContextCarrier = {
      headers: { 'x-request-id': 'req-filter' },
    };
    attachRequestContext(request, 'req-filter');
    const { host, reply } = createHost(request);

    new GatewayExceptionFilter().catch(
      new BadRequestException('invalid payload'),
      host,
    );

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.header).toHaveBeenNthCalledWith(
      1,
      'X-Request-ID',
      'req-filter',
    );
    expect(reply.header).toHaveBeenNthCalledWith(
      2,
      'X-Correlation-ID',
      'req-filter',
    );
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: 'BAD_REQUEST',
        message: 'invalid payload',
        details: [],
      },
      requestId: 'req-filter',
    });
  });

  it('preserves a safe structured gateway exception without exposing a status field', () => {
    const request: RequestContextCarrier = {
      headers: { 'x-correlation-id': 'corr-filter' },
    };
    attachRequestContext(request, 'corr-filter');
    const { host, reply } = createHost(request);

    new GatewayExceptionFilter().catch(
      new HttpException(
        {
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid query',
            details: [{ field: 'page' }],
          },
        },
        400,
      ),
      host,
    );

    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid query',
        details: [{ field: 'page' }],
      },
      requestId: 'corr-filter',
    });
  });

  it('sanitizes unexpected exceptions and never returns the exception message', () => {
    const secret = 'database password should not cross the gateway';
    const request: RequestContextCarrier = {
      headers: { 'x-request-id': 'req-internal-error' },
    };
    attachRequestContext(request, 'req-internal-error');
    const { host, reply } = createHost(request);

    new GatewayExceptionFilter().catch(new Error(secret), host);

    const body = reply.send.mock.calls[0][0];
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
        details: [],
      },
      requestId: 'req-internal-error',
    });
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it('sanitizes structured 5xx exceptions instead of returning their secret details', () => {
    const secret = 'upstream password must stay private';
    const request: RequestContextCarrier = {
      headers: { 'x-request-id': 'req-structured-500' },
    };
    attachRequestContext(request, 'req-structured-500');
    const { host, reply } = createHost(request);

    new GatewayExceptionFilter().catch(
      new HttpException(
        {
          error: {
            code: 'UPSTREAM_FAILURE',
            message: secret,
            details: [{ secret }],
          },
        },
        503,
      ),
      host,
    );

    const body = reply.send.mock.calls[0][0];
    expect(body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Internal server error',
        details: [],
      },
      requestId: 'req-structured-500',
    });
    expect(JSON.stringify(body)).not.toContain(secret);
  });
});
