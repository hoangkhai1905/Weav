import { createAiApp } from './app';
import { loadAiConfig } from './config/ai-config';
import { loadVerifier } from './infrastructure/auth/load-verifier';
import { CircuitBreakerProvider } from './infrastructure/llm/circuit-breaker-provider';
import { DeepSeekProvider } from './infrastructure/llm/deepseek/deepseek-provider';

async function bootstrap() {
  const config = loadAiConfig(process.env);
  const provider =
    config.DEEPSEEK_API_KEY && config.DEEPSEEK_MODEL
      ? new CircuitBreakerProvider(
          new DeepSeekProvider({
            apiKey: config.DEEPSEEK_API_KEY,
            model: config.DEEPSEEK_MODEL,
            baseUrl: config.DEEPSEEK_BASE_URL,
            maxTokens: config.DEEPSEEK_MAX_TOKENS,
            maxResponseBytes: 1024 * 1024,
          }),
        )
      : null;
  const verifier = loadVerifier(config.AI_SERVICE_JWKS_FILE);
  const app = await createAiApp({ config, provider, verifier });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

void bootstrap();
