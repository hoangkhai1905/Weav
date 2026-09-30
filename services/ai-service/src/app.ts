import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AiDeps } from './ai-deps';
import { AiModule } from './ai.module';
import { AiError } from './domain/errors';
import { parseStrictJson } from './domain/json/strict-json';
import { AiExceptionFilter } from './presentation/http/ai-exception.filter';
import './presentation/http/request-signal';

const BODY_LIMIT = 256 * 1024;

export async function createAiApp(
  deps: AiDeps,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AiModule.register(deps),
    new FastifyAdapter({ bodyLimit: BODY_LIMIT }),
    { bodyParser: false, logger: new ConsoleLogger({ json: true }) },
  );
  const fastify = app.getHttpAdapter().getInstance();

  // The deadline starts before body parsing (spec §5); a client disconnect aborts the same signal.
  fastify.addHook('onRequest', async (request, reply) => {
    const disconnect = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) disconnect.abort();
    });
    request.aiSignal = AbortSignal.any([
      AbortSignal.timeout(deps.config.AI_REQUEST_TIMEOUT_MS),
      disconnect.signal,
    ]);
  });

  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: BODY_LIMIT },
    (_request, body, done) => {
      try {
        done(null, parseStrictJson(body as Buffer, 64));
      } catch (error) {
        done(
          error instanceof AiError ? error : new AiError('INVALID_REQUEST'),
          undefined,
        );
      }
    },
  );

  app.useGlobalFilters(new AiExceptionFilter());
  app.enableShutdownHooks();
  await app.init();
  return app;
}
