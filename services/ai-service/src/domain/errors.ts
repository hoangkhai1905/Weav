export const AI_ERROR_STATUS = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  PAYLOAD_TOO_LARGE: 413,
  AI_SCHEMA_INVALID: 422,
  AI_BUSY: 429,
  AI_NOT_CONFIGURED: 503,
  AI_PROVIDER_UNAVAILABLE: 503,
  AI_PROVIDER_AUTH: 502,
  AI_OUTPUT_INVALID: 502,
  AI_TIMEOUT: 504,
  INTERNAL_ERROR: 500,
} as const;

export type AiErrorCode = keyof typeof AI_ERROR_STATUS;

const MESSAGES: Record<AiErrorCode, string> = {
  INVALID_REQUEST: 'The request is invalid.',
  UNAUTHENTICATED: 'Service authentication is required.',
  FORBIDDEN: 'The service token does not permit this request.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  AI_SCHEMA_INVALID: 'The output schema is not supported.',
  AI_BUSY: 'The AI service is busy. Try again shortly.',
  AI_NOT_CONFIGURED: 'The AI service is not configured.',
  AI_PROVIDER_UNAVAILABLE: 'The AI provider is temporarily unavailable.',
  AI_PROVIDER_AUTH: 'The AI provider rejected the service credentials.',
  AI_OUTPUT_INVALID: 'The AI provider returned an invalid result.',
  AI_TIMEOUT: 'The AI request timed out.',
  INTERNAL_ERROR: 'The AI service failed unexpectedly.',
};

export class AiError extends Error {
  constructor(readonly code: AiErrorCode) {
    super(MESSAGES[code]);
    this.name = 'AiError';
  }

  get status(): number {
    return AI_ERROR_STATUS[this.code];
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
