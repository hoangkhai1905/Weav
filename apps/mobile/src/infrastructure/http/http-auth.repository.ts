import type {
  AuthRepository,
  AuthSession,
  UserProfile,
  AuthTokens,
} from '../../domain/auth/auth.types';
import axios, { type AxiosRequestConfig } from 'axios';
import { httpClient } from './http-client';
import { useAuthStore } from '../../stores/auth.store';

interface IdentityUser {
  id: string;
  email: string;
  displayName: string | null;
}

interface IdentityTokens {
  accessToken: string;
  refreshToken: string;
  user: IdentityUser;
}

function mapUser(user: IdentityUser): UserProfile {
  if (!user || typeof user.id !== 'string' || typeof user.email !== 'string')
    throw new Error('Invalid Identity response.');
  return {
    id: user.id,
    email: user.email,
    name: user.displayName || user.email,
    avatar: null,
  };
}

function mapSession(data: IdentityTokens): AuthSession {
  if (
    typeof data?.accessToken !== 'string' ||
    typeof data.refreshToken !== 'string'
  )
    throw new Error('Invalid Identity session.');
  return {
    user: mapUser(data.user),
    tokens: { accessToken: data.accessToken, refreshToken: data.refreshToken },
  };
}

async function authRequest<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    return (await httpClient.request<T>(config)).data;
  } catch (error) {
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;
    const messages: Record<number, string> = {
      400: 'Please check your email, password and display name.',
      401: 'Invalid credentials or expired session.',
      409: 'This email is already registered. Please sign in.',
      429: 'Too many attempts. Please try again later.',
    };
    throw {
      code: status === 401 ? 'UNAUTHORIZED' : 'AUTH_ERROR',
      message:
        messages[status ?? 0] ??
        'Sign-in service unavailable. Please try again.',
    };
  }
}

export class HttpAuthRepository implements AuthRepository {
  async login(email: string, password: string): Promise<AuthSession> {
    return mapSession(
      await authRequest<IdentityTokens>({
        method: 'POST',
        url: '/api/auth/login',
        data: { email, password },
      }),
    );
  }

  async register(
    email: string,
    name: string,
    password: string,
  ): Promise<AuthSession> {
    await authRequest<IdentityUser>({
      method: 'POST',
      url: '/api/auth/register',
      data: { email, displayName: name, password },
    });
    // Registration creates no token in Identity; establish a session explicitly.
    try {
      return await this.login(email, password);
    } catch {
      throw new Error('Account created. Please sign in to continue.');
    }
  }

  async logout(): Promise<void> {
    const refreshToken = useAuthStore.getState().tokens?.refreshToken;
    if (refreshToken)
      await authRequest({
        method: 'POST',
        url: '/api/auth/logout',
        data: { refreshToken },
      });
  }

  async getCurrentUser(): Promise<UserProfile | null> {
    try {
      return mapUser(await authRequest<IdentityUser>({ url: '/api/auth/me' }));
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 'UNAUTHORIZED'
      )
        return null;
      throw error;
    }
  }

  async refreshToken(): Promise<AuthTokens> {
    const refreshToken = useAuthStore.getState().tokens?.refreshToken;
    if (!refreshToken) throw new Error('Please sign in again.');
    const session = mapSession(
      await authRequest<IdentityTokens>({
        method: 'POST',
        url: '/api/auth/refresh',
        data: { refreshToken },
      }),
    );
    if (useAuthStore.getState().tokens?.refreshToken === refreshToken)
      useAuthStore.getState().setAuthSession(session.user, session.tokens);
    return session.tokens;
  }
}
