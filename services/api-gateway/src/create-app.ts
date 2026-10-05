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
} from './common/request-context';

export async function createApp(): Promise<NestFastifyApplication> {
  const config = validateGatewayEnvironment(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: config.trustProxyHops > 0 ? config.trustProxyHops : false,
    }),
  );

  app.useGlobalFilters(new GatewayExceptionFilter());

  const fastify = app.getHttpAdapter().getInstance();
  // Reject oversized assistant bodies while reading, before they are buffered (zod bounds still apply).
  fastify.addHook('onRoute', (route) => {
    if (route.url === '/api/v1/assistant/chat' && route.method === 'POST') {
      route.bodyLimit = 262_144;
    }
  });
  fastify.addHook('onRequest', (request, reply, done) => {
    const requestId = resolveRequestId(request.headers);
    attachRequestContext(request, requestId);
    setResponseRequestId(reply, requestId);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
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
      'Idempotency-Key',
      'Traceparent',
      'X-Correlation-ID',
      'X-Request-ID',
    ],
    exposedHeaders: ['X-Correlation-ID', 'X-Request-ID', 'Retry-After'],
    credentials: config.cors.credentials,
  });

  return app;
}
