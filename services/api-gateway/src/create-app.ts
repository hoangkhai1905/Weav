import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { validateGatewayEnvironment } from './config/gateway.config';
import { GatewayExceptionFilter } from './common/gateway-exception.filter';
import {
  attachRequestContext,
  resolveRequestId,
  setResponseRequestId,
  type RequestContextCarrier,
} from './common/request-context';

export async function createApp(): Promise<NestFastifyApplication> {
  const config = validateGatewayEnvironment(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: false }),
  );

  app.useGlobalFilters(new GatewayExceptionFilter());

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (request, reply, done) => {
    const requestId = resolveRequestId(
      request.headers as Record<string, unknown>,
    );
    attachRequestContext(request as RequestContextCarrier, requestId);
    setResponseRequestId(reply, requestId);
    done();
  });

  app.enableCors({
    origin: config.cors.allowedOrigins.length
      ? config.cors.allowedOrigins
      : false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Traceparent',
      'X-Correlation-ID',
      'X-Request-ID',
    ],
    exposedHeaders: ['X-Correlation-ID', 'X-Request-ID', 'Retry-After'],
    credentials: config.cors.credentials,
  });

  return app;
}
