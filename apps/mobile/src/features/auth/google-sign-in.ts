/**
 * Pure helpers of the mobile Google sign-in (PKCE + deep link handoff, see
 * docs/handoff/2026-10-week6-mobile.md section A). No Expo imports, so they run under node:test.
 */

export const GOOGLE_RETURN_URL = 'weav://auth/callback';

const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const HANDOFF_VALUE = /^[A-Za-z0-9_-]{43}$/;

/** 43 random bytes -> 43 chars of A-Za-z0-9-_ (64 symbols, so `byte & 63` is unbiased). */
export function codeVerifierFrom(randomBytes: Uint8Array): string {
  if (randomBytes.length < 43 || randomBytes.length > 128) throw new Error('PKCE verifier needs 43..128 bytes.');
  return Array.from(randomBytes, (byte) => URL_SAFE[byte & 63]).join('');
}

/** Standard base64 (as returned by a SHA-256 digest) -> base64url without padding. */
export function base64ToBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Browser leg; `null` when the identity public URL is not configured. */
export function buildGoogleStartUrl(identityUrl: string | undefined, codeChallenge: string): string | null {
  const base = identityUrl?.trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/auth/oauth/google/mobile/start?codeChallenge=${encodeURIComponent(codeChallenge)}&codeChallengeMethod=S256`;
}

export type GoogleCallback =
  | { kind: 'success'; transactionId: string; handoffCode: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' };

/** Reads `weav://auth/callback?...`. Anything unexpected is treated as "unavailable". */
export function parseGoogleCallback(url: string): GoogleCallback {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const params = new URLSearchParams(query);
  const oauthError = params.get('oauth_error');
  if (oauthError === 'cancelled') return { kind: 'cancelled' };
  const transactionId = params.get('transaction_id') ?? '';
  const handoffCode = params.get('handoff_code') ?? '';
  if (!oauthError && HANDOFF_VALUE.test(transactionId) && HANDOFF_VALUE.test(handoffCode)) {
    return { kind: 'success', transactionId, handoffCode };
  }
  return { kind: 'unavailable' };
}

/** i18n key for a failed exchange (handoff section A.4). Branches on HTTP status first, then code. */
export function googleErrorKey(error: unknown): string {
  const { status, code } = (error ?? {}) as { status?: number; code?: string };
  if (status === 409) return code === 'ACCOUNT_LINK_REQUIRED' ? 'au.google.err.linkRequired' : 'au.google.err.retry';
  if (status === 401) return code === 'UNAUTHORIZED' ? 'au.google.err.notAllowed' : 'au.google.err.retry';
  if (status === 429) return 'au.err.429';
  if (status === 503) return 'au.google.err.unavailable';
  return status === undefined ? 'au.err.network' : 'au.google.err.unavailable';
}
