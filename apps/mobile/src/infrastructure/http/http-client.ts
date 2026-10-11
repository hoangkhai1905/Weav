import axios from 'axios';
import type { ApiError } from '../../domain/common/error.types';

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export const httpClient = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

let authToken: string | null = null;

export const setHttpClientToken = (token: string | null) => {
  authToken = token;
};

// Public auth routes: login, register, refresh, logout (body token) and the OAuth exchange.
const PUBLIC_AUTH_URL = /\/api\/auth\/(login|register|refresh|logout|oauth\/)/;

// Never attach the access token to public auth routes: Identity rejects an expired bearer even
// there, and the gateway turns that into a 502, so the refresh after 15 minutes always failed.
httpClient.interceptors.request.use((config) => {
  if (authToken && !config.headers?.Authorization && !PUBLIC_AUTH_URL.test(config.url ?? '')) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

/** Given the access token that got a 401, returns a usable token (refreshing at most once) or null. */
type UnauthorizedHandler = (failedToken: string) => Promise<string | null>;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Registered by the auth runtime; kept as a setter to avoid an import cycle with the repositories. */
export const setUnauthorizedHandler = (handler: UnauthorizedHandler | null) => {
  unauthorizedHandler = handler;
};

// Auth routes answer 401 for bad credentials or a dead refresh token: never refresh-and-retry them.
// Access tokens live 15 minutes: without this, the first 401 after that signed the user out.
httpClient.interceptors.response.use(undefined, async (error: unknown) => {
  if (!axios.isAxiosError(error) || error.response?.status !== 401 || !error.config || !unauthorizedHandler) throw error;
  const config = error.config as typeof error.config & { _authRetried?: boolean };
  const header = String(config.headers?.Authorization ?? '');
  if (config._authRetried || !header.startsWith('Bearer ') || PUBLIC_AUTH_URL.test(config.url ?? '')) throw error;
  let token: string | null;
  try {
    token = await unauthorizedHandler(header.slice('Bearer '.length));
  } catch (refreshError) {
    // A passing failure (offline, gateway or Identity restarting) keeps the session: report it as 503
    // so the screen offers "try again". A rejected refresh token already ended the session: keep the 401.
    if (!isTransientRefreshFailure(refreshError)) throw error;
    throw new axios.AxiosError('Session refresh unavailable.', 'ERR_BAD_RESPONSE', config, error.request, {
      ...error.response,
      status: 503,
      statusText: 'Service Unavailable',
      data: { code: 'SESSION_REFRESH_UNAVAILABLE', message: 'Session refresh unavailable.' },
    });
  }
  if (!token) throw error;
  config._authRetried = true;
  config.headers.Authorization = `Bearer ${token}`;
  return httpClient.request(config);
});

/** No HTTP status (network) or a 429/5xx answer: the refresh may succeed on the next request. */
function isTransientRefreshFailure(error: unknown): boolean {
  const { status, code } = (error ?? {}) as { status?: unknown; code?: unknown };
  // The session could not be saved on the device: the coordinator already signed out.
  if (typeof code === 'string' && code.startsWith('AUTH_STORAGE')) return false;
  return status === undefined || status === 429 || (typeof status === 'number' && status >= 500);
}

type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!isRecord(headers)) return undefined;

  const get = headers.get;
  if (typeof get === 'function') {
    const value = get.call(headers, name);
    const normalized = stringValue(value);
    if (normalized) return normalized;
  }

  const lowerName = name.toLowerCase();
  return stringValue(headers[name]) ?? stringValue(headers[lowerName]);
}

function codeForStatus(status: number | undefined): string | undefined {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'TOO_MANY_REQUESTS';
  if (status === 502) return 'BAD_GATEWAY';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  return undefined;
}

export const normalizeApiError = (error: unknown): ApiError => {
  if (axios.isAxiosError(error)) {
    const response = error.response;
    const payload = response?.data;
    const body = isRecord(payload) ? payload : undefined;
    const nested = body && isRecord(body.error) ? body.error : undefined;
    const status = response?.status ?? numberValue(body?.status);
    const details = Array.isArray(nested?.details)
      ? nested.details
      : Array.isArray(body?.details)
        ? body.details
        : undefined;
    const requestId =
      stringValue(body?.requestId) ??
      headerValue(response?.headers, 'x-request-id') ??
      headerValue(response?.headers, 'x-correlation-id');

    return {
      code:
        stringValue(nested?.code) ??
        stringValue(body?.code) ??
        codeForStatus(status) ??
        error.code ??
        'INTERNAL_ERROR',
      message:
        stringValue(nested?.message) ??
        stringValue(body?.message) ??
        error.message ??
        'An unexpected network error occurred.',
      ...(details ? { details } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }
  if (error instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      message: error.message,
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'An unknown error occurred.',
  };
};
