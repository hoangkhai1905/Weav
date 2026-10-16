import { Logger } from '@nestjs/common';
import { REQUEST_CONTEXT, getRequestId } from './request-context';
import type { RequestContextCarrier } from './request-context';

const HEALTH_ROUTE = /^\/(?:health|ready)(?:\/|$)/;

interface AccessLogRequest extends RequestContextCarrier {
  method: string;
  routeOptions?: { url?: string };
}

const logger = new Logger('AccessLog');

/**
 * Fastify `onResponse` hook: one access-log line per finished request with method, route template, status,
 * duration, request id and (when proxied) the upstream name. Never the raw URL, query string, headers or bodies,
 * so no tokens, e-mail addresses or webhook keys can leak. Healthy health/ready probes are skipped (they run
 * every few seconds).
 */
export function accessLogHook(
  request: AccessLogRequest,
  reply: { statusCode: number; elapsedTime: number },
  done: () => void,
): void {
  const route = request.routeOptions?.url;
  const status = reply.statusCode;
  if (!(route && HEALTH_ROUTE.test(route) && status < 400)) {
    const upstream = request[REQUEST_CONTEXT]?.upstream;
    const line =
      `${request.method} ${route ?? 'unmatched'} status=${status} ` +
      `durationMs=${Math.round(reply.elapsedTime)} requestId=${getRequestId(request)}` +
      (upstream ? ` upstream=${upstream}` : '');
    if (status >= 500) {
      logger.warn(line);
    } else {
      logger.log(line);
    }
  }
  done();
}
