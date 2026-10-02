import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  AccessTokenService,
  type AccessPrincipal,
} from './access-token.service';
import {
  AUTH_POLICY,
  OCR_DEVELOPMENT_AUTH,
  type RouteAuthPolicy,
} from './auth-policy.decorator';
import type { GatewayConfig } from '../config/gateway.config';

export interface AuthenticatedRequest {
  headers: Record<string, unknown>;
  principal?: AccessPrincipal;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy =
      this.reflector.getAllAndOverride<RouteAuthPolicy>(AUTH_POLICY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'required';
    if (policy === 'public') return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const supplied = Object.entries(request.headers).filter(
      ([name]) => name.toLowerCase() === 'authorization',
    );
    if (supplied.length === 0) {
      const gateway = this.config.getOrThrow<GatewayConfig>('gateway');
      const ocrBypass =
        this.reflector.get<boolean>(
          OCR_DEVELOPMENT_AUTH,
          context.getHandler(),
        ) === true &&
        gateway.appEnv === 'development' &&
        gateway.ocr.allowUnauthenticatedDev;
      if (policy === 'optional' || ocrBypass) return true;
      throw new UnauthorizedException('Bearer token required');
    }
    const authorization = supplied[0][1];
    if (
      supplied.length !== 1 ||
      typeof authorization !== 'string' ||
      authorization.length > 8192
    ) {
      throw new UnauthorizedException('Invalid access token');
    }
    const match = /^Bearer (\S+)$/i.exec(authorization);
    if (!match) throw new UnauthorizedException('Invalid access token');
    const principal = await this.tokens.verify(match[1]);
    Object.defineProperty(request, 'principal', {
      value: principal,
      enumerable: false,
      configurable: true,
    });
    return true;
  }
}
