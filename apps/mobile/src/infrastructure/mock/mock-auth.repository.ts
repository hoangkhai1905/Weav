import type {
  AuthRepository,
  AuthSession,
  UserProfile,
  AuthTokens,
  PasswordResetReceipt,
  PasswordResetVerification,
} from '../../domain/auth/auth.types';
import { MOCK_USER } from './mock-data';

const delay = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockAuthRepository implements AuthRepository {
  async login(email: string, _password: string): Promise<AuthSession> {
    await delay(400);
    const user: UserProfile = {
      ...MOCK_USER,
      email: email || MOCK_USER.email,
    };
    const tokens: AuthTokens = {
      accessToken: 'mock_access_token_' + Date.now(),
      refreshToken: 'mock_refresh_token_' + Date.now(),
    };
    return { user, tokens };
  }

  async register(email: string, name: string, _password: string): Promise<AuthSession> {
    await delay(450);
    const user: UserProfile = {
      id: 'user-' + Date.now(),
      email,
      name: name || 'New User',
      avatar: null,
    };
    const tokens: AuthTokens = {
      accessToken: 'mock_access_token_' + Date.now(),
      refreshToken: 'mock_refresh_token_' + Date.now(),
    };
    return { user, tokens };
  }

  async logout(_refreshToken?: string): Promise<void> {
    await delay(200);
  }

  async getCurrentUser(): Promise<UserProfile | null> {
    await delay(200);
    return MOCK_USER;
  }

  async updateCurrentUser(displayName: string | null): Promise<UserProfile> {
    await delay(250);
    return {
      ...MOCK_USER,
      name: displayName?.trim() || MOCK_USER.email,
    };
  }

  async changePassword(_currentPassword: string, _newPassword: string): Promise<void> {
    await delay(250);
  }

  async requestPasswordReset(_email: string): Promise<PasswordResetReceipt> {
    await delay(250);
    return {
      challengeId: 'M'.repeat(43),
      expiresIn: 300,
      retryAfter: 60,
    };
  }

  async verifyPasswordResetOtp(
    _challengeId: string,
    _code: string,
  ): Promise<PasswordResetVerification> {
    await delay(250);
    return {
      purpose: 'PASSWORD_RESET',
      resetToken: 'R'.repeat(43),
      expiresIn: 300,
    };
  }

  async resetPassword(_resetToken: string, _newPassword: string): Promise<void> {
    await delay(250);
  }

  async listSessions(page = 0, size = 20) {
    await delay(200);
    return {
      items: [{
        id: '11111111-1111-4111-8111-111111111111',
        createdAt: '2026-01-01T00:00:00Z',
        lastUsedAt: '2026-01-01T00:00:00Z',
        expiresAt: '2026-12-31T00:00:00Z',
        current: true,
        userAgent: 'Weav Mock Client',
      }],
      page,
      size,
      totalItems: 1,
      totalPages: 1,
    };
  }

  async revokeSession(_sessionId: string): Promise<void> {
    await delay(250);
  }

  async revokeAllSessions(): Promise<void> {
    await delay(250);
  }

  async refreshToken(): Promise<AuthTokens> {
    await delay(300);
    return {
      accessToken: 'mock_access_token_refreshed_' + Date.now(),
      refreshToken: 'mock_refresh_token_refreshed_' + Date.now(),
    };
  }

  async restoreSession(refreshToken: string): Promise<AuthSession> {
    await delay(300);
    return {
      user: MOCK_USER,
      tokens: {
        accessToken: 'mock_access_token_restored_' + Date.now(),
        refreshToken,
      },
    };
  }
}
