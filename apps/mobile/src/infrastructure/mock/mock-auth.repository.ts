import type { AuthRepository, AuthSession, UserProfile, AuthTokens } from '../../domain/auth/auth.types';
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

  async logout(): Promise<void> {
    await delay(200);
  }

  async getCurrentUser(): Promise<UserProfile | null> {
    await delay(200);
    return MOCK_USER;
  }

  async refreshToken(): Promise<AuthTokens> {
    await delay(300);
    return {
      accessToken: 'mock_access_token_refreshed_' + Date.now(),
      refreshToken: 'mock_refresh_token_refreshed_' + Date.now(),
    };
  }
}
