import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 65536 }),
  );

  const port = Number(process.env.PORT ?? 3000);
  app.enableShutdownHooks();

  await app.listen({
    port,
    host: '0.0.0.0',
  });
}

void bootstrap().catch(() => {
  Logger.error('Notification service startup failed');
  process.exitCode = 1;
});
