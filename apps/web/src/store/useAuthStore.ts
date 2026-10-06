import { create } from 'zustand';
import type { UserProfile } from '../types/workflow.types';
import { MOCK_USER, initMockStorage } from '../api/client';
import { authApi, getAuthApiErrorStatus, isAuthMockMode } from '../api/auth.api';
import { getStoredAuthToken } from '../api/ocr.api';

interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  setUser: (user: UserProfile | null) => void;
  loginMock: () => void;
  logout: () => void;
  /** After a 401: renews the access token if the refresh credential still works, otherwise logs out. */
  handleUnauthorized: () => Promise<boolean>;
}

initMockStorage();

export const useAuthStore = create<AuthState>((set, get) => ({
  user: isAuthMockMode ? MOCK_USER : null,
  isAuthenticated: isAuthMockMode || !!getStoredAuthToken(),
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
  handleUnauthorized: async () => {
    try {
      const { user } = await authApi.refreshAccessToken();
      set({ user, isAuthenticated: true });
      return true;
    } catch (error) {
      // A network failure keeps the session; only a rejected or missing refresh credential ends it.
      if (getAuthApiErrorStatus(error) === 401) get().logout();
      return false;
    }
  },
}));

const initialAccessToken = getStoredAuthToken();
if (!isAuthMockMode && (initialAccessToken || authApi.canRefresh())) {
  void authApi
    .getCurrentUser()
    .then((user) => {
      if (getStoredAuthToken() !== initialAccessToken && !user) return;
      if (user) useAuthStore.getState().setUser(user);
      else useAuthStore.getState().logout();
    })
    .catch(() => {
      if (getStoredAuthToken() === initialAccessToken)
        useAuthStore.getState().logout();
    });
}

function accessTokenExpiresAt(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Renew the 15-minute access token shortly before it expires, so API calls never see a 401 while the
// backend refresh session (7 days) is still valid. Timers sleep in background tabs, hence the visibility check.
function refreshIfExpiringSoon(): void {
  const token = getStoredAuthToken();
  if (!token || !authApi.canRefresh()) return;
  const expiresAt = accessTokenExpiresAt(token);
  if (expiresAt !== null && expiresAt - Date.now() > 2 * 60 * 1000) return;
  void useAuthStore.getState().handleUnauthorized();
}

if (!isAuthMockMode && typeof window !== 'undefined') {
  window.setInterval(refreshIfExpiringSoon, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshIfExpiringSoon();
  });
}
