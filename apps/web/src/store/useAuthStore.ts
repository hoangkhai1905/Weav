import { create } from 'zustand';
import type { UserProfile } from '../types/workflow.types';
import { MOCK_USER, initMockStorage } from '../api/client';
import { authApi, isAuthMockMode } from '../api/auth.api';
import { getStoredAuthToken } from '../api/ocr.api';

interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  activeWorkspace: { id: string; name: string };
  setUser: (user: UserProfile | null) => void;
  loginMock: () => void;
  logout: () => void;
}

initMockStorage();

export const useAuthStore = create<AuthState>((set) => ({
  user: isAuthMockMode ? MOCK_USER : null,
  isAuthenticated: isAuthMockMode || !!getStoredAuthToken(),
  activeWorkspace: { id: 'ws-main', name: 'WEAV Workspace' },
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  loginMock: () => {
    if (!isAuthMockMode) return;
    set({
      user: MOCK_USER,
      isAuthenticated: true,
    });
  },
  logout: () => {
    localStorage.removeItem('weav_token');
    set({ user: null, isAuthenticated: false });
    void authApi.logout().catch(() => undefined);
  },
}));

const initialAccessToken = getStoredAuthToken();
if (!isAuthMockMode && initialAccessToken) {
  void authApi
    .getCurrentUser()
    .then((user) => {
      if (getStoredAuthToken() !== initialAccessToken) return;
      if (user) useAuthStore.getState().setUser(user);
      else useAuthStore.getState().logout();
    })
    .catch(() => {
      if (getStoredAuthToken() === initialAccessToken)
        useAuthStore.getState().logout();
    });
}
