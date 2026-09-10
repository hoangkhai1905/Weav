import { z } from 'zod';

const flag = (fallback: string) =>
  z
    .enum(['true', 'false'])
    .default(fallback as 'true' | 'false')
    .transform((v) => v === 'true');
const integer = (value: number, min = 1, max = 2147483647) =>
  z.coerce.number().int().min(min).max(max).default(value);
const schema = z
  .object({
    PORT: integer(3000, 1, 65535),
    DB_HOST: z.string().min(1),
    DB_PORT: integer(5432, 1, 65535),
    DB_NAME: z.string().min(1),
    DB_USERNAME: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_SCHEMA: z.literal('notification').default('notification'),
    DB_SSL_MODE: z.enum(['require', 'disable']).default('require'),
    JWT_ACCESS_SECRET: z.string().refine((s) => Buffer.byteLength(s) >= 32),
    JWT_ISSUER: z.string().default('weav-identity'),
    JWT_AUDIENCE: z.string().default('weav-api'),
    RABBITMQ_HOST: z.string().default('localhost'),
    RABBITMQ_PORT: integer(5672, 1, 65535),
    RABBITMQ_USERNAME: z.string().default('guest'),
    RABBITMQ_PASSWORD: z.string().default('guest'),
    RABBITMQ_VHOST: z.string().default('/'),
    RABBITMQ_TLS: flag('false'),
    NOTIFICATION_EXCHANGE: z.string().min(1).default('weav.events'),
    NOTIFICATION_QUEUE: z
      .string()
      .min(1)
      .default('notification-service.execution-events'),
    NOTIFICATION_DLQ: z
      .string()
      .min(1)
      .default('notification-service.execution-events.dlq'),
    NOTIFICATION_MAX_ATTEMPTS: integer(5, 1, 20),
    NOTIFICATION_RETRY_BASE_MS: integer(1000),
    NOTIFICATION_RETRY_MAX_MS: integer(300000),
    NOTIFICATION_POLL_MS: integer(1000),
    NOTIFICATION_LEASE_MS: integer(60000),
    NOTIFICATION_TIMEOUT_MS: integer(10000, 100, 30000),
    NOTIFICATION_TELEGRAM_ENABLED: flag('false'),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    NOTIFICATION_EXPO_ENABLED: flag('false'),
    EXPO_ACCESS_TOKEN: z.string().optional(),
    NOTIFICATION_DETAIL_BASE_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.url().optional(),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.NOTIFICATION_TELEGRAM_ENABLED && !v.TELEGRAM_BOT_TOKEN)
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_BOT_TOKEN'],
        message: 'Required when enabled',
      });
    if (v.NOTIFICATION_LEASE_MS < v.NOTIFICATION_TIMEOUT_MS * 3)
      ctx.addIssue({
        code: 'custom',
        path: ['NOTIFICATION_LEASE_MS'],
        message: 'Must exceed three provider timeouts',
      });
    if (v.NOTIFICATION_DETAIL_BASE_URL) {
      const url = new URL(v.NOTIFICATION_DETAIL_BASE_URL);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        ctx.addIssue({
          code: 'custom',
          path: ['NOTIFICATION_DETAIL_BASE_URL'],
          message: 'Use HTTPS without credentials, query or fragment',
        });
    }
  });
export type Settings = z.infer<typeof schema>;
export const SETTINGS = Symbol('NOTIFICATION_SETTINGS');
export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid notification configuration: ${[...new Set(result.error.issues.map((i) => i.path.join('.')))].join(', ')}`,
    );
  return result.data;
}
export function databaseOptions(s: Settings) {
  return {
    host: s.DB_HOST,
    port: s.DB_PORT,
    database: s.DB_NAME,
    user: s.DB_USERNAME,
    password: s.DB_PASSWORD,
    ssl: s.DB_SSL_MODE === 'require' ? { rejectUnauthorized: true } : false,
    max: 3,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  };
}
