import axios, { type AxiosError } from 'axios';
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
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

export const normalizeApiError = (error: unknown): ApiError => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ code?: string; message?: string }>;
    return {
      code: axiosError.response?.data?.code || axiosError.code || 'INTERNAL_ERROR',
      message: axiosError.response?.data?.message || axiosError.message || 'An unexpected network error occurred.',
      details: axiosError.response?.data,
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
