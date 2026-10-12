import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ApiErrorFilter } from './http';

describe('ApiErrorFilter', () => {
  const filter = new ApiErrorFilter();
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());
  function run(exception: unknown) {
    const send = jest.fn<
      void,
      [{ error: { code: string; message: string }; path: string }]
    >();
    const code = jest
      .fn<{ send: typeof send }, [number]>()
      .mockReturnValue({ send });
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ url: '/api/notifications?token=secret' }),
        getResponse: () => ({ code }),
      }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return {
      status: code.mock.calls[0][0],
      body: send.mock.calls[0][0],
    };
  }
  it.each([
    [new HttpException('x', 400), 400, 'BAD_REQUEST'],
    [new NotFoundException(), 404, 'NOT_FOUND'],
    [new HttpException('x', 413), 413, 'PAYLOAD_TOO_LARGE'],
    [new HttpException('x', 429), 429, 'TOO_MANY_REQUESTS'],
    [new HttpException('x', 503), 503, 'SERVICE_UNAVAILABLE'],
    [new HttpException('x', 418), 418, 'BAD_REQUEST'],
    [new HttpException('x', 500), 500, 'INTERNAL_ERROR'],
  ])('maps %p to %i %s', (exception, status, code) => {
    const result = run(exception);
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
  });
  it('maps Fastify errors that carry a statusCode (body too large)', () => {
    const result = run(
      Object.assign(new Error('Request body is too large'), {
        statusCode: 413,
        code: 'FST_ERR_CTP_BODY_TOO_LARGE',
      }),
    );
    expect(result.status).toBe(413);
    expect(result.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(log).not.toHaveBeenCalled();
  });
  it('logs 5xx with the exception class and path only, and hides the message', () => {
    const result = run(new TypeError('connection string postgres://secret'));
    expect(result.status).toBe(500);
    expect(result.body.error.message).toBe('Service temporarily unavailable');
    expect(log).toHaveBeenCalledWith({
      event: 'notification_http_error',
      status: 500,
      path: '/api/notifications',
      errorClass: 'TypeError',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });
  it('does not log 4xx', () => {
    run(new HttpException('x', 429));
    expect(log).not.toHaveBeenCalled();
  });
});
