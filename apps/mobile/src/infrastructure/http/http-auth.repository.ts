import type {
  AuthRepository,
  AuthSession,
  UserProfile,
  AuthTokens,
  AuthRepositoryError,
  AuthSessionPage,
  GoogleHandoff,
  PasswordResetReceipt,
  PasswordResetVerification,
} from '../../domain/auth/auth.types';
import axios, { type AxiosRequestConfig } from 'axios';
import { httpClient, normalizeApiError } from './http-client';
import { useAuthStore } from '../../stores/auth.store';
import {
  buildGetCurrentUserRequest,
  buildUpdateCurrentUserRequest,
  mapIdentityUser,
  type IdentityUserResponse,
} from './profile.http.contract';
import {
  assertChangePasswordResponse,
  buildChangePasswordRequest,
  mapChangePasswordError,
} from './password.http.contract';
import {
  assertPasswordRecoveryResponse,
  buildForgotPasswordRequest,
  buildResetPasswordRequest,
  buildVerifyOtpRequest,
  mapPasswordRecoveryError,
  mapPasswordResetReceipt,
  mapPasswordResetVerification,
  type PasswordRecoveryOperation,
} from './password-recovery.http.contract';
import {
  assertSessionMutationResponse,
  buildListSessionsRequest,
  buildRevokeAllSessionsRequest,
  buildRevokeSessionRequest,
  mapSessionError,
  mapSessionPageResponse,
  type GatewaySessionPageResponse,
} from './session.http.contract';
import { expirePersistedAuthSession } from '../auth/auth-session.persistence';

interface IdentityTokens {
  accessToken: string;
  refreshToken: string;
  user: IdentityUserResponse;
}

function mapSession(data: IdentityTokens): AuthSession {
  if (
    typeof data?.accessToken !== 'string' ||
    typeof data.refreshToken !== 'string'
  )
    throw new Error('Invalid Identity session.');
  return {
    user: mapIdentityUser(data.user),
    tokens: { accessToken: data.accessToken, refreshToken: data.refreshToken },
  };
}

function detailsOf(error: unknown): { details?: unknown; requestId?: string } {
  const { details, requestId } = normalizeApiError(error);
  return { ...(details ? { details } : {}), ...(requestId ? { requestId } : {}) };
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
    const authError: AuthRepositoryError = {
      code: status === 401 ? 'UNAUTHORIZED' : 'AUTH_ERROR',
      message:
        messages[status ?? 0] ??
        'Sign-in service unavailable. Please try again.',
      status,
      // Field-level validation messages from the backend (error.details[].field), shown under each input.
      ...(axios.isAxiosError(error) ? detailsOf(error) : {}),
    };
    throw authError;
  }
}

async function profileRequest<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    return (await httpClient.request<T>(config)).data;
  } catch (error) {
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;
    const profileError: AuthRepositoryError = {
      code:
        status === 401
          ? 'UNAUTHORIZED'
          : status === 400
            ? 'VALIDATION_FAILED'
            : 'PROFILE_ERROR',
      message:
        status === 400
          ? 'Display name is invalid. Please check the value and try again.'
          : status === 401
            ? 'Your session has expired. Please sign in again.'
            : 'Profile service unavailable. Please try again.',
      status,
    };
    throw profileError;
  }
}

async function passwordRequest(config: AxiosRequestConfig): Promise<void> {
  try {
    const response = await httpClient.request<void>(config);
    assertChangePasswordResponse(response.status);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      typeof error.code === 'string' &&
      typeof error.message === 'string'
    ) {
      throw error;
    }
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;
    throw mapChangePasswordError(status);
  }
}

async function recoveryRequest<T, R>(
  config: AxiosRequestConfig,
  operation: PasswordRecoveryOperation,
  map: (data: T, status: number) => R,
): Promise<R> {
  try {
    const response = await httpClient.request<T>(config);
    return map(response.data, response.status);
  } catch (error) {
    if (isRepositoryError(error) && !axios.isAxiosError(error)) {
      throw error;
    }
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;
    throw mapPasswordRecoveryError(status, operation);
  }
}

function isRepositoryError(error: unknown): error is AuthRepositoryError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  );
}

async function sessionRequest<T, R>(
  config: AxiosRequestConfig,
  map: (data: T, status: number) => R,
): Promise<R> {
  const token = useAuthStore.getState().tokens?.accessToken ?? null;
  try {
    const response = await httpClient.request<T>({
      ...config,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });
    return map(response.data, response.status);
  } catch (error) {
    if (axios.isCancel(error)) {
      throw { code: 'CANCELED', message: 'Session request canceled.' };
    }
    if (isRepositoryError(error) && !axios.isAxiosError(error)) {
      throw error;
    }
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;
    if (status === 401) {
      if (useAuthStore.getState().tokens?.accessToken === token) {
        void expirePersistedAuthSession();
      }
      throw mapSessionError(status);
    }
    throw mapSessionError(status);
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

  /** Public route: no Authorization header; the body is strict (exactly these three fields). */
  async exchangeGoogleHandoff(handoff: GoogleHandoff): Promise<AuthSession> {
    try {
      const { data } = await httpClient.request<IdentityTokens>({
        method: 'POST',
        url: '/api/auth/oauth/mobile/exchange',
        data: {
          transactionId: handoff.transactionId,
          handoffCode: handoff.handoffCode,
          codeVerifier: handoff.codeVerifier,
        },
      });
      return mapSession(data);
    } catch (error) {
      if (!axios.isAxiosError(error)) throw error;
      // Keep the backend code: 409 ACCOUNT_LINK_REQUIRED and CONFLICT need different copy.
      const { code, status, requestId } = normalizeApiError(error);
      const authError: AuthRepositoryError = {
        code,
        message: 'Google sign-in failed.',
        status,
        ...(requestId ? { requestId } : {}),
      };
      throw authError;
    }
  }

  async register(
    email: string,
    name: string,
    password: string,
  ): Promise<AuthSession> {
    await authRequest<IdentityUserResponse>({
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

  async logout(refreshToken?: string): Promise<void> {
    const token = refreshToken ?? useAuthStore.getState().tokens?.refreshToken;
    if (token)
      await authRequest({
        method: 'POST',
        url: '/api/auth/logout',
        data: { refreshToken: token },
      });
  }

  async restoreSession(refreshToken: string): Promise<AuthSession> {
    return mapSession(
      await authRequest<IdentityTokens>({
        method: 'POST',
        url: '/api/auth/refresh',
        data: { refreshToken },
      }),
    );
  }

  async getCurrentUser(): Promise<UserProfile | null> {
    try {
      return mapIdentityUser(
        await authRequest<IdentityUserResponse>(buildGetCurrentUserRequest()),
      );
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

  async updateCurrentUser(displayName: string | null): Promise<UserProfile> {
    return mapIdentityUser(
      await profileRequest<IdentityUserResponse>(
        buildUpdateCurrentUserRequest(displayName),
      ),
    );
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await passwordRequest(buildChangePasswordRequest(currentPassword, newPassword));
  }

  async requestPasswordReset(email: string): Promise<PasswordResetReceipt> {
    return recoveryRequest<unknown, PasswordResetReceipt>(
      buildForgotPasswordRequest(email),
      'forgot',
      (data, status) => {
        assertPasswordRecoveryResponse(status, 'forgot');
        return mapPasswordResetReceipt(data);
      },
    );
  }

  async verifyPasswordResetOtp(
    challengeId: string,
    code: string,
  ): Promise<PasswordResetVerification> {
    return recoveryRequest<unknown, PasswordResetVerification>(
      buildVerifyOtpRequest(challengeId, code),
      'verify',
      (data, status) => {
        assertPasswordRecoveryResponse(status, 'verify');
        return mapPasswordResetVerification(data);
      },
    );
  }

  async resetPassword(resetToken: string, newPassword: string): Promise<void> {
    await recoveryRequest<unknown, void>(
      buildResetPasswordRequest(resetToken, newPassword),
      'reset',
      (_data, status) => {
        assertPasswordRecoveryResponse(status, 'reset');
      },
    );
  }

  async listSessions(
    page = 0,
    size = 20,
    signal?: AbortSignal,
  ): Promise<AuthSessionPage> {
    return sessionRequest<GatewaySessionPageResponse, AuthSessionPage>(
      buildListSessionsRequest(page, size, signal),
      (data) => mapSessionPageResponse(data),
    );
  }

  async revokeSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    await sessionRequest<unknown, void>(
      buildRevokeSessionRequest(sessionId, signal),
      (_data, status) => {
        assertSessionMutationResponse(status);
      },
    );
  }

  async revokeAllSessions(signal?: AbortSignal): Promise<void> {
    await sessionRequest<unknown, void>(
      buildRevokeAllSessionsRequest(signal),
      (_data, status) => {
        assertSessionMutationResponse(status);
      },
    );
  }

  async refreshToken(): Promise<AuthTokens> {
    const refreshToken = useAuthStore.getState().tokens?.refreshToken;
    if (!refreshToken) throw new Error('Please sign in again.');
    const session = await this.restoreSession(refreshToken);
    if (useAuthStore.getState().tokens?.refreshToken === refreshToken)
      useAuthStore.getState().setAuthSession(session.user, session.tokens);
    return session.tokens;
  }
}
