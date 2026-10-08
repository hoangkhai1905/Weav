export const EXPIRY_WARNING_DAYS = 7;

export type CredentialExpiry = 'none' | 'ok' | 'soon' | 'expired';

/** Whether a credential needs attention: already expired, or expiring within `warnDays`. */
export function credentialExpiry(
  credentialExpiresAt: string | null,
  now: Date = new Date(),
  warnDays: number = EXPIRY_WARNING_DAYS,
): CredentialExpiry {
  if (!credentialExpiresAt) return 'none';
  const at = new Date(credentialExpiresAt).getTime();
  if (Number.isNaN(at)) return 'none';
  const left = at - now.getTime();
  if (left <= 0) return 'expired';
  return left <= warnDays * 24 * 60 * 60 * 1000 ? 'soon' : 'ok';
}
