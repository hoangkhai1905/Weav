import { create } from 'zustand';
import type { UserProfile } from '../types/workflow.types';
import { MOCK_USER, initMockStorage } from '../api/client';

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
  user: MOCK_USER,
  isAuthenticated: true,
  activeWorkspace: { id: 'ws-main', name: 'WEAV Workspace' },
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  loginMock: () =>
    set({
      user: MOCK_USER,
      isAuthenticated: true,
    }),
  logout: () => {
    localStorage.removeItem('weav_token');
    set({ user: null, isAuthenticated: false });
  },
}));
