import { translations, useI18nStore } from '../../stores/i18n.store';

/**
 * The pure validators (change-password, password-recovery, workspace, profile) return fixed
 * English sentences that their tests pin. This table maps each one to an i18n key so the UI
 * can show it in the user's language; an unknown sentence is shown as is.
 */
export const VALIDATION_KEYS: Record<string, string> = {
  'Current password is required.': 'val.currentPasswordRequired',
  'Current password must be between 8 and 72 characters.': 'val.currentPasswordLength',
  'New password is required.': 'val.newPasswordRequired',
  'New password must be between 8 and 72 characters.': 'val.newPasswordLength',
  'Please confirm the new password.': 'val.confirmRequired',
  'New passwords do not match.': 'val.confirmMismatch',
  'Email is required.': 'val.emailRequired',
  'Enter a valid email address.': 'val.emailInvalid',
  'Enter the 6-digit verification code.': 'val.codeInvalid',
  'Workspace name is required.': 'val.workspaceNameRequired',
  'Workspace name must be 255 characters or fewer.': 'val.workspaceNameLength',
  'Member email is required.': 'val.memberEmailRequired',
  'Enter a valid member email.': 'val.memberEmailInvalid',
  'Member email must be 320 characters or fewer.': 'val.memberEmailLength',
  'Display name must be at most 120 characters.': 'val.displayNameLength',
};

export function localizeValidation(message: string | null | undefined): string | null {
  if (!message) return null;
  const key = VALIDATION_KEYS[message];
  if (!key) return message;
  return translations[useI18nStore.getState().language][key] ?? message;
}
