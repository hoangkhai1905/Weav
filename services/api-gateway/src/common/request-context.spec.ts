import {
  collectSafeUpstreamResponseHeaders,
  createUpstreamAbortHandle,
  isValidTraceparent,
  isWriteTimeout,
  resolveRequestId,
} from './request-context';
import { EventEmitter } from 'node:events';

describe('request context helpers', () => {
  it('prefers a valid X-Request-ID over X-Correlation-Id', () => {
    expect(
      resolveRequestId({
        'x-request-id': 'req-123',
        'x-correlation-id': 'other',
      }),
    ).toBe('req-123');
  });

  it('falls back to a valid X-Correlation-Id when X-Request-ID is invalid', () => {
    expect(
      resolveRequestId({
        'x-request-id': 'not valid',
        'x-correlation-id': 'corr-123',
      }),
    ).toBe('corr-123');
  });

  it.each([
    ['empty', ''],
    ['overlong', 'a'.repeat(129)],
    ['control characters', '\r\ninvalid'],
    ['unsupported characters', 'request/id'],
  ])('generates a UUID for an %s external ID', (_label, value) => {
    expect(resolveRequestId({ 'x-request-id': value })).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
  });

  it('reads header names case-insensitively and accepts the documented ID alphabet', () => {
    expect(resolveRequestId({ 'X-REQUEST-ID': 'A._:-request-123' })).toBe(
      'A._:-request-123',
    );
  });

  it('validates W3C traceparent before it can be forwarded', () => {
    expect(
      isValidTraceparent(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      ),
    ).toBe(true);
    expect(
      isValidTraceparent(
        '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
      ),
    ).toBe(false);
    expect(isValidTraceparent('not-a-traceparent')).toBe(false);
    expect(
      isValidTraceparent(
        '00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01',
      ),
    ).toBe(false);
  });

  it('copies only safe upstream response headers', () => {
    const headers = new Headers({
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'retry-after': '5',
      'set-cookie': 'session=secret',
      'x-internal-secret': 'do-not-forward',
      connection: 'keep-alive',
    });

    expect(collectSafeUpstreamResponseHeaders(headers)).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'retry-after': '5',
    });
  });

  it('does not abort an active request merely because its body is incomplete', () => {
    const raw = new EventEmitter() as EventEmitter & {
      aborted: boolean;
      complete: boolean;
      destroyed: boolean;
    };
    raw.aborted = false;
    raw.complete = false;
    raw.destroyed = false;

    const handle = createUpstreamAbortHandle({ raw }, undefined, 10_000);

    expect(handle.signal.aborted).toBe(false);

    raw.emit('close');
    expect(handle.signal.aborted).toBe(true);

    handle.cleanup();
  });

  it('cancels a request already destroyed before forwarding starts', () => {
    const raw = new EventEmitter() as EventEmitter & {
      aborted: boolean;
      complete: boolean;
      destroyed: boolean;
    };
    raw.aborted = false;
    raw.complete = false;
    raw.destroyed = true;

    const handle = createUpstreamAbortHandle({ raw }, undefined, 10_000);

    expect(handle.signal.aborted).toBe(true);
    handle.cleanup();
  });

  it('flags a deadline as timed out and 504s only writes', () => {
    jest.useFakeTimers();
    try {
      const handle = createUpstreamAbortHandle(undefined, undefined, 50);
      expect(handle.timedOut).toBe(false);
      jest.advanceTimersByTime(50);
      expect(handle.timedOut).toBe(true);
      expect(isWriteTimeout(handle, 'POST')).toBe(true);
      expect(isWriteTimeout(handle, 'DELETE')).toBe(true);
      expect(isWriteTimeout(handle, 'GET')).toBe(false);
      handle.cleanup();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not flag a client disconnect as a timeout', () => {
    const raw = new EventEmitter();
    const handle = createUpstreamAbortHandle({ raw }, undefined, 5_000);
    raw.emit('aborted');
    expect(handle.signal.aborted).toBe(true);
    expect(isWriteTimeout(handle, 'POST')).toBe(false);
    handle.cleanup();
  });
});
