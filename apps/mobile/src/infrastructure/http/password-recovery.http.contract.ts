import type { AuthRepositoryError } from '../../domain/auth/auth.types';

export const FORGOT_PASSWORD_PATH = '/api/auth/forgot-password';
export const OTP_VERIFY_PATH = '/api/auth/otp/verify';
export const RESET_PASSWORD_PATH = '/api/auth/reset-password';

export type PasswordRecoveryOperation = 'forgot' | 'verify' | 'reset';

export interface PasswordResetReceipt {
  challengeId: string;
  expiresIn: number;
  retryAfter: number;
}

export interface PasswordResetVerification {
  purpose: 'PASSWORD_RESET';
  resetToken: string;
  expiresIn: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isOpaque43(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function invalidResponse(): never {
  throw { code: 'INVALID_RESPONSE', message: 'Invalid password recovery response.' };
}

export function buildForgotPasswordRequest(email: string) {
  return {
    method: 'POST' as const,
    url: FORGOT_PASSWORD_PATH,
    data: { email },
  };
}

export function buildVerifyOtpRequest(challengeId: string, code: string) {
  return {
    method: 'POST' as const,
    url: OTP_VERIFY_PATH,
    data: { challengeId, code },
  };
}

export function buildResetPasswordRequest(resetToken: string, newPassword: string) {
  return {
    method: 'POST' as const,
    url: RESET_PASSWORD_PATH,
    data: { resetToken, newPassword },
  };
}

export function mapPasswordResetReceipt(data: unknown): PasswordResetReceipt {
  if (!isRecord(data) || !hasOnlyKeys(data, ['challengeId', 'expiresIn', 'retryAfter'])) {
    return invalidResponse();
  }
  if (
    !isOpaque43(data.challengeId) ||
    data.expiresIn !== 300 ||
    data.retryAfter !== 60
  ) {
    return invalidResponse();
  }
  return {
    challengeId: data.challengeId,
    expiresIn: data.expiresIn,
    retryAfter: data.retryAfter,
  };
}

export function mapPasswordResetVerification(data: unknown): PasswordResetVerification {
  if (!isRecord(data) || !hasOnlyKeys(data, ['purpose', 'resetToken', 'expiresIn'])) {
    return invalidResponse();
  }
  if (data.purpose !== 'PASSWORD_RESET' || !isOpaque43(data.resetToken) || data.expiresIn !== 300) {
    return invalidResponse();
  }
  return {
    purpose: 'PASSWORD_RESET',
    resetToken: data.resetToken,
    expiresIn: data.expiresIn,
  };
}

export function assertPasswordRecoveryResponse(
  status: number,
  operation: PasswordRecoveryOperation,
): void {
  const expectedStatus = operation === 'forgot' ? 202 : operation === 'verify' ? 200 : 204;
  if (status !== expectedStatus) {
    throw mapPasswordRecoveryError(status, operation);
  }
}

export function mapPasswordRecoveryError(
  status: number | undefined,
  operation: PasswordRecoveryOperation,
): AuthRepositoryError {
  if (status === 400) {
    if (operation === 'verify') {
      return { code: 'INVALID_OTP', message: 'The verification code is invalid or expired.', status };
    }
    if (operation === 'reset') {
      return { code: 'INVALID_RESET', message: 'The reset request is invalid or expired. Request a new code.', status };
    }
    return { code: 'VALIDATION_FAILED', message: 'Enter a valid email address.', status };
  }
  if (status === 401) {
    return { code: 'UNAUTHORIZED', message: 'Your session is no longer valid. Please sign in again.', status };
  }
  if (status === 429) {
    return { code: 'RATE_LIMITED', message: 'Too many recovery attempts. Please wait before trying again.', status };
  }
  if (status === 503) {
    return { code: 'RECOVERY_UNAVAILABLE', message: 'Password recovery is temporarily unavailable. Please try again later.', status };
  }
  return {
    code: 'RECOVERY_ERROR',
    message: 'Password recovery service unavailable. Please try again.',
    ...(status === undefined ? {} : { status }),
  };
}
