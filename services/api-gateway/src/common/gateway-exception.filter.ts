import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import {
  getRequestId,
  setResponseRequestId,
  type RequestContextCarrier,
} from './request-context';

export interface GatewayErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown[];
  };
  requestId: string;
}

interface GatewayReply {
  sent?: boolean;
  code(status: number): GatewayReply;
  header(name: string, value: string): unknown;
  send(body: GatewayErrorBody): unknown;
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
};

function codeForStatus(status: number): string {
  return (
    STATUS_CODES[status] ??
    (status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'HTTP_ERROR')
  );
}

function defaultMessageForStatus(status: number): string {
  if (status >= 500) {
    return 'Internal server error';
  }
  return 'Request failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeException(exception: unknown): {
  status: number;
  error: GatewayErrorBody['error'];
} {
  if (!(exception instanceof HttpException)) {
    return {
      status: 500,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
        details: [],
      },
    };
  }

  const status = exception.getStatus();
  const response = exception.getResponse();
  if (status >= 500) {
    return {
      status,
      error: {
        code: codeForStatus(status),
        message: 'Internal server error',
        details: [],
      },
    };
  }

  if (isRecord(response) && isRecord(response.error)) {
    const structured = response.error;
    const code =
      typeof structured.code === 'string' &&
      /^[A-Z0-9_:-]{1,64}$/.test(structured.code)
        ? structured.code
        : codeForStatus(status);
    const message =
      typeof structured.message === 'string' && structured.message.length <= 512
        ? structured.message
        : defaultMessageForStatus(status);
    const details = Array.isArray(structured.details) ? structured.details : [];
    return { status, error: { code, message, details } };
  }

  const message =
    typeof response === 'string'
      ? response
      : isRecord(response) && typeof response.message === 'string'
        ? response.message
        : defaultMessageForStatus(status);
  const details =
    isRecord(response) && Array.isArray(response.message)
      ? response.message
      : [];

  return {
    status,
    error: {
      code: codeForStatus(status),
      message:
        message.length <= 512 ? message : defaultMessageForStatus(status),
      details,
    },
  };
}

@Catch()
export class GatewayExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GatewayExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestContextCarrier>();
    const reply = http.getResponse<GatewayReply>();

    if (reply.sent) {
      return;
    }

    const requestId = getRequestId(request);
    const normalized = normalizeException(exception);
    this.logger.error(
      `Gateway exception ${normalized.error.code} status=${normalized.status} requestId=${requestId}`,
    );
    setResponseRequestId(reply, requestId);
    reply.code(normalized.status).send({
      error: normalized.error,
      requestId,
    });
  }
}
