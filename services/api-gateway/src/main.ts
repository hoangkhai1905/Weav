import { Logger } from '@nestjs/common';
import { validateGatewayEnvironment } from './config/gateway.config';
import { createApp } from './create-app';

async function bootstrap() {
  const app = await createApp();
  const { port } = validateGatewayEnvironment(process.env);

  // Let SIGTERM drain in-flight proxied requests instead of killing them.
  app.enableShutdownHooks();
  await app.listen({
    port,
    host: '0.0.0.0',
  });
}

bootstrap().catch((error: unknown) => {
  // Configuration errors name variables only, never their values.
  new Logger('Bootstrap').error(
    `Gateway startup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
