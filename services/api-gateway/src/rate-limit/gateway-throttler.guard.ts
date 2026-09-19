import {
  HttpException,
  Injectable,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { AccessTokenService } from '../auth/access-token.service';
import {
  getRequestHeader,
  getRequestId,
  type RequestContextCarrier,
} from '../common/request-context';
import type { GatewayConfig } from '../config/gateway.config';

export const HEALTH_PATHS = new Set(['/health', '/ready']);
const PUBLIC_AUTH_MUTATION_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/otp/request',
  '/api/auth/otp/verify',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
]);

export interface GatewayRateLimitRequest extends RequestContextCarrier {
  ip?: string;
  method?: string;
  url?: string;
  raw?: {
    url?: string;
    socket?: { remoteAddress?: string };
  };
  principal?: { sub: string };
}

export function requestPath(request: GatewayRateLimitRequest): string {
  const rawUrl =
    request.url ??
    (typeof request.raw?.url === 'string' ? request.raw.url : '/');
  try {
    return new URL(rawUrl, 'http://gateway.invalid').pathname;
  } catch {
    return '/';
  }
}

export function isOperationalRequest(
  request: GatewayRateLimitRequest,
): boolean {
  return (
    request.method?.toUpperCase() === 'OPTIONS' ||
    HEALTH_PATHS.has(requestPath(request))
  );
}

export function isOcrRequest(request: GatewayRateLimitRequest): boolean {
  return /^\/api\/v1\/workspaces\/[^/]+\/ocr\/extractions$/.test(
    requestPath(request),
  );
}

export function isPublicAuthMutation(
  request: GatewayRateLimitRequest,
): boolean {
  return (
    request.method?.toUpperCase() === 'POST' &&
    PUBLIC_AUTH_MUTATION_PATHS.has(requestPath(request))
  );
}

function socketAddress(request: GatewayRateLimitRequest): string {
  const rawAddress = request.raw?.socket?.remoteAddress;
  if (typeof rawAddress === 'string' && rawAddress.length > 0) {
    return rawAddress;
  }
  if (typeof request.ip === 'string' && request.ip.length > 0) {
    return request.ip;
  }
  return 'unknown';
}

function authorizationToken(
  request: GatewayRateLimitRequest,
): string | undefined {
  const authorization = getRequestHeader(request.headers, 'authorization');
  const match = authorization && /^Bearer (\S+)$/i.exec(authorization);
  return match?.[1];
}

export function isOcrRateLimitEligible(
  request: GatewayRateLimitRequest,
  gateway: GatewayConfig,
): boolean {
  if (request.principal?.sub) {
    return true;
  }
  const hasAuthorization =
    getRequestHeader(request.headers, 'authorization') !== undefined;
  return (
    !hasAuthorization &&
    gateway.appEnv === 'development' &&
    gateway.ocr.allowUnauthenticatedDev
  );
}

@Injectable()
export class GatewayThrottlerGuard extends ThrottlerGuard {
  private readonly gateway: GatewayConfig;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService,
    private readonly accessTokens: AccessTokenService,
  ) {
    super(options, storage, reflector);
    this.gateway = config.getOrThrow<GatewayConfig>('gateway');
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<GatewayRateLimitRequest>();
    if (isOperationalRequest(request)) {
      return true;
    }

    if (isOcrRequest(request) && !request.principal?.sub) {
      const token = authorizationToken(request);
      if (token) {
        try {
          const principal = await this.accessTokens.verify(token);
          Object.defineProperty(request, 'principal', {
            configurable: true,
            enumerable: false,
            value: principal,
          });
        } catch {
          // Let the required access-token guard reject the request. The OCR
          // policy is skipped until a verified principal exists.
        }
      }
    }

    return false;
  }

  protected getTracker(request: GatewayRateLimitRequest): Promise<string> {
    if (isOcrRequest(request) && request.principal?.sub) {
      return Promise.resolve(`subject:${request.principal.sub}`);
    }
    return Promise.resolve(`ip:${socketAddress(request)}`);
  }

  protected generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    // Do not include the controller or handler: the general bucket is one
    // socket-IP budget across every public route.
    return `gateway:${name}:${tracker}`;
  }

  protected throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest<RequestContextCarrier>();
    const response = context
      .switchToHttp()
      .getResponse<{ header(name: string, value: string): unknown }>();
    response.header(
      'Retry-After',
      String(Math.max(1, detail.timeToBlockExpire)),
    );
    const requestId = getRequestId(request);
    throw new HttpException(
      {
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Rate limit exceeded',
          details: [],
        },
        requestId,
      },
      429,
    );
  }
}
