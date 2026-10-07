import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  AI_PROVIDER: z.literal('deepseek').default('deepseek'),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_MODEL: z.string().min(1).optional(),
  DEEPSEEK_BASE_URL: z.url().default('https://api.deepseek.com'),
  // Reasoning models spend part of this budget on hidden thinking; 4096 ran out mid-generation (finish_reason=length).
  DEEPSEEK_MAX_TOKENS: z.coerce.number().int().min(256).max(8192).default(8192),
  AI_SERVICE_JWKS_FILE: z.string().min(1).optional(),
  AI_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(120_000)
    .default(60_000),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  AI_MAX_CONCURRENCY_PER_WORKSPACE: z.coerce
    .number()
    .int()
    .min(1)
    .max(64)
    .default(2),
  // Assistant spike (spec 2026-10-04 section 3). Off by default: the route then does not exist.
  AI_ASSISTANT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Own concurrency pool so chat streams cannot starve the service-JWT routes.
  AI_ASSISTANT_MAX_CONCURRENT: z.coerce
    .number()
    .int()
    .min(1)
    .max(64)
    .default(4),
  AI_ASSISTANT_MAX_TOKENS: z.coerce
    .number()
    .int()
    .min(64)
    .max(4096)
    .default(1024),
  AI_ASSISTANT_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(600)
    .default(20),
  // Per workspace, per replica, in memory (the per-user limit above is separate).
  AI_ASSISTANT_WORKSPACE_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(6000)
    .default(60),
  // History routes (list, messages, delete) per user per minute, separate from the chat budget.
  AI_ASSISTANT_HISTORY_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(6000)
    .default(120),
  // Daily quota in calls (UTC day), counted in ai_db.
  AI_ASSISTANT_DAILY_USER_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(100_000)
    .default(50),
  AI_ASSISTANT_DAILY_WORKSPACE_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(200),
  // Bounds on the stored history sent to the model each turn.
  AI_ASSISTANT_HISTORY_MESSAGES: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20),
  AI_ASSISTANT_HISTORY_CHARS: z.coerce
    .number()
    .int()
    .min(100)
    .max(200_000)
    .default(24_000),
  // How long cached identity keys may keep verifying after their TTL when the JWKS cannot be refreshed.
  AI_JWKS_MAX_STALE_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(86_400_000)
    .default(3_600_000),
  // The assistant calls workflow-service's public API with the user's own token.
  AI_WORKFLOW_API_URL: z.url().default('http://workflow-service:8080'),
  // workspace-service public API for the list_members tool (user's own token, no emails read).
  AI_WORKSPACE_API_URL: z.url().default('http://workspace-service:8080'),
  // User access tokens: same names/defaults as the gateway. No JWKS URI keeps the assistant unauthenticated (401).
  JWT_JWKS_URI: z.url().optional(),
  JWT_ISSUER: z.string().min(1).default('weav-identity'),
  JWT_AUDIENCE: z.string().min(1).default('weav-api'),
  JWT_CLOCK_SKEW: z
    .string()
    .regex(/^\d{1,3}s?$/)
    .default('30s'),
  // Assistant storage (Neon ai_db, schema ai). All optional: with no DB_HOST the service runs without storage.
  DB_HOST: z.string().min(1).optional(),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DB_NAME: z.string().min(1).optional(),
  DB_USERNAME: z.string().min(1).optional(),
  DB_PASSWORD: z.string().min(1).optional(),
  DB_SSL_MODE: z.enum(['require', 'disable']).default('require'),
  AI_ASSISTANT_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(30),
  AI_ASSISTANT_USAGE_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(90),
});

export type AiConfig = z.infer<typeof schema>;

/** A missing key, model, or JWKS keeps the service up but not ready (spec §5). */
export function loadAiConfig(
  env: Record<string, string | undefined>,
): AiConfig {
  const blankToUndefined = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, v === '' ? undefined : v]),
  );
  return schema.parse(blankToUndefined);
}

/** Names (never values) of the DB variables the enabled assistant needs but that are unset. */
export function missingAssistantDbVars(config: AiConfig): string[] {
  const required = {
    DB_HOST: config.DB_HOST,
    DB_NAME: config.DB_NAME,
    DB_USERNAME: config.DB_USERNAME,
    DB_PASSWORD: config.DB_PASSWORD,
  };
  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}
