import type { Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  applyClientForwardingHeaders,
  getRequestHeader,
  isValidTraceparent,
  setRequestUpstream,
  setResponseRequestId,
  UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN,
  type RequestContextCarrier,
} from './request-context';

/** Shared plumbing for the proxy services (workflow, workspace, notification, assistant). */

const MAX_AUTHORIZATION_LENGTH = 8192;

/** The caller's `Authorization` header when it is a well-formed, bounded Bearer token; otherwise undefined. */
export function readBearerAuthorization(
  headers: Record<string, unknown> | undefined,
): string | undefined {
  const authorization = getRequestHeader(headers, 'authorization');
  if (
    !authorization ||
    authorization.length > MAX_AUTHORIZATION_LENGTH ||
    !/^Bearer \S+$/i.test(authorization)
  ) {
    return undefined;
  }
  return authorization;
}

export interface UpstreamHeaderOptions {
  /** Defaults to application/json. */
  accept?: string;
  authorization?: string;
  /** When set, also forwards user-agent and the gateway-derived client headers for this HTTP method. */
  clientMethod?: string;
}

export function buildUpstreamHeaders(
  request: { headers?: Record<string, unknown>; ip?: unknown },
  requestId: string,
  options: UpstreamHeaderOptions = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: options.accept ?? 'application/json',
  };
  if (options.authorization) {
    headers.authorization = options.authorization;
  }
  headers['x-correlation-id'] = requestId;
  headers['x-request-id'] = requestId;
  const traceparent = getRequestHeader(request.headers, 'traceparent');
  if (isValidTraceparent(traceparent)) {
    headers.traceparent = traceparent;
  }
  if (options.clientMethod !== undefined) {
    const userAgent = getRequestHeader(request.headers, 'user-agent');
    if (userAgent) {
      headers['user-agent'] = userAgent.slice(0, 512);
    }
    applyClientForwardingHeaders(request, headers, options.clientMethod);
  }
  return headers;
}

export interface ProxyFailOptions {
  /** Send nothing once the reply is sent or the client is gone. Default true. */
  skipWhenClosed?: boolean;
  /** Add `Cache-Control: no-store` to the error reply. Default true. */
  noStore?: boolean;
}

export type ProxyFail = (
  status: number,
  code: string,
  message: string,
) => FastifyReply | undefined;

/** Builds the gateway error-envelope sender every proxy uses for its own failures. */
export function createProxyFail(
  request: RequestContextCarrier,
  reply: FastifyReply,
  requestId: string,
  { skipWhenClosed = true, noStore = true }: ProxyFailOptions = {},
): ProxyFail {
  return (status, code, message) => {
    if (skipWhenClosed) {
      const raw = request.raw as
        { aborted?: boolean; destroyed?: boolean } | undefined;
      if (reply.sent || raw?.aborted === true || raw?.destroyed === true) {
        return undefined;
      }
    }
    reply.header('Content-Type', 'application/json; charset=utf-8');
    setResponseRequestId(reply, requestId);
    if (noStore) {
      reply.header('Cache-Control', 'no-store');
    }
    return reply.code(status).send({
      error: { code, message, details: [] },
      status,
      requestId,
    });
  };
}

/** A write that timed out may have committed: 504 with the "outcome unknown" code instead of 503. */
export function failOutcomeUnknown(fail: ProxyFail): FastifyReply | undefined {
  return fail(
    UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.status,
    UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.code,
    UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN.message,
  );
}

export interface UpstreamCall {
  upstream: string;
  requestId: string;
  startedAt: number;
}

/** Marks the request as proxied to `upstream` (for the access log) and starts the latency clock. */
export function startUpstreamCall(
  request: RequestContextCarrier,
  upstream: string,
  requestId: string,
): UpstreamCall {
  setRequestUpstream(request, upstream);
  return { upstream, requestId, startedAt: performance.now() };
}

/** Upstream failure log line: always carries the upstream name and how long the call ran. */
export function logUpstreamFailure(
  logger: Logger,
  call: UpstreamCall,
  what: string,
  error?: string,
): void {
  const latencyMs = Math.round(performance.now() - call.startedAt);
  logger.error(
    `${what} requestId=${call.requestId} upstream=${call.upstream} latencyMs=${latencyMs}${
      error === undefined ? '' : ` error=${error}`
    }`,
  );
}
