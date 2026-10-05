import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  AI_PROVIDER: z.literal('deepseek').default('deepseek'),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_MODEL: z.string().min(1).optional(),
  DEEPSEEK_BASE_URL: z.url().default('https://api.deepseek.com'),
  DEEPSEEK_MAX_TOKENS: z.coerce.number().int().min(256).max(8192).default(4096),
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
  // The assistant calls workflow-service's public API with the user's own token.
  AI_WORKFLOW_API_URL: z.url().default('http://workflow-service:8080'),
  // User access tokens: same names/defaults as the gateway. No JWKS URI keeps the assistant unauthenticated (401).
  JWT_JWKS_URI: z.url().optional(),
  JWT_ISSUER: z.string().min(1).default('weav-identity'),
  JWT_AUDIENCE: z.string().min(1).default('weav-api'),
  JWT_CLOCK_SKEW: z
    .string()
    .regex(/^\d{1,3}s?$/)
    .default('30s'),
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
