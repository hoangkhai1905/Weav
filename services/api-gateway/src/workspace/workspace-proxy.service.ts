import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GatewayConfig } from '../config/gateway.config';
import {
  collectSafeUpstreamResponseHeaders,
  createUpstreamAbortHandle,
  getRequestHeader,
  getRequestId,
  isValidTraceparent,
  setResponseRequestId,
  type RequestContextCarrier,
} from '../common/request-context';

type WorkspaceMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface WorkspaceForwardOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean>;
}

async function readUpstreamResponseBody(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };

  signal.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      if (signal.aborted) {
        throw new Error('Workspace upstream request aborted during body read');
      }
      const { done, value } = await reader.read();
      if (signal.aborted) {
        throw new Error('Workspace upstream request aborted during body read');
      }
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
      }
    }

    if (signal.aborted) {
      throw new Error('Workspace upstream request aborted after body read');
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
      'utf8',
    );
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

@Injectable()
export class WorkspaceProxyService {
  private readonly logger = new Logger(WorkspaceProxyService.name);

  constructor(private readonly config: ConfigService) {}

  async forward(
    method: WorkspaceMethod,
    request: FastifyRequest,
    reply: FastifyReply,
    path: string,
    options: WorkspaceForwardOptions = {},
  ): Promise<unknown> {
    const context = request as RequestContextCarrier;
    const requestId = getRequestId(context);
    setResponseRequestId(reply, requestId);
    reply.header('Cache-Control', 'no-store');

    const fail = (status: number, code: string, message: string) => {
      const raw = context.raw as
        { aborted?: boolean; destroyed?: boolean } | undefined;
      if (reply.sent || raw?.aborted === true || raw?.destroyed === true) {
        return undefined;
      }
      reply.header('Content-Type', 'application/json; charset=utf-8');
      setResponseRequestId(reply, requestId);
      reply.header('Cache-Control', 'no-store');
      return reply.code(status).send({
        error: { code, message, details: [] },
        status,
        requestId,
      });
    };

    const authorization = getRequestHeader(request.headers, 'authorization');
    if (
      !authorization ||
      authorization.length > 8192 ||
      !/^Bearer \S+$/i.test(authorization)
    ) {
      return fail(401, 'UNAUTHORIZED', 'Bearer token required');
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization,
      'x-correlation-id': requestId,
      'x-request-id': requestId,
    };
    const traceparent = getRequestHeader(request.headers, 'traceparent');
    if (isValidTraceparent(traceparent)) {
      headers.traceparent = traceparent;
    }
    const userAgent = getRequestHeader(request.headers, 'user-agent');
    if (userAgent) {
      headers['user-agent'] = userAgent.slice(0, 512);
    }

    let serializedBody: string | undefined;
    if (options.body !== undefined) {
      serializedBody = JSON.stringify(options.body);
      if (Buffer.byteLength(serializedBody, 'utf8') > 16_384) {
        return fail(413, 'PAYLOAD_TOO_LARGE', 'Request too large');
      }
      headers['content-type'] = 'application/json';
    }

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      query.set(key, String(value));
    }
    const queryString = query.toString();
    const targetPath = `/workspaces${path}${queryString ? `?${queryString}` : ''}`;
    const gateway = this.config.get<GatewayConfig>('gateway');
    const base =
      gateway?.upstreams?.workspace ??
      this.config.get<string>('WORKSPACE_SERVICE_URL') ??
      'http://workspace-service:8080';
    const targetUrl = `${base.replace(/\/+$/, '')}${targetPath}`;
    const abortHandle = createUpstreamAbortHandle(context, reply, 10_000);

    try {
      const response = await fetch(targetUrl, {
        method,
        headers,
        body: serializedBody,
        redirect: 'error',
        signal: abortHandle.signal,
      });
      const responseHeaders = collectSafeUpstreamResponseHeaders(
        response.headers,
      );

      if (response.status === 204) {
        setResponseRequestId(reply, requestId);
        reply.header('Cache-Control', 'no-store');
        return reply.code(204).send();
      }

      if (
        !responseHeaders['content-type']
          ?.toLowerCase()
          .includes('application/json')
      ) {
        try {
          await response.body?.cancel();
        } catch {
          // The upstream connection is already being discarded.
        }
        return fail(502, 'BAD_GATEWAY', 'Invalid Workspace response');
      }

      let responseText: string;
      try {
        responseText = await readUpstreamResponseBody(
          response,
          abortHandle.signal,
        );
      } catch (error) {
        if (abortHandle.signal.aborted) {
          throw error;
        }
        this.logger.error(
          `Workspace response read failed requestId=${requestId}`,
        );
        return fail(
          503,
          'SERVICE_UNAVAILABLE',
          'Workspace service unavailable',
        );
      }

      if (abortHandle.signal.aborted) {
        throw new Error('Workspace upstream request aborted after body read');
      }

      let responseBody: unknown;
      try {
        responseBody = JSON.parse(responseText) as unknown;
      } catch {
        return fail(502, 'BAD_GATEWAY', 'Invalid Workspace response');
      }

      if (abortHandle.signal.aborted) {
        throw new Error('Workspace upstream request aborted before response');
      }
      for (const [name, value] of Object.entries(responseHeaders)) {
        if (name !== 'cache-control') {
          reply.header(name, value);
        }
      }
      setResponseRequestId(reply, requestId);
      reply.header('Cache-Control', 'no-store');
      return reply.code(response.status).send(responseBody);
    } catch (error) {
      if (!abortHandle.signal.aborted) {
        this.logger.error(
          `Workspace upstream failed requestId=${requestId} error=${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
      return fail(503, 'SERVICE_UNAVAILABLE', 'Workspace service unavailable');
    } finally {
      abortHandle.cleanup();
    }
  }
}
