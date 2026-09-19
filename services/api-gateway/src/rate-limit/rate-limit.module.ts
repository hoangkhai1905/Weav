import { Module, type ExecutionContext } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import type { GatewayConfig } from '../config/gateway.config';
import {
  GatewayThrottlerGuard,
  isOcrRateLimitEligible,
  isOcrRequest,
  isOperationalRequest,
  isPublicAuthMutation,
  type GatewayRateLimitRequest,
} from './gateway-throttler.guard';

function requestFromContext(context: {
  switchToHttp(): { getRequest<T>(): T };
}): GatewayRateLimitRequest {
  return context.switchToHttp().getRequest<GatewayRateLimitRequest>();
}

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const gateway = config.getOrThrow<GatewayConfig>('gateway');
        const skipOperational = (context: ExecutionContext) =>
          isOperationalRequest(requestFromContext(context));
        const skipAuth = (context: ExecutionContext) => {
          const request = requestFromContext(context);
          return skipOperational(context) || !isPublicAuthMutation(request);
        };
        const skipOcr = (context: ExecutionContext) => {
          const request = requestFromContext(context);
          return (
            skipOperational(context) ||
            !isOcrRequest(request) ||
            !isOcrRateLimitEligible(request, gateway)
          );
        };

        return {
          throttlers: [
            {
              name: 'general',
              limit: gateway.limits.generalPerMinute,
              ttl: gateway.limits.windowMs,
              blockDuration: gateway.limits.windowMs,
              skipIf: skipOperational,
            },
            {
              name: 'auth',
              limit: gateway.limits.authPerMinute,
              ttl: gateway.limits.windowMs,
              blockDuration: gateway.limits.windowMs,
              skipIf: skipAuth,
            },
            {
              name: 'ocr',
              limit: gateway.limits.ocrPerMinute,
              ttl: gateway.limits.windowMs,
              blockDuration: gateway.limits.windowMs,
              skipIf: skipOcr,
            },
          ],
          errorMessage: 'Rate limit exceeded',
          setHeaders: true,
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: GatewayThrottlerGuard }],
})
export class RateLimitModule {}
