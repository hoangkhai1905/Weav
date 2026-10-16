import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GatewayConfig } from '../config/gateway.config';
import {
  collectSafeUpstreamResponseHeaders,
  createUpstreamAbortHandle,
  isWriteTimeout,
  getRequestId,
  setResponseRequestId,
  type RequestContextCarrier,
} from '../common/request-context';
import {
  buildUpstreamHeaders,
  createProxyFail,
  failOutcomeUnknown,
  logUpstreamFailure,
  readBearerAuthorization,
  startUpstreamCall,
} from '../common/upstream-proxy';
import { MAX_UPSTREAM_JSON_BYTES } from '../common/read-capped';

type WorkspaceMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface WorkspaceForwardOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean>;
  /** Upstream deadline; defaults to 10 s. Workspace delete waits for the Workflow Service to pause workflows. */
  timeoutMs?: number;
}

// Returns null (and cancels the body) when the upstream exceeds the size cap.
async function readUpstreamResponseBody(
  response: Response,
  signal: AbortSignal,
  maxBytes = MAX_UPSTREAM_JSON_BYTES,
): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
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
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return null;
        }
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

    const fail = createProxyFail(context, reply, requestId);

    const authorization = readBearerAuthorization(request.headers);
    if (!authorization) {
      return fail(401, 'UNAUTHORIZED', 'Bearer token required');
    }

    const headers = buildUpstreamHeaders(request, requestId, {
      authorization,
      clientMethod: method,
    });

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
    const abortHandle = createUpstreamAbortHandle(
      context,
      reply,
      options.timeoutMs ?? 10_000,
    );
    const call = startUpstreamCall(context, 'workspace', requestId);

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

      let responseText: string | null;
      try {
        responseText = await readUpstreamResponseBody(
          response,
          abortHandle.signal,
        );
      } catch (error) {
        if (abortHandle.signal.aborted) {
          throw error;
        }
        logUpstreamFailure(this.logger, call, 'Workspace response read failed');
        return fail(
          503,
          'SERVICE_UNAVAILABLE',
          'Workspace service unavailable',
        );
      }

      if (abortHandle.signal.aborted) {
        throw new Error('Workspace upstream request aborted after body read');
      }
      if (responseText === null) {
        return fail(502, 'BAD_GATEWAY', 'Invalid Workspace response');
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
      if (isWriteTimeout(abortHandle, method)) {
        return failOutcomeUnknown(fail);
      }
      if (!abortHandle.signal.aborted) {
        logUpstreamFailure(
          this.logger,
          call,
          'Workspace upstream failed',
          error instanceof Error ? error.message : 'unknown',
        );
      }
      return fail(503, 'SERVICE_UNAVAILABLE', 'Workspace service unavailable');
    } finally {
      abortHandle.cleanup();
    }
  }
}
