import axios, { type AxiosRequestConfig } from 'axios';
import type { ApiError } from '../../domain/common/error.types';
import { useAuthStore } from '../../stores/auth.store';
import { expirePersistedAuthSession } from '../auth/auth-session.persistence';
import { httpClient, normalizeApiError } from './http-client';

/**
 * Sends one authenticated gateway request and maps the JSON body. A 401 expires the
 * current auth session (only if the token that failed is still the active one).
 * Errors are always thrown as a normalized ApiError. Never logs tokens.
 */
export async function requestGateway<R>(
  config: AxiosRequestConfig,
  map: (data: unknown) => R,
): Promise<R> {
  const token = useAuthStore.getState().tokens?.accessToken ?? null;
  try {
    const response = await httpClient.request<unknown>({
      ...config,
      ...(token ? { headers: { ...config.headers, Authorization: `Bearer ${token}` } } : {}),
    });
    return map(response.data);
  } catch (error) {
    if (axios.isCancel(error)) throw { code: 'CANCELED', message: 'Request canceled.' } satisfies ApiError;
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401 && useAuthStore.getState().tokens?.accessToken === token) {
        void expirePersistedAuthSession();
      }
      throw normalizeApiError(error);
    }
    // A mapper rejected the body: the gateway answered, but not with the documented shape.
    if (error instanceof Error && error.message.startsWith('Invalid response')) {
      throw { code: 'INVALID_RESPONSE', message: error.message } satisfies ApiError;
    }
    throw normalizeApiError(error);
  }
}

/** 504 `UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN` or a client-side timeout: the write may or may not have happened. */
export function isUnknownOutcomeTimeout(error: unknown): boolean {
  const e = error as Partial<ApiError> | null;
  return (
    !!e &&
    (e.status === 504 ||
      e.code === 'UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN' ||
      e.code === 'ECONNABORTED' ||
      e.code === 'ETIMEDOUT')
  );
}
