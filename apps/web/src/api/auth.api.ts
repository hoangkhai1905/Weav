import {
  delay,
  getStorage,
  setStorage,
  STORAGE_KEYS,
  MOCK_USER,
} from './client';
import axios, { type AxiosRequestConfig } from 'axios';
import { getStoredAuthToken } from './ocr.api';
import type { UserProfile } from '../types/workflow.types';

export const isAuthMockMode = import.meta.env.VITE_API_MODE === 'mock';

interface IdentityUser {
  id: string;
  email: string;
  displayName: string | null;
}

interface IdentitySession {
  accessToken: string;
  refreshToken: string;
  user: IdentityUser;
}

// Core Identity JSON transport: never persist refresh credentials in browser storage.
let sessionRefreshToken: string | null = null;
const identityClient = axios.create({
  baseURL: (
    import.meta.env.VITE_API_GATEWAY_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, ''),
  timeout: 10000,
});

class AuthApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    const messages: Record<number, string> = {
      400: 'Please check your email, password and display name.',
      401: 'Invalid credentials or expired session.',
      409: 'This email is already registered. Please sign in.',
      429: 'Too many attempts. Please try again later.',
    };
    super(messages[status] ?? 'Sign-in service unavailable. Please try again.');
    this.status = status;
  }
}

async function identityRequest<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    return (await identityClient.request<T>(config)).data;
  } catch (error) {
    // No raw Axios errors: they contain passwords and authorization headers.
    throw new AuthApiError(
      axios.isAxiosError(error) ? (error.response?.status ?? 0) : 0,
    );
  }
}

function mapIdentityUser(user: IdentityUser): UserProfile {
  if (!user || typeof user.id !== 'string' || typeof user.email !== 'string')
    throw new AuthApiError(502);
  return {
    id: user.id,
    email: user.email,
    name: user.displayName || user.email,
    avatar: null,
  };
}

export const authApi = {
  async login(
    _email: string,
    _password?: string,
  ): Promise<{ user: UserProfile; accessToken: string }> {
    if (!isAuthMockMode) {
      const session = await identityRequest<IdentitySession>({
        method: 'POST',
        url: '/api/auth/login',
        data: { email: _email, password: _password },
      });
      if (
        typeof session?.accessToken !== 'string' ||
        typeof session.refreshToken !== 'string'
      )
        throw new AuthApiError(502);
      const user = mapIdentityUser(session.user);
      localStorage.setItem('weav_token', session.accessToken);
      sessionRefreshToken = session.refreshToken;
      return { user, accessToken: session.accessToken };
    }
    void _email;
    void _password;
    await delay(300);
    const user = getStorage<UserProfile>(STORAGE_KEYS.USER, MOCK_USER);
    const session = {
      user,
      accessToken: 'mock-access-token-' + Date.now(),
      refreshToken: 'mock-refresh-token-' + Date.now(),
    };
    localStorage.setItem('weav_token', session.accessToken);
    return session;
  },

  async register(
    email: string,
    name: string,
    password?: string,
  ): Promise<{ user: UserProfile; accessToken: string }> {
    if (!isAuthMockMode) {
      await identityRequest<IdentityUser>({
        method: 'POST',
        url: '/api/auth/register',
        data: { email, displayName: name, password },
      });
      try {
        return await authApi.login(email, password);
      } catch {
        throw new Error('Account created. Please sign in to continue.');
      }
    }
    await delay(300);
    const newUser: UserProfile = {
      id: 'user-' + Date.now(),
      email,
      name,
      avatar: null,
    };
    setStorage(STORAGE_KEYS.USER, newUser);
    const session = {
      user: newUser,
      accessToken: 'mock-access-token-' + Date.now(),
    };
    localStorage.setItem('weav_token', session.accessToken);
    return session;
  },

  async getCurrentUser(): Promise<UserProfile | null> {
    if (!isAuthMockMode) {
      const token = getStoredAuthToken();
      if (!token) return null;
      try {
        return mapIdentityUser(
          await identityRequest<IdentityUser>({
            url: '/api/auth/me',
            headers: { Authorization: `Bearer ${token}` },
          }),
        );
      } catch (error) {
        if (error instanceof AuthApiError && error.status === 401) return null;
        throw error;
      }
    }
    await delay(100);
    const token = localStorage.getItem('weav_token');
    if (!token) return null;
    return getStorage<UserProfile>(STORAGE_KEYS.USER, MOCK_USER);
  },

  async logout(): Promise<void> {
    const refreshToken = sessionRefreshToken;
    sessionRefreshToken = null;
    localStorage.removeItem('weav_token');
    if (!isAuthMockMode && refreshToken) {
      await identityRequest({
        method: 'POST',
        url: '/api/auth/logout',
        data: { refreshToken },
      });
    }
  },
};
