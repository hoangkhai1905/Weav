import { create } from 'zustand';
import type { UserProfile, AuthTokens } from '../domain/auth/auth.types';
import { setHttpClientToken } from '../infrastructure/http/http-client';

interface AuthState {
  isAuthenticated: boolean;
  user: UserProfile | null;
  tokens: AuthTokens | null;
  setAuthSession: (user: UserProfile, tokens: AuthTokens) => void;
  clearAuthSession: () => void;
}

const isMockMode = process.env.EXPO_PUBLIC_API_MODE === 'mock';

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: isMockMode,
  user: isMockMode ? {
    id: 'user-001',
    name: 'Nguyễn Anh Xuân Trường',
    email: 'truong@example.com',
  } : null,
  tokens: isMockMode ? {
    accessToken: 'mock_token_demo',
    refreshToken: 'mock_refresh_demo',
  } : null,
  setAuthSession: (user, tokens) => {
    setHttpClientToken(tokens.accessToken);
    set({ isAuthenticated: true, user, tokens });
  },
  clearAuthSession: () => {
    setHttpClientToken(null);
    set({ isAuthenticated: false, user: null, tokens: null });
  },
}));
