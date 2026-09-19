import { z } from 'zod';

const DEFAULT_LOCAL_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
] as const;

const DEFAULT_UPSTREAMS = {
  identity: 'http://identity-service:8080',
  workspace: 'http://workspace-service:8080',
  workflow: 'http://workflow-service:8080',
  ai: 'http://ai-service:3000',
  bot: 'http://bot-service:3000',
  notification: 'http://notification-service:3000',
  ocr: 'http://ocr-service:8000',
} as const;

const appEnvironmentSchema = z.enum(['development', 'test', 'production']);

const booleanEnvironmentSchema = z.preprocess((value) => {
  if (value === undefined) {
    return false;
  }
  if (value === true || value === false) {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}, z.boolean());

const positiveIntegerEnvironmentSchema = (defaultValue: number) =>
  z.preprocess(
    (value) => (value === undefined ? defaultValue : value),
    z.coerce.number().int().positive().max(1_000_000),
  );

const upstreamUrlSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
      const hasCredentials = url.username !== '' || url.password !== '';
      const hasQueryOrFragment = url.search !== '' || url.hash !== '';

      if (
        !isHttp ||
        url.hostname === '' ||
        hasCredentials ||
        hasQueryOrFragment
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'must be an absolute HTTP(S) URL without credentials, query, or fragment',
        });
      }
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'must be an absolute HTTP(S) URL',
      });
    }
  });

const clockSkewSchema = z.preprocess((value) => {
  if (value === undefined) {
    return 30;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value !== 'string') {
    return value;
  }

  const match = /^(\d+)(ms|s|m|h)$/.exec(value.trim());
  if (!match) {
    return value;
  }

  const amount = Number(match[1]);
  let multiplier: number;
  switch (match[2]) {
    case 'ms':
      multiplier = 1 / 1000;
      break;
    case 's':
      multiplier = 1;
      break;
    case 'm':
      multiplier = 60;
      break;
    case 'h':
      multiplier = 60 * 60;
      break;
    default:
      return value;
  }

  return amount * multiplier;
}, z.number().finite().min(0).max(300));

const environmentSchema = z.object({
  APP_ENV: appEnvironmentSchema.default('development'),
  PORT: z.preprocess(
    (value) => (value === undefined ? 3000 : value),
    z.coerce.number().int().min(1).max(65_535),
  ),
  JWT_ACCESS_SECRET: z.string().superRefine((value, context) => {
    if (Buffer.byteLength(value, 'utf8') < 32) {
      context.addIssue({
        code: 'custom',
        message: 'must contain at least 32 UTF-8 bytes',
      });
    }
  }),
  JWT_ISSUER: z.string().trim().min(1).default('weav-identity'),
  JWT_AUDIENCE: z.string().trim().min(1).default('weav-api'),
  JWT_CLOCK_SKEW: clockSkewSchema,
  IDENTITY_SERVICE_URL: upstreamUrlSchema.default(DEFAULT_UPSTREAMS.identity),
  WORKSPACE_SERVICE_URL: upstreamUrlSchema.default(DEFAULT_UPSTREAMS.workspace),
  WORKFLOW_SERVICE_URL: upstreamUrlSchema.default(DEFAULT_UPSTREAMS.workflow),
  AI_SERVICE_URL: upstreamUrlSchema.default(DEFAULT_UPSTREAMS.ai),
  BOT_SERVICE_URL: upstreamUrlSchema.default(DEFAULT_UPSTREAMS.bot),
  NOTIFICATION_SERVICE_URL: upstreamUrlSchema.default(
    DEFAULT_UPSTREAMS.notification,
  ),
  OCR_SERVICE_URL: upstreamUrlSchema.default(DEFAULT_UPSTREAMS.ocr),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  OCR_ALLOW_UNAUTHENTICATED_DEV: booleanEnvironmentSchema,
  GATEWAY_GENERAL_RATE_LIMIT: positiveIntegerEnvironmentSchema(120),
  GATEWAY_AUTH_RATE_LIMIT: positiveIntegerEnvironmentSchema(10),
  GATEWAY_OCR_RATE_LIMIT: positiveIntegerEnvironmentSchema(10),
  GATEWAY_RATE_LIMIT_WINDOW_MS: positiveIntegerEnvironmentSchema(60_000),
});

export interface GatewayConfig {
  appEnv: 'development' | 'test' | 'production';
  port: number;
  upstreams: {
    identity: string;
    workspace: string;
    workflow: string;
    ai: string;
    bot: string;
    notification: string;
    ocr: string;
  };
  jwt: {
    accessSecret: string;
    issuer: string;
    audience: string;
    clockSkewSeconds: number;
  };
  cors: {
    allowedOrigins: string[];
    credentials: false;
  };
  limits: {
    generalPerMinute: number;
    authPerMinute: number;
    ocrPerMinute: number;
    windowMs: number;
  };
  ocr: {
    allowUnauthenticatedDev: boolean;
  };
}

function configurationError(variableNames: string[]): Error {
  const names = [...new Set(variableNames)].sort().join(', ');
  return new Error(`Invalid gateway configuration: ${names}`);
}

function validateCorsOrigins(
  value: string | undefined,
  appEnv: GatewayConfig['appEnv'],
): string[] {
  if (appEnv === 'production' && value === undefined) {
    throw configurationError(['CORS_ALLOWED_ORIGINS']);
  }

  const rawOrigins =
    value === undefined ? DEFAULT_LOCAL_ORIGINS.join(',') : value;
  const origins = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (appEnv === 'production' && origins.length === 0) {
    throw configurationError(['CORS_ALLOWED_ORIGINS']);
  }

  const normalizedOrigins: string[] = [];
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
      const isOriginOnly = url.pathname === '' || url.pathname === '/';
      const hasCredentials = url.username !== '' || url.password !== '';
      const hasQueryOrFragment = url.search !== '' || url.hash !== '';

      if (
        !isHttp ||
        url.hostname === '' ||
        !isOriginOnly ||
        hasCredentials ||
        hasQueryOrFragment
      ) {
        throw new Error('unsafe origin');
      }

      normalizedOrigins.push(url.origin);
    } catch {
      throw configurationError(['CORS_ALLOWED_ORIGINS']);
    }
  }

  return normalizedOrigins;
}

function formatValidationErrors(error: z.ZodError): Error {
  const variableNames = error.issues.map((issue) => {
    const [variableName] = issue.path;
    return typeof variableName === 'string' ? variableName : 'environment';
  });

  return configurationError(variableNames);
}

export function validateGatewayEnvironment(
  env: Record<string, unknown>,
): GatewayConfig {
  const effectiveAppEnv =
    env.APP_ENV === undefined
      ? env.NODE_ENV === 'production'
        ? 'production'
        : 'development'
      : env.APP_ENV;

  const parsed = environmentSchema.safeParse({
    ...env,
    APP_ENV: effectiveAppEnv,
  });

  if (!parsed.success) {
    throw formatValidationErrors(parsed.error);
  }

  const isProduction =
    parsed.data.APP_ENV === 'production' || env.NODE_ENV === 'production';
  const appEnv: GatewayConfig['appEnv'] = isProduction
    ? 'production'
    : parsed.data.APP_ENV;

  if (parsed.data.OCR_ALLOW_UNAUTHENTICATED_DEV && appEnv !== 'development') {
    throw configurationError(['OCR_ALLOW_UNAUTHENTICATED_DEV']);
  }

  const corsAllowedOrigins = validateCorsOrigins(
    parsed.data.CORS_ALLOWED_ORIGINS,
    appEnv,
  );

  const jwt = {
    issuer: parsed.data.JWT_ISSUER,
    audience: parsed.data.JWT_AUDIENCE,
    clockSkewSeconds: parsed.data.JWT_CLOCK_SKEW,
  } as GatewayConfig['jwt'];

  Object.defineProperty(jwt, 'accessSecret', {
    configurable: false,
    enumerable: false,
    value: parsed.data.JWT_ACCESS_SECRET,
    writable: false,
  });

  return {
    appEnv,
    port: parsed.data.PORT,
    upstreams: {
      identity: parsed.data.IDENTITY_SERVICE_URL,
      workspace: parsed.data.WORKSPACE_SERVICE_URL,
      workflow: parsed.data.WORKFLOW_SERVICE_URL,
      ai: parsed.data.AI_SERVICE_URL,
      bot: parsed.data.BOT_SERVICE_URL,
      notification: parsed.data.NOTIFICATION_SERVICE_URL,
      ocr: parsed.data.OCR_SERVICE_URL,
    },
    jwt,
    cors: {
      allowedOrigins: corsAllowedOrigins,
      credentials: false,
    },
    limits: {
      generalPerMinute: parsed.data.GATEWAY_GENERAL_RATE_LIMIT,
      authPerMinute: parsed.data.GATEWAY_AUTH_RATE_LIMIT,
      ocrPerMinute: parsed.data.GATEWAY_OCR_RATE_LIMIT,
      windowMs: parsed.data.GATEWAY_RATE_LIMIT_WINDOW_MS,
    },
    ocr: {
      allowUnauthenticatedDev: parsed.data.OCR_ALLOW_UNAUTHENTICATED_DEV,
    },
  };
}
