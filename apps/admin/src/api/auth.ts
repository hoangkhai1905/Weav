import { api } from './client';
import { clearSession, getRefreshToken, setSession, type AdminProfile } from '../lib/session';

export type { AdminProfile };

/** The account signed in correctly but is not a system administrator. */
export class NotAdminError extends Error {
  constructor() {
    super('Not an administrator');
    this.name = 'NotAdminError';
  }
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; displayName: string | null; systemRole?: 'USER' | 'ADMIN' };
}

const revoke = (refreshToken: string) => api.post('/api/auth/logout', { refreshToken }).catch(() => undefined);

export async function login(email: string, password: string): Promise<AdminProfile> {
  const { data } = await api.post<LoginResponse>('/api/auth/login', { email, password });
  if (data.user.systemRole !== 'ADMIN') {
    await revoke(data.refreshToken);
    throw new NotAdminError();
  }
  const profile: AdminProfile = {
    id: data.user.id,
    email: data.user.email,
    displayName: data.user.displayName ?? null,
    systemRole: 'ADMIN',
  };
  setSession(data.accessToken, data.refreshToken, profile);
  return profile;
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  clearSession();
  if (refreshToken) await revoke(refreshToken);
}
