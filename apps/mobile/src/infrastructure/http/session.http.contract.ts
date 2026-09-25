import type {
  AuthRepositoryError,
  AuthSessionPage,
  AuthSessionSummary,
} from '../../domain/auth/auth.types';

export const SESSIONS_PATH = '/api/auth/sessions';

export interface GatewaySessionResponse {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
  userAgent: string | null;
}

export interface GatewaySessionPageResponse {
  items: GatewaySessionResponse[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

function withSignal<T extends Record<string, unknown>>(config: T, signal?: AbortSignal): T & { signal?: AbortSignal } {
  return signal ? { ...config, signal } : config;
}

export function buildListSessionsRequest(page: number, size: number, signal?: AbortSignal) {
  return withSignal({
    method: 'GET' as const,
    url: SESSIONS_PATH,
    params: { page, size },
  }, signal);
}

export function buildRevokeSessionRequest(sessionId: string, signal?: AbortSignal) {
  return withSignal({
    method: 'DELETE' as const,
    url: `${SESSIONS_PATH}/${encodeURIComponent(sessionId)}`,
  }, signal);
}

export function buildRevokeAllSessionsRequest(signal?: AbortSignal) {
  return withSignal({
    method: 'DELETE' as const,
    url: SESSIONS_PATH,
  }, signal);
}

function isSessionResponse(value: unknown): value is GatewaySessionResponse {
  if (typeof value !== 'object' || value === null) return false;
  if (!('id' in value) || typeof value.id !== 'string' || value.id.length === 0) return false;
  if (!('createdAt' in value) || typeof value.createdAt !== 'string') return false;
  if (!('lastUsedAt' in value) || (value.lastUsedAt !== null && typeof value.lastUsedAt !== 'string')) return false;
  if (!('expiresAt' in value) || typeof value.expiresAt !== 'string') return false;
  if (!('current' in value) || typeof value.current !== 'boolean') return false;
  return 'userAgent' in value && (value.userAgent === null || typeof value.userAgent === 'string');
}

function isSessionPageResponse(value: unknown): value is GatewaySessionPageResponse {
  if (typeof value !== 'object' || value === null) return false;
  if (!('items' in value) || !Array.isArray(value.items) || !value.items.every(isSessionResponse)) return false;
  if (!('page' in value) || typeof value.page !== 'number' || !Number.isInteger(value.page) || value.page < 0) return false;
  if (!('size' in value) || typeof value.size !== 'number' || !Number.isInteger(value.size) || value.size < 1 || value.size > 100) return false;
  if (!('totalItems' in value) || typeof value.totalItems !== 'number' || !Number.isSafeInteger(value.totalItems) || value.totalItems < 0) return false;
  return 'totalPages' in value && typeof value.totalPages === 'number' && Number.isInteger(value.totalPages) && value.totalPages >= 0;
}

export function mapSessionPageResponse(data: unknown): AuthSessionPage {
  if (!isSessionPageResponse(data)) {
    throw { code: 'INVALID_RESPONSE', message: 'Invalid session list response.' };
  }

  const items: AuthSessionSummary[] = data.items.map((session) => ({
    id: session.id,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.expiresAt,
    current: session.current,
    userAgent: session.userAgent,
  }));

  return {
    items,
    page: data.page,
    size: data.size,
    totalItems: data.totalItems,
    totalPages: data.totalPages,
  };
}

export function assertSessionMutationResponse(status: number): void {
  if (status !== 204) throw mapSessionError(status);
}

export function mapSessionError(status?: number): AuthRepositoryError {
  if (status === 400) {
    return {
      code: 'VALIDATION_FAILED',
      message: 'The session request is invalid. Please try again.',
      status,
    };
  }
  if (status === 401) {
    return {
      code: 'UNAUTHORIZED',
      message: 'Your session has expired. Please sign in again.',
      status,
    };
  }
  if (status === 403) {
    return {
      code: 'FORBIDDEN',
      message: 'You are not allowed to manage these sessions.',
      status,
    };
  }
  if (status === 404) {
    return {
      code: 'NOT_FOUND',
      message: 'That session is no longer available. Refresh the list.',
      status,
    };
  }
  return {
    code: 'SESSION_ERROR',
    message: 'Unable to manage sessions. Please try again.',
    ...(status === undefined ? {} : { status }),
  };
}
