// Pure (no react-native import) so Node tests can load it.

export type InvitationErrorPhase = 'invite' | 'manage' | 'respond' | 'verify';

const BY_CODE: Record<string, string> = {
  USER_EXISTS: 'inv.err.userExists',
  USER_INACTIVE: 'inv.err.userInactive',
  INVITATION_EXISTS: 'inv.err.exists',
  INVITATION_LIMIT: 'inv.err.limit',
  INVITATION_RESEND_TOO_SOON: 'inv.err.resendTooSoon',
  INVITATION_GONE: 'inv.err.gone',
  INVITATION_NOT_PENDING: 'inv.err.gone',
  INVITATION_NOT_FOUND: 'inv.err.gone',
  EMAIL_NOT_VERIFIED: 'inv.err.notVerified',
};

/** i18n key of the friendly sentence for a failed invitation call; the raw backend message is never shown. */
export function invitationErrorKey(error: unknown, phase: InvitationErrorPhase): string {
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown };
  if (typeof code === 'string' && BY_CODE[code]) return BY_CODE[code];
  // A malformed body (INVALID_RESPONSE) also has no status, but it is not a connection problem.
  if (typeof status !== 'number') return code === 'INVALID_RESPONSE' ? 'inv.err.generic' : 'au.err.network';
  if (status === 429) return 'inv.err.tooMany';
  if (status === 410) return 'inv.err.gone';
  if (status === 403) return 'ui.error.FORBIDDEN';
  if (phase === 'verify' && status === 400) return 'inv.err.badCode';
  return 'inv.err.generic';
}

/** True when the server says the typed address already has an account, so a direct add is the way. */
export function isUserNotFound(error: unknown): boolean {
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown };
  return status === 404 && code === 'USER_NOT_FOUND';
}

/** Whether a failed invitation answer means the list on screen is out of date and should be reloaded. */
export function invitationListIsStale(error: unknown): boolean {
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown };
  return (
    status === 404 ||
    status === 409 ||
    status === 410 ||
    code === 'INVITATION_GONE' ||
    code === 'INVITATION_NOT_PENDING' ||
    code === 'INVITATION_NOT_FOUND' ||
    code === 'EMAIL_NOT_VERIFIED'
  );
}

/** A 6-digit code from whatever was typed or pasted. */
export function onlyCodeDigits(text: string): string {
  return text.replace(/\D/g, '').slice(0, 6);
}
