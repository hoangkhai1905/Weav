import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateGatewayEnvironment } from './config/gateway.config';
import { OcrModule } from './ocr/ocr.module';
import { NotificationsModule } from './notifications/notifications.module';
import { IdentityModule } from './identity/identity.module';
import { AuthModule } from './auth/auth.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { HealthModule } from './health/health.module';
import { WorkflowModule } from './workflow/workflow.module';

function loadGatewayConfiguration(): Record<string, unknown> {
  const gateway = validateGatewayEnvironment(process.env);

  return {
    gateway,
    APP_ENV: gateway.appEnv,
    PORT: String(gateway.port),
    IDENTITY_SERVICE_URL: gateway.upstreams.identity,
    WORKSPACE_SERVICE_URL: gateway.upstreams.workspace,
    WORKFLOW_SERVICE_URL: gateway.upstreams.workflow,
    AI_SERVICE_URL: gateway.upstreams.ai,
    BOT_SERVICE_URL: gateway.upstreams.bot,
    NOTIFICATION_SERVICE_URL: gateway.upstreams.notification,
    OCR_SERVICE_URL: gateway.upstreams.ocr,
    JWT_ISSUER: gateway.jwt.issuer,
    JWT_AUDIENCE: gateway.jwt.audience,
    JWT_CLOCK_SKEW: `${gateway.jwt.clockSkewSeconds}s`,
    CORS_ALLOWED_ORIGINS: gateway.cors.allowedOrigins.join(','),
    OCR_ALLOW_UNAUTHENTICATED_DEV: String(gateway.ocr.allowUnauthenticatedDev),
    GATEWAY_GENERAL_RATE_LIMIT: String(gateway.limits.generalPerMinute),
    GATEWAY_AUTH_RATE_LIMIT: String(gateway.limits.authPerMinute),
    GATEWAY_OCR_RATE_LIMIT: String(gateway.limits.ocrPerMinute),
    GATEWAY_RATE_LIMIT_WINDOW_MS: String(gateway.limits.windowMs),
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [loadGatewayConfiguration] }),
    AuthModule,
    RateLimitModule,
    HealthModule,
    OcrModule,
    NotificationsModule,
    IdentityModule,
    WorkspaceModule,
    WorkflowModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
