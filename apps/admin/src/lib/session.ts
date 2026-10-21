export interface AdminProfile {
  id: string;
  email: string;
  displayName: string | null;
  systemRole: 'ADMIN';
}

const KEY = 'weav_admin_session';

/** Rotated on every refresh; memory only, so a page reload ends the session once the access token expires. */
let refreshToken: string | null = null;

interface Stored {
  accessToken: string;
  profile: AdminProfile;
}

function read(): Stored | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function write(value: Stored | null): void {
  try {
    if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the session then lives only until the next reload.
  }
}

export const getAccessToken = (): string | null => read()?.accessToken ?? null;
export const getProfile = (): AdminProfile | null => read()?.profile ?? null;
export const getRefreshToken = (): string | null => refreshToken;

export function setSession(access: string, refresh: string, user: AdminProfile): void {
  refreshToken = refresh;
  write({ accessToken: access, profile: user });
}

export function clearSession(): void {
  refreshToken = null;
  write(null);
}
