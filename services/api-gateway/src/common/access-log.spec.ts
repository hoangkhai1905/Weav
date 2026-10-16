import { Logger } from '@nestjs/common';
import { accessLogHook } from './access-log';
import { attachRequestContext, setRequestUpstream } from './request-context';

describe('accessLogHook', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  const run = (
    route: string | undefined,
    statusCode: number,
    upstream?: string,
  ) => {
    const request = {
      method: 'POST',
      // The raw url, headers and body must never reach the line.
      url: '/api/v1/webhooks/secret-key?token=abc',
      headers: { authorization: 'Bearer secret', 'x-email': 'a@b.example' },
      routeOptions: { url: route },
    };
    attachRequestContext(request, 'req-1');
    if (upstream) setRequestUpstream(request, upstream);
    const done = jest.fn();
    accessLogHook(request, { statusCode, elapsedTime: 12.4 }, done);
    expect(done).toHaveBeenCalledTimes(1);
  };

  it('logs the route template, status, duration, request id and upstream', () => {
    run('/api/v1/webhooks/:key', 200, 'workflow');
    expect(log).toHaveBeenCalledWith(
      'POST /api/v1/webhooks/:key status=200 durationMs=12 requestId=req-1 upstream=workflow',
    );
    const line = String((log.mock.calls as unknown[][])[0][0]);
    expect(line).not.toMatch(/secret|token|abc|@/);
  });

  it('omits the upstream when not proxied and uses a constant for unmatched routes', () => {
    run(undefined, 404);
    expect(log).toHaveBeenCalledWith(
      'POST unmatched status=404 durationMs=12 requestId=req-1',
    );
  });

  it('warns on 5xx', () => {
    run('/api/v1/x', 503, 'ai');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('skips healthy health probes but logs failing ones', () => {
    run('/health', 200);
    run('/ready', 200);
    run('/ready/upstreams', 200);
    expect(log).not.toHaveBeenCalled();
    run('/ready', 503);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
