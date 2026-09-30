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
