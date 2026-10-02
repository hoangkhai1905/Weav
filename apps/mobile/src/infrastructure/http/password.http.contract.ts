import type { AuthRepositoryError } from '../../domain/auth/auth.types';

export const CHANGE_PASSWORD_PATH = '/api/auth/change-password';

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export function buildChangePasswordRequest(
  currentPassword: string,
  newPassword: string,
) {
  return {
    method: 'POST' as const,
    url: CHANGE_PASSWORD_PATH,
    data: { currentPassword, newPassword },
  };
}

export function assertChangePasswordResponse(status: number): void {
  if (status !== 204) {
    throw mapChangePasswordError(status);
  }
}

export function mapChangePasswordError(status?: number): AuthRepositoryError {
  if (status === 400) {
    return {
      code: 'VALIDATION_FAILED',
      message: 'Password must be between 8 and 72 characters.',
      status,
    };
  }
  if (status === 401) {
    return {
      code: 'UNAUTHORIZED',
      message: 'Current password is incorrect or the session is no longer valid.',
      status,
    };
  }
  if (status === 429) {
    return {
      code: 'RATE_LIMITED',
      message: 'Too many password-change attempts. Please try again later.',
      status,
    };
  }
  return {
    code: 'PASSWORD_CHANGE_ERROR',
    message: 'Password change service unavailable. Please try again.',
    ...(status === undefined ? {} : { status }),
  };
}
