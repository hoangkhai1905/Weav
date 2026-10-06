import { create } from 'zustand';
import type { UserProfile } from '../types/workflow.types';
import { MOCK_USER, initMockStorage } from '../api/client';
import { accessTokenExpiresSoon, authApi, getAuthApiErrorStatus, isAuthMockMode } from '../api/auth.api';
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

// Renew the 15-minute access token shortly before it expires, so API calls never see a 401 while the
// backend refresh session (7 days) is still valid. Timers sleep in background tabs, hence the visibility check.
function refreshIfExpiringSoon(): void {
  const token = getStoredAuthToken();
  if (!token || !authApi.canRefresh() || !accessTokenExpiresSoon(token)) return;
  void useAuthStore.getState().handleUnauthorized();
}

function onVisible(): void {
  if (document.visibilityState === 'visible') refreshIfExpiringSoon();
}

if (!isAuthMockMode && typeof window !== 'undefined') {
  // Replace, never stack: a reloaded module (Vite HMR) must not leave an older timer refreshing too.
  const slot = window as typeof window & { __weavAuthRenewal?: { timer: number; onVisible: () => void } };
  if (slot.__weavAuthRenewal) {
    window.clearInterval(slot.__weavAuthRenewal.timer);
    document.removeEventListener('visibilitychange', slot.__weavAuthRenewal.onVisible);
  }
  slot.__weavAuthRenewal = { timer: window.setInterval(refreshIfExpiringSoon, 60 * 1000), onVisible };
  document.addEventListener('visibilitychange', onVisible);
}
