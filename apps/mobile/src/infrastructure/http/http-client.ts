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

httpClient.interceptors.request.use((config) => {
  if (authToken && !config.headers?.Authorization) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

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
