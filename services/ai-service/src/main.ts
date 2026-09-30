import { readFileSync } from 'node:fs';
import { createAiApp } from './app';
import { loadAiConfig } from './config/ai-config';
import { ServiceJwtVerifier } from './infrastructure/auth/service-jwt-verifier';
import { DeepSeekProvider } from './infrastructure/llm/deepseek/deepseek-provider';

async function bootstrap() {
  const config = loadAiConfig(process.env);
  const provider =
    config.DEEPSEEK_API_KEY && config.DEEPSEEK_MODEL
      ? new DeepSeekProvider({
          apiKey: config.DEEPSEEK_API_KEY,
          model: config.DEEPSEEK_MODEL,
          baseUrl: config.DEEPSEEK_BASE_URL,
          maxTokens: config.DEEPSEEK_MAX_TOKENS,
          maxResponseBytes: 1024 * 1024,
        })
      : null;
  let verifier: ServiceJwtVerifier | null = null;
  if (config.AI_SERVICE_JWKS_FILE) {
    try {
      verifier = ServiceJwtVerifier.fromJwks(
        readFileSync(config.AI_SERVICE_JWKS_FILE, 'utf8'),
      );
    } catch {
      verifier = null; // readiness stays 503; the file path and contents are never logged
    }
  }
  const app = await createAiApp({ config, provider, verifier });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

void bootstrap();
