import { randomUUID } from 'node:crypto';

export const REQUEST_CONTEXT = Symbol('gateway.request-context');

export interface GatewayRequestContext {
  requestId: string;
}

export interface RequestContextCarrier {
  headers?: Record<string, unknown>;
  raw?: unknown;
  [REQUEST_CONTEXT]?: GatewayRequestContext;
}

interface HeaderCollection {
  forEach(callback: (value: string, key: string) => void): void;
}

interface HeaderReply {
  header(name: string, value: string): unknown;
}

interface AbortableRequest extends Record<string, unknown> {
  once?: (event: string, listener: () => void) => unknown;
  removeListener?: (event: string, listener: () => void) => unknown;
  aborted?: boolean;
  complete?: boolean;
  destroyed?: boolean;
}

interface AbortableReply {
  raw?: unknown;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const TRACEPARENT_PATTERN =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

const SAFE_UPSTREAM_RESPONSE_HEADERS = new Set([
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-language',
  'content-range',
  'content-type',
  'etag',
  'expires',
  'last-modified',
  'location',
  'retry-after',
  'vary',
  'www-authenticate',
]);

function readHeaderValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const expectedName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== expectedName) {
      continue;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (
      Array.isArray(value) &&
      value.length === 1 &&
      typeof value[0] === 'string'
    ) {
      return value[0];
    }
    return undefined;
  }

  return undefined;
}

export function getRequestHeader(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  return readHeaderValue(headers, name);
}

export function resolveRequestId(headers: Record<string, unknown>): string {
  for (const headerName of ['x-request-id', 'x-correlation-id']) {
    const value = readHeaderValue(headers, headerName);
    if (value !== undefined && REQUEST_ID_PATTERN.test(value)) {
      return value;
    }
  }

  return randomUUID();
}

export function attachRequestContext(
  request: RequestContextCarrier,
  requestId: string,
): void {
  Object.defineProperty(request, REQUEST_CONTEXT, {
    configurable: true,
    enumerable: false,
    value: { requestId },
    writable: false,
  });
}

export function getRequestId(request: RequestContextCarrier): string {
  const existing = request[REQUEST_CONTEXT]?.requestId;
  if (existing) {
    return existing;
  }
  return resolveRequestId(request.headers ?? {});
}

export function setResponseRequestId(
  reply: HeaderReply,
  requestId: string,
): void {
  reply.header('X-Request-ID', requestId);
  reply.header('X-Correlation-ID', requestId);
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const NON_MUTATING_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Adds the gateway-derived client IP (Fastify honours GATEWAY_TRUST_PROXY_HOPS)
 * and, on mutations, a well-formed Idempotency-Key. Client-supplied
 * X-Forwarded-For is never copied; it is always replaced by the derived IP.
 */
export function applyClientForwardingHeaders(
  request: { headers?: Record<string, unknown>; ip?: unknown },
  headers: Record<string, string>,
  method: string,
): void {
  if (typeof request.ip === 'string' && request.ip.length > 0) {
    headers['x-forwarded-for'] = request.ip;
  }
  if (NON_MUTATING_METHODS.has(method.toUpperCase())) {
    return;
  }
  const idempotencyKey = readHeaderValue(request.headers, 'idempotency-key');
  if (idempotencyKey && IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    headers['idempotency-key'] = idempotencyKey;
  }
}

export function isValidTraceparent(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = TRACEPARENT_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const [, version, traceId, parentId] = match;
  return (
    version.toLowerCase() !== 'ff' &&
    !/^0+$/.test(traceId) &&
    !/^0+$/.test(parentId)
  );
}

export function collectSafeUpstreamResponseHeaders(
  headers: HeaderCollection,
): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (SAFE_UPSTREAM_RESPONSE_HEADERS.has(lowerKey)) {
      result[lowerKey] = value;
    }
  });
  return result;
}

export interface UpstreamAbortHandle {
  signal: AbortSignal;
  /** True only when the upstream deadline fired (not a client disconnect). */
  readonly timedOut: boolean;
  cleanup(): void;
}

export const UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN = {
  status: 504,
  code: 'UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN',
  message:
    'Upstream timed out; the outcome is unknown. Retry with the same Idempotency-Key.',
} as const;

/** A write that timed out may have committed, so it gets 504, not 503. */
export function isWriteTimeout(
  handle: Pick<UpstreamAbortHandle, 'timedOut'>,
  method: string,
): boolean {
  return handle.timedOut && !NON_MUTATING_METHODS.has(method.toUpperCase());
}

export function createUpstreamAbortHandle(
  request: RequestContextCarrier | undefined,
  reply: AbortableReply | undefined,
  timeoutMs: number,
): UpstreamAbortHandle {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('upstream timeout'));
  }, timeoutMs);
  const raw = request?.raw;
  const listeners: Array<{
    target: AbortableRequest;
    event: string;
    listener: () => void;
  }> = [];

  const abort = (reason: string) => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(reason));
    }
  };

  const addListener = (
    target: AbortableRequest | undefined,
    event: string,
    listener: () => void,
  ) => {
    if (target && typeof target.once === 'function') {
      target.once(event, listener);
      listeners.push({ target, event, listener });
    }
  };

  if (raw && typeof raw === 'object') {
    const candidate = raw as AbortableRequest;
    const onAborted = () => {
      abort('client disconnected');
    };
    const onClose = () => {
      if (candidate.aborted === true || candidate.complete === false) {
        onAborted();
      }
    };

    if (
      candidate.aborted === true ||
      (candidate.destroyed === true && candidate.complete === false)
    ) {
      onAborted();
    }
    addListener(candidate, 'aborted', onAborted);
    addListener(candidate, 'close', onClose);
  }

  const response =
    reply?.raw && typeof reply.raw === 'object'
      ? (reply.raw as AbortableRequest & {
          socket?: AbortableRequest;
          writableFinished?: boolean;
          destroyed?: boolean;
        })
      : undefined;
  if (response) {
    const onResponseClose = () => {
      if (response.writableFinished !== true) {
        abort('client disconnected');
      }
    };
    if (response.destroyed === true) {
      onResponseClose();
    }
    addListener(response, 'close', onResponseClose);

    const socket = response.socket;
    if (socket && socket !== response) {
      addListener(socket, 'close', onResponseClose);
    }
  }

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    cleanup: () => {
      clearTimeout(timer);
      for (const { target, event, listener } of listeners) {
        if (typeof target.removeListener === 'function') {
          target.removeListener(event, listener);
        }
      }
    },
  };
}
