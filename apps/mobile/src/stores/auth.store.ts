import { create } from 'zustand';
import type { UserProfile, AuthTokens } from '../domain/auth/auth.types';
import { setHttpClientToken } from '../infrastructure/http/http-client';

interface AuthState {
  isAuthenticated: boolean;
  isHydrating: boolean;
  user: UserProfile | null;
  tokens: AuthTokens | null;
  authError: string | null;
  setAuthSession: (user: UserProfile, tokens: AuthTokens) => void;
  setUserProfileIfCurrent: (user: UserProfile, expectedUserId: string) => boolean;
  clearAuthSession: () => void;
  setHydrating: (isHydrating: boolean) => void;
  setAuthError: (message: string | null) => void;
}

const isMockMode = process.env.EXPO_PUBLIC_API_MODE === 'mock';

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: isMockMode,
  isHydrating: !isMockMode,
  user: isMockMode ? {
    id: 'user-001',
    name: 'Nguyễn Anh Xuân Trường',
    email: 'truong@example.com',
  } : null,
  tokens: isMockMode ? {
    accessToken: 'mock_token_demo',
    refreshToken: 'mock_refresh_demo',
  } : null,
  authError: null,
  setAuthSession: (user, tokens) => {
    setHttpClientToken(tokens.accessToken);
    set({ isAuthenticated: true, user, tokens, authError: null, isHydrating: false });
  },
  setUserProfileIfCurrent: (user, expectedUserId) => {
    let applied = false;
    set((state) => {
      if (
        !state.isAuthenticated ||
        state.user?.id !== expectedUserId ||
        user.id !== expectedUserId
      ) {
        return state;
      }
      applied = true;
      return { ...state, user };
    });
    return applied;
  },
  clearAuthSession: () => {
    setHttpClientToken(null);
    set({ isAuthenticated: false, user: null, tokens: null, isHydrating: false });
  },
  setHydrating: (isHydrating) => set({ isHydrating }),
  setAuthError: (authError) => set({ authError }),
}));
