export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export interface PasswordRecoveryInput {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export interface PasswordRecoveryValidationErrors {
  email?: string;
  code?: string;
  newPassword?: string;
  confirmPassword?: string;
}

const EMAIL_PATTERN = /^ *[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+ *$/;

export function validatePasswordRecovery(
  input: PasswordRecoveryInput,
): PasswordRecoveryValidationErrors {
  const errors: PasswordRecoveryValidationErrors = {};
  if (input.email.trim().length === 0) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_PATTERN.test(input.email) || input.email.length > 320) {
    errors.email = 'Enter a valid email address.';
  }

  if (!/^\d{6}$/.test(input.code)) {
    errors.code = 'Enter the 6-digit verification code.';
  }

  if (input.newPassword.trim().length === 0) {
    errors.newPassword = 'New password is required.';
  } else if (input.newPassword.length < PASSWORD_MIN_LENGTH || input.newPassword.length > PASSWORD_MAX_LENGTH) {
    errors.newPassword = 'New password must be between 8 and 72 characters.';
  }

  if (input.confirmPassword.length === 0) {
    errors.confirmPassword = 'Please confirm the new password.';
  } else if (input.confirmPassword !== input.newPassword) {
    errors.confirmPassword = 'New passwords do not match.';
  }

  return errors;
}

export function createPasswordRecoverySubmissionGate() {
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

export function isPasswordRecoveryFlowCurrent(
  capturedGeneration: number,
  currentGeneration: number,
  isMounted: boolean,
): boolean {
  return isMounted && capturedGeneration === currentGeneration;
}
