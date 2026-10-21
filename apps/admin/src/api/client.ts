import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { clearSession, getAccessToken, getProfile, getRefreshToken, setSession } from '../lib/session';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type ErrorBody = { message?: string; code?: string };

const baseURL = import.meta.env.VITE_API_GATEWAY_URL ?? 'http://localhost:3000';

export const api = axios.create({ baseURL });

const isAuthUrl = (url?: string) => !!url && url.startsWith('/api/auth/');

const toApiError = (error: AxiosError<ErrorBody>): ApiError =>
  new ApiError(error.response?.status ?? 0, error.response?.data?.message ?? error.message, error.response?.data?.code);

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

let refreshing: Promise<string> | null = null;

/** One shared refresh for every request that fails at the same time. Uses bare axios so it skips these interceptors. */
function refreshAccessToken(): Promise<string> {
  refreshing ??= (async () => {
    const refreshToken = getRefreshToken();
    const profile = getProfile();
    if (!refreshToken || !profile) throw new ApiError(401, 'No refresh token');
    const { data } = await axios.post(`${baseURL}/api/auth/refresh`, { refreshToken });
    setSession(data.accessToken, data.refreshToken, profile);
    return data.accessToken as string;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

type Retryable = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(undefined, async (error: AxiosError<ErrorBody>) => {
  const original = error.config as Retryable | undefined;
  if (error.response?.status === 401 && original && !original._retried && !isAuthUrl(original.url)) {
    original._retried = true;
    try {
      original.headers.set('Authorization', `Bearer ${await refreshAccessToken()}`);
    } catch {
      clearSession();
      window.location.assign('/login');
      throw toApiError(error);
    }
    return api(original);
  }
  throw toApiError(error);
});
