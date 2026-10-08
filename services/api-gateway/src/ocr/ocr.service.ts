import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GatewayConfig } from '../config/gateway.config';
import {
  collectSafeUpstreamResponseHeaders,
  createUpstreamAbortHandle,
  getRequestHeader,
  getRequestId,
  isValidTraceparent,
  type RequestContextCarrier,
} from '../common/request-context';

// Forwarded as the x-workspace-id header, so only canonical UUIDs pass.
const WORKSPACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// OCR service caps the document at 10 MiB (MAX_FILE_BYTES); allow multipart
// framing overhead on top so a file at the cap still passes.
export const OCR_MAX_REQUEST_BYTES = 10 * 1024 * 1024 + 64 * 1024;

export interface ProxyExtractionResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

function isReadableStream(val: unknown): boolean {
  if (val === null || typeof val !== 'object') {
    return false;
  }
  const candidate = val as Record<string | symbol, unknown>;
  return (
    typeof candidate['pipe'] === 'function' ||
    typeof candidate[Symbol.asyncIterator] === 'function' ||
    typeof candidate['getReader'] === 'function' ||
    typeof candidate['_read'] === 'function'
  );
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
      const { done, value } = await reader.read();
      if (signal.aborted) {
        throw new Error(
          'OCR upstream request aborted during response body read',
        );
      }
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
      }
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
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject('FETCH_FN')
    private readonly fetchFn?: typeof fetch,
  ) {}

  private get fetch(): typeof fetch {
    return this.fetchFn ?? globalThis.fetch;
  }

  async proxyExtraction(
    workspaceId: string,
    req: {
      headers?: Record<string, unknown>;
      body?: unknown;
      raw?: unknown;
    },
    reply?: { raw?: unknown },
  ): Promise<ProxyExtractionResult> {
    const request = req as RequestContextCarrier;
    const requestId = getRequestId(request);
    const errorHeaders = {
      'content-type': 'application/json; charset=utf-8',
      'x-correlation-id': requestId,
      'x-request-id': requestId,
    };

    const busyResult = (): ProxyExtractionResult => ({
      status: 503,
      data: {
        error: {
          code: 'OCR_BUSY',
          message: 'OCR service is temporarily unavailable',
          retryable: true,
        },
        requestId,
      },
      headers: errorHeaders,
    });

    if (
      !workspaceId ||
      typeof workspaceId !== 'string' ||
      !WORKSPACE_ID_PATTERN.test(workspaceId)
    ) {
      return {
        status: 400,
        data: {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Workspace ID is required',
            retryable: false,
          },
          requestId,
        },
        headers: errorHeaders,
      };
    }

    const gateway = this.configService.get<GatewayConfig>('gateway');
    const appEnv = gateway?.appEnv ?? this.configService.get<string>('APP_ENV');
    const devBypass =
      gateway?.ocr?.allowUnauthenticatedDev ??
      this.configService.get<string | boolean>('OCR_ALLOW_UNAUTHENTICATED_DEV');
    const isDevBypass =
      appEnv === 'development' && (devBypass === 'true' || devBypass === true);

    const authHeader = getRequestHeader(req?.headers, 'authorization');

    if (!isDevBypass) {
      if (
        !authHeader ||
        !authHeader.trim().toLowerCase().startsWith('bearer ') ||
        authHeader.trim().slice(7).trim() === ''
      ) {
        return {
          status: 401,
          data: {
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Bearer authorization token is required',
              retryable: false,
            },
            requestId,
          },
          headers: errorHeaders,
        };
      }
    }

    const forwardHeaders: Record<string, string> = {
      'x-correlation-id': requestId,
      'x-workspace-id': workspaceId,
      'x-request-id': requestId,
    };

    if (authHeader) {
      forwardHeaders['authorization'] = authHeader;
    }

    const traceparent = getRequestHeader(req?.headers, 'traceparent');
    if (isValidTraceparent(traceparent)) {
      forwardHeaders.traceparent = traceparent;
    }

    const contentType = getRequestHeader(req?.headers, 'content-type');
    if (contentType && contentType.trim() !== '') {
      forwardHeaders['content-type'] = contentType.trim();
    }

    const tooLargeResult = (): ProxyExtractionResult => ({
      status: 413,
      data: {
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Upload exceeds the 10 MiB limit',
          retryable: false,
        },
        requestId,
      },
      headers: errorHeaders,
    });
    const declaredLength = Number(
      getRequestHeader(req?.headers, 'content-length'),
    );
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > OCR_MAX_REQUEST_BYTES
    ) {
      return tooLargeResult();
    }

    let body: unknown;
    let duplex: 'half' | undefined;

    if (isReadableStream(req?.body)) {
      body = req.body;
      duplex = 'half';
    } else if (
      contentType?.toLowerCase().includes('multipart/') &&
      isReadableStream(req?.raw)
    ) {
      body = req.raw;
      duplex = 'half';
    } else if (
      typeof req?.body === 'object' &&
      req?.body !== null &&
      !Buffer.isBuffer(req.body)
    ) {
      body = JSON.stringify(req.body);
    } else if (typeof req?.body === 'string' || Buffer.isBuffer(req?.body)) {
      body = req.body;
    } else if (isReadableStream(req?.raw)) {
      body = req.raw;
      duplex = 'half';
    }

    // Chunked uploads carry no Content-Length: count bytes while streaming.
    let tooLarge = false;
    if (
      duplex &&
      typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] ===
        'function'
    ) {
      const source = body as AsyncIterable<Uint8Array>;
      body = (async function* () {
        let total = 0;
        for await (const chunk of source) {
          total += chunk.byteLength;
          if (total > OCR_MAX_REQUEST_BYTES) {
            tooLarge = true;
            throw new Error('upload exceeds gateway limit');
          }
          yield chunk;
        }
      })();
    }

    const ocrBaseUrl = (
      gateway?.upstreams?.ocr ??
      this.configService.get<string>('OCR_SERVICE_URL') ??
      'http://ocr-service:8000'
    ).replace(/\/+$/, '');
    const targetUrl = `${ocrBaseUrl}/v1/extractions`;

    const init: RequestInit & { duplex?: 'half' } = {
      method: 'POST',
      headers: forwardHeaders,
      body: body as BodyInit,
      redirect: 'error',
      signal: undefined,
      ...(duplex ? { duplex } : {}),
    };

    const abortHandle = createUpstreamAbortHandle(
      request,
      reply,
      gateway?.ocr?.timeoutMs ?? 10_000,
    );
    init.signal = abortHandle.signal;
    const diagnosticStart = performance.now();
    const diagnostic = (phase: string) =>
      this.logger.warn({
        phase,
        elapsedMs: Math.round(performance.now() - diagnosticStart),
        aborted: abortHandle.signal.aborted,
      });
    abortHandle.signal.addEventListener('abort', () =>
      diagnostic('deadline-or-disconnect'),
    );

    try {
      const response = await this.fetch(targetUrl, init);
      diagnostic('headers-received');

      const responseHeaders = collectSafeUpstreamResponseHeaders(
        response.headers,
      );
      responseHeaders['x-request-id'] = requestId;
      responseHeaders['x-correlation-id'] = requestId;

      let responseData: unknown;
      if (response.status !== 204) {
        const resContentType = responseHeaders['content-type'] ?? '';
        if (
          response.status >= 400 &&
          !resContentType.toLowerCase().includes('application/json')
        ) {
          try {
            await response.body?.cancel();
          } catch {
            // The upstream connection is already being discarded.
          }
          return busyResult();
        }
        if (resContentType.toLowerCase().includes('application/json')) {
          try {
            const text = await readUpstreamResponseBody(
              response,
              abortHandle.signal,
            );
            responseData = JSON.parse(text) as unknown;
            diagnostic('json-completed');
          } catch (error) {
            diagnostic('json-rejected');
            if (abortHandle.signal.aborted) {
              throw error;
            }
            responseData = null;
          }
        } else {
          const text = await readUpstreamResponseBody(
            response,
            abortHandle.signal,
          );
          try {
            responseData = JSON.parse(text) as unknown;
          } catch {
            responseData = text;
          }
        }
      }

      if (abortHandle.signal.aborted) {
        throw new Error(
          'OCR upstream request aborted during response handling',
        );
      }

      return {
        status: response.status,
        data: responseData,
        headers: responseHeaders,
      };
    } catch {
      if (tooLarge) {
        return tooLargeResult();
      }
      this.logger.error('OCR service upstream connection failed', {
        requestId,
      });
      return busyResult();
    } finally {
      abortHandle.cleanup();
    }
  }
}
