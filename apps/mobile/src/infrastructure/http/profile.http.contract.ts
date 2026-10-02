import type { UserProfile } from '../../domain/auth/auth.types';

export const CURRENT_USER_PATH = '/api/auth/me';

export interface IdentityUserResponse {
  id: string;
  email: string;
  displayName: string | null;
  avatarStorageKey?: string | null;
}

export function buildGetCurrentUserRequest() {
  return {
    method: 'GET' as const,
    url: CURRENT_USER_PATH,
  };
}

export function buildUpdateCurrentUserRequest(displayName: string | null) {
  return {
    method: 'PATCH' as const,
    url: CURRENT_USER_PATH,
    data: { displayName },
  };
}

export function mapIdentityUser(user: IdentityUserResponse): UserProfile {
  if (
    !user ||
    typeof user.id !== 'string' ||
    typeof user.email !== 'string' ||
    (typeof user.displayName !== 'string' && user.displayName !== null)
  ) {
    throw new Error('Invalid Identity user response.');
  }

  return {
    id: user.id,
    email: user.email,
    name: user.displayName?.trim() || user.email,
    avatar: null,
  };
}
