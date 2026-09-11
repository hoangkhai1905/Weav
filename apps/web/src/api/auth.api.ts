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

export interface IdentityUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarStorageKey?: string | null;
  systemRole?: 'USER' | 'ADMIN';
  status?: 'ACTIVE' | 'DISABLED';
  createdAt?: string;
  updatedAt?: string;
  emailVerifiedAt?: string | null;
}

interface IdentitySession {
  accessToken: string;
  refreshToken: string;
  user: IdentityUser;
  refreshExpiresAt?: string;
}

interface GoogleOAuthStartResponse {
  transactionId: string;
  authorizationUrl: string;
  csrfToken: string;
}

interface GoogleOAuthExchangeResponse {
  outcome: 'LOGIN';
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: IdentityUser;
}

interface PendingGoogleOAuth {
  transactionId: string;
  codeVerifier: string;
  csrfToken: string;
  createdAt: number;
  intent?: 'LOGIN' | 'LINK';
}

export interface IdentitySessionView {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
  userAgent: string | null;
}

export interface OAuthAccountMetadata {
  id: string;
  provider: string;
  providerEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OAuthSessionPage {
  items: IdentitySessionView[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

interface OtpReceipt {
  challengeId: string;
  expiresIn: number;
  retryAfter: number;
}

export interface GoogleOAuthCallback {
  transactionId: string;
  handoffCode: string;
  error?: string;
}

const GOOGLE_OAUTH_PENDING_KEY = 'weav_google_oauth_pending_v1';
const GOOGLE_OAUTH_CSRF_KEY = 'weav_google_oauth_csrf_v1';
const GOOGLE_OAUTH_SESSION_KEY = 'weav_google_oauth_session_v1';

const apiClient = axios.create({
  baseURL: (
    import.meta.env.VITE_API_GATEWAY_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, ''),
  timeout: 10000,
});

const identityClient = axios.create({
  baseURL: (
    import.meta.env.VITE_IDENTITY_SERVICE_URL ||
    'http://localhost:8081'
  ).replace(/\/+$/, ''),
  timeout: 10000,
  withCredentials: true,
});

// Core Identity JSON transport: never persist refresh credentials in browser storage.
let sessionRefreshToken: string | null = null;

class AuthApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    const messages: Record<number, string> = {
      400: 'Please check your email, password and display name.',
      401: 'Invalid credentials or expired session.',
      403: 'Google login was rejected by the identity service.',
      409: 'This email is already registered. Please sign in.',
      429: 'Too many attempts. Please try again later.',
      503: 'Google login is not configured or temporarily unavailable.',
    };
    super(messages[status] ?? 'Sign-in service unavailable. Please try again.');
    this.status = status;
  }
}

async function request<T>(client: typeof apiClient, config: AxiosRequestConfig): Promise<T> {
  try {
    return (await client.request<T>(config)).data;
  } catch (error) {
    // No raw Axios errors: they contain passwords and authorization headers.
    throw new AuthApiError(
      axios.isAxiosError(error) ? (error.response?.status ?? 0) : 0,
    );
  }
}

function authRequest<T>(config: AxiosRequestConfig): Promise<T> {
  return request(apiClient, config);
}

function accessTokenOrThrow(): string {
  const token = getStoredAuthToken();
  if (!token) throw new AuthApiError(401);
  return token;
}

function authenticatedAuthRequest<T>(config: AxiosRequestConfig): Promise<T> {
  return authRequest<T>({
    ...config,
    headers: {
      ...(config.headers ?? {}),
      Authorization: `Bearer ${accessTokenOrThrow()}`,
    },
  });
}

function authenticatedOAuthRequest<T>(config: AxiosRequestConfig): Promise<T> {
  return oauthRequest<T>({
    ...config,
    headers: {
      ...(config.headers ?? {}),
      Authorization: `Bearer ${accessTokenOrThrow()}`,
    },
  });
}

function oauthRequest<T>(config: AxiosRequestConfig): Promise<T> {
  return request(identityClient, { ...config, withCredentials: true });
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return encodeBase64Url(new Uint8Array(digest));
}

function readPendingGoogleOAuth(): PendingGoogleOAuth | null {
  try {
    const raw = sessionStorage.getItem(GOOGLE_OAUTH_PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingGoogleOAuth>;
    if (
      typeof value.transactionId !== 'string' ||
      typeof value.codeVerifier !== 'string' ||
      typeof value.csrfToken !== 'string' ||
      typeof value.createdAt !== 'number' ||
      Date.now() - value.createdAt > 15 * 60 * 1000
    ) {
      sessionStorage.removeItem(GOOGLE_OAUTH_PENDING_KEY);
      return null;
    }
    return value as PendingGoogleOAuth;
  } catch {
    sessionStorage.removeItem(GOOGLE_OAUTH_PENDING_KEY);
    return null;
  }
}

function saveGoogleOAuthCsrf(csrfToken: string): void {
  sessionStorage.setItem(GOOGLE_OAUTH_CSRF_KEY, csrfToken);
}

function readGoogleOAuthCsrf(): string | null {
  return sessionStorage.getItem(GOOGLE_OAUTH_CSRF_KEY);
}

async function ensureGoogleOAuthCsrf(): Promise<string> {
  const existing = readGoogleOAuthCsrf();
  if (existing) return existing;
  const response = await oauthRequest<{ csrfToken: string }>({
    method: 'GET',
    url: '/auth/web/csrf',
  });
  if (typeof response?.csrfToken !== 'string' || response.csrfToken.length < 43) {
    throw new AuthApiError(502);
  }
  saveGoogleOAuthCsrf(response.csrfToken);
  return response.csrfToken;
}

function clearGoogleOAuthState(): void {
  sessionStorage.removeItem(GOOGLE_OAUTH_PENDING_KEY);
  sessionStorage.removeItem(GOOGLE_OAUTH_CSRF_KEY);
  sessionStorage.removeItem(GOOGLE_OAUTH_SESSION_KEY);
}

function mapIdentityUser(user: IdentityUser): UserProfile {
  if (!user || typeof user.id !== 'string' || typeof user.email !== 'string')
    throw new AuthApiError(502);
  return {
    id: user.id,
    email: user.email,
    name: user.displayName?.trim() || user.email,
    avatar: user.avatarStorageKey ?? null,
    displayName: user.displayName,
    systemRole: user.systemRole,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export const authApi = {
  async startGoogleLogin(): Promise<string> {
    if (isAuthMockMode) throw new AuthApiError(400);

    const codeVerifier = createCodeVerifier();
    const response = await oauthRequest<GoogleOAuthStartResponse>({
      method: 'POST',
      url: '/auth/oauth/google/start',
      data: {
        clientId: 'web',
        returnTargetId: 'web',
        codeChallenge: await createCodeChallenge(codeVerifier),
        codeChallengeMethod: 'S256',
      },
    });
    if (
      typeof response?.transactionId !== 'string' ||
      typeof response.authorizationUrl !== 'string' ||
      typeof response.csrfToken !== 'string'
    ) {
      throw new AuthApiError(502);
    }

    sessionStorage.setItem(
      GOOGLE_OAUTH_PENDING_KEY,
      JSON.stringify({
        transactionId: response.transactionId,
        codeVerifier,
        csrfToken: response.csrfToken,
        createdAt: Date.now(),
        intent: 'LOGIN',
      } satisfies PendingGoogleOAuth),
    );
    saveGoogleOAuthCsrf(response.csrfToken);
    window.location.assign(response.authorizationUrl);
    return response.authorizationUrl;
  },

  async completeGoogleLogin(
    callback: GoogleOAuthCallback,
  ): Promise<
    | { outcome: 'LOGIN'; user: UserProfile; accessToken: string }
    | { outcome: 'LINKED' }
  > {
    if (callback.error) {
      clearGoogleOAuthState();
      throw new AuthApiError(400);
    }
    const pending = readPendingGoogleOAuth();
    if (!pending || pending.transactionId !== callback.transactionId) {
      clearGoogleOAuthState();
      throw new AuthApiError(400);
    }

    const intent = pending.intent ?? 'LOGIN';
    const session = await oauthRequest<
      GoogleOAuthExchangeResponse | { outcome: 'LINKED'; oauthAccount: OAuthAccountMetadata }
    >({
      method: 'POST',
      url: '/auth/oauth/exchange',
      headers: {
        'X-XSRF-TOKEN': pending.csrfToken,
        ...(intent === 'LINK'
          ? { Authorization: `Bearer ${accessTokenOrThrow()}` }
          : {}),
      },
      data: {
        clientId: 'web',
        returnTargetId: 'web',
        transactionId: pending.transactionId,
        handoffCode: callback.handoffCode,
        codeVerifier: pending.codeVerifier,
      },
    });
    if (intent === 'LINK') {
      if (session?.outcome !== 'LINKED') throw new AuthApiError(502);
      sessionStorage.removeItem(GOOGLE_OAUTH_PENDING_KEY);
      return { outcome: 'LINKED' };
    }

    if (
      session?.outcome !== 'LOGIN' ||
      typeof session.accessToken !== 'string' ||
      typeof session.user !== 'object'
    ) throw new AuthApiError(502);

    const user = mapIdentityUser(session.user);
    localStorage.setItem('weav_token', session.accessToken);
    sessionStorage.setItem(GOOGLE_OAUTH_SESSION_KEY, '1');
    saveGoogleOAuthCsrf(pending.csrfToken);
    sessionStorage.removeItem(GOOGLE_OAUTH_PENDING_KEY);
    sessionRefreshToken = null;
    return { outcome: 'LOGIN', user, accessToken: session.accessToken };
  },

  async startGoogleLink(currentPassword: string): Promise<string> {
    if (isAuthMockMode) throw new AuthApiError(400);
    const codeVerifier = createCodeVerifier();
    const csrfToken = await ensureGoogleOAuthCsrf();
    const response = await authenticatedOAuthRequest<GoogleOAuthStartResponse>({
      method: 'POST',
      url: '/users/me/oauth/google/link',
      headers: { 'X-XSRF-TOKEN': csrfToken },
      data: {
        currentPassword,
        clientId: 'web',
        returnTargetId: 'web',
        codeChallenge: await createCodeChallenge(codeVerifier),
        codeChallengeMethod: 'S256',
      },
    });
    if (
      typeof response?.transactionId !== 'string' ||
      typeof response.authorizationUrl !== 'string' ||
      typeof response.csrfToken !== 'string'
    ) throw new AuthApiError(502);
    sessionStorage.setItem(
      GOOGLE_OAUTH_PENDING_KEY,
      JSON.stringify({
        transactionId: response.transactionId,
        codeVerifier,
        csrfToken: response.csrfToken,
        createdAt: Date.now(),
        intent: 'LINK',
      } satisfies PendingGoogleOAuth),
    );
    saveGoogleOAuthCsrf(response.csrfToken);
    window.location.assign(response.authorizationUrl);
    return response.authorizationUrl;
  },

  async refreshGoogleSession(): Promise<{ user: UserProfile; accessToken: string }> {
    const csrfToken = await ensureGoogleOAuthCsrf();
    const session = await oauthRequest<GoogleOAuthExchangeResponse>({
      method: 'POST',
      url: '/auth/web/refresh',
      headers: { 'X-XSRF-TOKEN': csrfToken },
    });
    if (
      session?.outcome !== 'LOGIN' ||
      typeof session.accessToken !== 'string' ||
      typeof session.user !== 'object'
    ) {
      throw new AuthApiError(502);
    }
    const user = mapIdentityUser(session.user);
    localStorage.setItem('weav_token', session.accessToken);
    sessionStorage.setItem(GOOGLE_OAUTH_SESSION_KEY, '1');
    return { user, accessToken: session.accessToken };
  },

  async refreshSession(): Promise<{ user: UserProfile; accessToken: string }> {
    if (isAuthMockMode || !sessionRefreshToken) throw new AuthApiError(401);
    const session = await authRequest<IdentitySession>({
      method: 'POST',
      url: '/api/auth/refresh',
      data: { refreshToken: sessionRefreshToken },
    });
    if (
      typeof session?.accessToken !== 'string' ||
      typeof session.refreshToken !== 'string' ||
      typeof session.user !== 'object'
    ) throw new AuthApiError(502);
    const user = mapIdentityUser(session.user);
    sessionRefreshToken = session.refreshToken;
    localStorage.setItem('weav_token', session.accessToken);
    return { user, accessToken: session.accessToken };
  },

  async updateProfile(displayName: string | null): Promise<UserProfile> {
    const user = await authenticatedAuthRequest<IdentityUser>({
      method: 'PATCH',
      url: '/api/auth/me',
      data: { displayName },
    });
    return mapIdentityUser(user);
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await authenticatedAuthRequest<void>({
      method: 'POST',
      url: '/api/auth/change-password',
      data: { currentPassword, newPassword },
    });
  },

  async listSessions(page = 0, size = 20): Promise<OAuthSessionPage> {
    return authenticatedAuthRequest<OAuthSessionPage>({
      method: 'GET',
      url: '/api/auth/sessions',
      params: { page, size },
    });
  },

  async revokeSession(sessionId: string): Promise<void> {
    await authenticatedAuthRequest<void>({
      method: 'DELETE',
      url: `/api/auth/sessions/${encodeURIComponent(sessionId)}`,
    });
  },

  async revokeAllSessions(): Promise<void> {
    await authenticatedAuthRequest<void>({
      method: 'DELETE',
      url: '/api/auth/sessions',
    });
  },

  async requestEmailVerification(): Promise<OtpReceipt> {
    return authenticatedAuthRequest<OtpReceipt>({
      method: 'POST',
      url: '/api/auth/otp/request',
      data: { purpose: 'EMAIL_VERIFICATION' },
    });
  },

  async verifyOtp(challengeId: string, code: string): Promise<{ purpose: string; resetToken?: string }> {
    return authRequest<{ purpose: string; verified?: boolean; resetToken?: string }>({
      method: 'POST',
      url: '/api/auth/otp/verify',
      data: { challengeId, code },
      headers: getStoredAuthToken()
        ? { Authorization: `Bearer ${getStoredAuthToken()}` }
        : undefined,
    });
  },

  async requestPasswordReset(email: string): Promise<OtpReceipt> {
    return authRequest<OtpReceipt>({
      method: 'POST',
      url: '/api/auth/forgot-password',
      data: { email },
    });
  },

  async resetPassword(resetToken: string, newPassword: string): Promise<void> {
    await authRequest<void>({
      method: 'POST',
      url: '/api/auth/reset-password',
      data: { resetToken, newPassword },
    });
  },

  async listOAuthAccounts(): Promise<OAuthAccountMetadata[]> {
    return authenticatedOAuthRequest<OAuthAccountMetadata[]>({
      method: 'GET',
      url: '/users/me/oauth-accounts',
    });
  },

  async unlinkOAuthAccount(accountId: string, currentPassword: string): Promise<void> {
    const csrfToken = await ensureGoogleOAuthCsrf();
    await authenticatedOAuthRequest<void>({
      method: 'DELETE',
      url: `/users/me/oauth-accounts/${encodeURIComponent(accountId)}`,
      headers: { 'X-XSRF-TOKEN': csrfToken },
      data: { currentPassword },
    });
  },

  async login(
    _email: string,
    _password?: string,
  ): Promise<{ user: UserProfile; accessToken: string }> {
    if (!isAuthMockMode) {
      const session = await authRequest<IdentitySession>({
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
      sessionStorage.removeItem(GOOGLE_OAUTH_SESSION_KEY);
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
      await authRequest<IdentityUser>({
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
          await authRequest<IdentityUser>({
            url: '/api/auth/me',
            headers: { Authorization: `Bearer ${token}` },
          }),
        );
      } catch (error) {
        if (
          error instanceof AuthApiError &&
          error.status === 401 &&
          sessionStorage.getItem(GOOGLE_OAUTH_SESSION_KEY) === '1'
        ) {
          try {
            return (await authApi.refreshGoogleSession()).user;
          } catch {
            clearGoogleOAuthState();
            localStorage.removeItem('weav_token');
            return null;
          }
        }
        if (error instanceof AuthApiError && error.status === 401 && sessionRefreshToken) {
          try {
            return (await authApi.refreshSession()).user;
          } catch {
            localStorage.removeItem('weav_token');
            sessionRefreshToken = null;
            return null;
          }
        }
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
    if (!isAuthMockMode && sessionStorage.getItem(GOOGLE_OAUTH_SESSION_KEY) === '1') {
      try {
        const csrfToken = await ensureGoogleOAuthCsrf();
        await oauthRequest({
          method: 'POST',
          url: '/auth/web/logout',
          headers: { 'X-XSRF-TOKEN': csrfToken },
        });
      } catch {
        // Local session cleanup remains authoritative if the remote session is gone.
      } finally {
        clearGoogleOAuthState();
      }
    } else if (!isAuthMockMode && refreshToken) {
      await authRequest({
        method: 'POST',
        url: '/api/auth/logout',
        data: { refreshToken },
      });
    }
  },
};
