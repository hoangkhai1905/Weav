import { delay, getStorage, setStorage, STORAGE_KEYS, MOCK_USER } from './client';
import type { UserProfile } from '../types/workflow.types';

export const authApi = {
  async login(_email: string, _password?: string): Promise<{ user: UserProfile; accessToken: string }> {
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

  async register(email: string, name: string): Promise<{ user: UserProfile; accessToken: string }> {
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
    await delay(100);
    const token = localStorage.getItem('weav_token');
    if (!token) return null;
    return getStorage<UserProfile>(STORAGE_KEYS.USER, MOCK_USER);
  },

  async logout(): Promise<void> {
    await delay(150);
    localStorage.removeItem('weav_token');
  },
};
