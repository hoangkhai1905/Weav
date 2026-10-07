import { Logger } from '@nestjs/common';
import { createAiApp } from './app';
import { loadAiConfig, missingAssistantDbVars } from './config/ai-config';
import { loadVerifier } from './infrastructure/auth/load-verifier';
import { CircuitBreakerProvider } from './infrastructure/llm/circuit-breaker-provider';
import { UserJwtVerifier } from './infrastructure/auth/user-jwt-verifier';
import { DeepSeekChatProvider } from './infrastructure/llm/deepseek/deepseek-chat-provider';
import { DeepSeekProvider } from './infrastructure/llm/deepseek/deepseek-provider';
import { PrismaConversationStore } from './infrastructure/persistence/prisma-conversation-store';
import { startRetentionPurge } from './infrastructure/persistence/retention-purge';

const PURGE_INTERVAL_MS = 3_600_000;

async function bootstrap() {
  const config = loadAiConfig(process.env);
  const missing = config.AI_ASSISTANT_ENABLED
    ? missingAssistantDbVars(config)
    : [];
  if (missing.length > 0)
    throw new Error(
      `AI_ASSISTANT_ENABLED=true needs the assistant database: set ${missing.join(', ')}.`,
    );
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
  const store = config.AI_ASSISTANT_ENABLED
    ? new PrismaConversationStore({
        host: config.DB_HOST as string,
        port: config.DB_PORT,
        database: config.DB_NAME as string,
        user: config.DB_USERNAME as string,
        password: config.DB_PASSWORD,
        ssl: config.DB_SSL_MODE === 'require',
      })
    : null;
  const stopPurge = store
    ? startRetentionPurge(
        store,
        {
          conversationRetentionDays: config.AI_ASSISTANT_RETENTION_DAYS,
          usageRetentionDays: config.AI_ASSISTANT_USAGE_RETENTION_DAYS,
          intervalMs: PURGE_INTERVAL_MS,
        },
        new Logger('RetentionPurge'),
      )
    : null;
  const assistant = config.AI_ASSISTANT_ENABLED
    ? {
        store,
        onShutdown: async () => {
          stopPurge?.();
          await store?.close();
        },
        provider:
          config.DEEPSEEK_API_KEY && config.DEEPSEEK_MODEL
            ? new DeepSeekChatProvider({
                apiKey: config.DEEPSEEK_API_KEY,
                model: config.DEEPSEEK_MODEL,
                baseUrl: config.DEEPSEEK_BASE_URL,
                maxResponseBytes: 1024 * 1024,
              })
            : null,
        verifier: config.JWT_JWKS_URI
          ? new UserJwtVerifier({
              jwksUri: config.JWT_JWKS_URI,
              issuer: config.JWT_ISSUER,
              audience: config.JWT_AUDIENCE,
              clockSkewSeconds: parseInt(config.JWT_CLOCK_SKEW, 10),
              maxStaleMs: config.AI_JWKS_MAX_STALE_MS,
            })
          : null,
      }
    : undefined;
  if (assistant?.verifier) {
    void assistant.verifier.check().then((ok) => {
      if (!ok)
        new Logger('bootstrap').warn(
          'Assistant enabled but JWT_JWKS_URI is unreachable or has no RSA keys: user tokens will be rejected. Identity must sign access tokens with JWT_ACCESS_ALG=RS256.',
        );
    });
  }
  const app = await createAiApp({ config, provider, verifier, assistant });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

void bootstrap();
