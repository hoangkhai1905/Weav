import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

export interface ProxyExtractionResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

function toHeaderString(val: unknown): string | undefined {
  if (typeof val === 'string') {
    return val;
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }
  if (Array.isArray(val) && val.length > 0) {
    const first: unknown = val[0];
    if (typeof first === 'string') {
      return first;
    }
    if (typeof first === 'number' || typeof first === 'boolean') {
      return String(first);
    }
  }
  return undefined;
}

function getHeader(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const direct = headers[name];
  if (direct !== undefined && direct !== null) {
    const parsed = toHeaderString(direct);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && val !== undefined && val !== null) {
      const parsed = toHeaderString(val);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }
  return undefined;
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
  ): Promise<ProxyExtractionResult> {
    const incomingRequestId = getHeader(req?.headers, 'x-request-id');
    const requestId =
      incomingRequestId && incomingRequestId.trim() !== ''
        ? incomingRequestId.trim()
        : randomUUID();

    if (
      !workspaceId ||
      typeof workspaceId !== 'string' ||
      workspaceId.trim() === ''
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
        headers: { 'x-request-id': requestId },
      };
    }

    const appEnv = this.configService.get<string>('APP_ENV');
    const devBypass = this.configService.get<string | boolean>(
      'OCR_ALLOW_UNAUTHENTICATED_DEV',
    );
    const isDevBypass =
      appEnv === 'development' && (devBypass === 'true' || devBypass === true);

    const authHeader = getHeader(req?.headers, 'authorization');

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
          headers: { 'x-request-id': requestId },
        };
      }
    }

    const forwardHeaders: Record<string, string> = {
      'x-workspace-id': workspaceId,
      'x-request-id': requestId,
    };

    if (authHeader) {
      forwardHeaders['authorization'] = authHeader;
    }

    const traceparent = getHeader(req?.headers, 'traceparent');
    if (traceparent && traceparent.trim() !== '') {
      forwardHeaders['traceparent'] = traceparent.trim();
    }

    const contentType = getHeader(req?.headers, 'content-type');
    if (contentType && contentType.trim() !== '') {
      forwardHeaders['content-type'] = contentType.trim();
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

    const ocrBaseUrl = (
      this.configService.get<string>('OCR_SERVICE_URL') ||
      'http://ocr-service:8000'
    ).replace(/\/+$/, '');
    const targetUrl = `${ocrBaseUrl}/v1/extractions`;

    const init: RequestInit & { duplex?: 'half' } = {
      method: 'POST',
      headers: forwardHeaders,
      body: body as BodyInit,
      ...(duplex ? { duplex } : {}),
    };

    let response: Response;
    try {
      response = await this.fetch(targetUrl, init);
    } catch {
      this.logger.error('OCR service upstream connection failed', {
        requestId,
      });
      return {
        status: 503,
        data: {
          error: {
            code: 'OCR_BUSY',
            message: 'OCR service is temporarily unavailable',
            retryable: true,
          },
          requestId,
        },
        headers: { 'x-request-id': requestId },
      };
    }

    const responseHeaders: Record<string, string> = {};
    if (response.headers && typeof response.headers.forEach === 'function') {
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });
    }
    if (!responseHeaders['x-request-id']) {
      responseHeaders['x-request-id'] = requestId;
    }

    let responseData: unknown;
    const resContentType = responseHeaders['content-type'] ?? '';
    if (resContentType.includes('application/json')) {
      try {
        responseData = (await response.json()) as unknown;
      } catch {
        responseData = null;
      }
    } else {
      const text = await response.text();
      try {
        responseData = JSON.parse(text) as unknown;
      } catch {
        responseData = text;
      }
    }

    return {
      status: response.status,
      data: responseData,
      headers: responseHeaders,
    };
  }
}
