import { Module, type ExecutionContext } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { AuthModule } from '../auth/auth.module';
import type { GatewayConfig } from '../config/gateway.config';
import { FailOpenThrottlerStorage } from './fail-open-throttler-storage';
import {
  GatewayThrottlerGuard,
  isOcrRateLimitEligible,
  isOcrRequest,
  isOperationalRequest,
  isPublicAuthMutation,
  webhookEndpointKey,
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
            {
              // Per endpoint key, on top of the general per-IP bucket, so one
              // noisy sender cannot exhaust another workflow's webhook budget.
              name: 'webhook',
              limit: gateway.limits.webhookPerMinute,
              ttl: gateway.limits.windowMs,
              blockDuration: gateway.limits.windowMs,
              skipIf: (context: ExecutionContext) =>
                webhookEndpointKey(requestFromContext(context)) === undefined,
              getTracker: (request: GatewayRateLimitRequest) =>
                `endpoint:${webhookEndpointKey(request) ?? 'none'}`,
            },
          ],
          // Shared across replicas when configured; otherwise in-memory.
          ...(gateway.limits.throttlerRedisUrl
            ? {
                storage: new FailOpenThrottlerStorage(
                  new ThrottlerStorageRedisService(
                    gateway.limits.throttlerRedisUrl,
                    { commandTimeout: 500, maxRetriesPerRequest: 1 },
                  ),
                ),
              }
            : {}),
          errorMessage: 'Rate limit exceeded',
          setHeaders: true,
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: GatewayThrottlerGuard }],
})
export class RateLimitModule {}
