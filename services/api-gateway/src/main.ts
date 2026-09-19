import { validateGatewayEnvironment } from './config/gateway.config';
import { createApp } from './create-app';

async function bootstrap() {
  const app = await createApp();
  const { port } = validateGatewayEnvironment(process.env);

  await app.listen({
    port,
    host: '0.0.0.0',
  });
}

bootstrap();
