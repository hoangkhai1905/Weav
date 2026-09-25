export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ChangePasswordValidationErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export function validateChangePassword(
  input: ChangePasswordInput,
): ChangePasswordValidationErrors {
  const errors: ChangePasswordValidationErrors = {};

  if (input.currentPassword.trim().length === 0) {
    errors.currentPassword = 'Current password is required.';
  } else if (
    input.currentPassword.length < PASSWORD_MIN_LENGTH ||
    input.currentPassword.length > PASSWORD_MAX_LENGTH
  ) {
    errors.currentPassword = 'Current password must be between 8 and 72 characters.';
  }

  if (input.newPassword.trim().length === 0) {
    errors.newPassword = 'New password is required.';
  } else if (
    input.newPassword.length < PASSWORD_MIN_LENGTH ||
    input.newPassword.length > PASSWORD_MAX_LENGTH
  ) {
    errors.newPassword = 'New password must be between 8 and 72 characters.';
  }

  if (input.confirmPassword.length === 0) {
    errors.confirmPassword = 'Please confirm the new password.';
  } else if (input.confirmPassword !== input.newPassword) {
    errors.confirmPassword = 'New passwords do not match.';
  }

  return errors;
}

export function createChangePasswordSubmissionGate() {
  let inFlight = false;

  return {
    tryStart(): boolean {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    finish(): void {
      inFlight = false;
    },
  };
}

export function isChangePasswordScopeCurrent(
  capturedUserId: string,
  capturedRefreshToken: string,
  currentUserId: string | null,
  currentRefreshToken: string | null,
  isAuthenticated: boolean,
): boolean {
  return (
    isAuthenticated &&
    capturedUserId.length > 0 &&
    capturedRefreshToken.length > 0 &&
    capturedUserId === currentUserId &&
    capturedRefreshToken === currentRefreshToken
  );
}
