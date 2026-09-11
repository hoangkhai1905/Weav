import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const port = Number(process.env.PORT ?? 3000);

  const localOrigins =
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8081,http://127.0.0.1:8081';
  const allowedOrigins = (
    process.env.CORS_ALLOWED_ORIGINS ??
    (process.env.APP_ENV === 'production' ||
    process.env.NODE_ENV === 'production'
      ? ''
      : localOrigins)
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
  });

  await app.listen({
    port,
    host: '0.0.0.0',
  });
}

bootstrap();
