import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { authRepository } from '../../infrastructure/repository-factory';
import { beginAuthOperation, establishAuthSession } from './auth-session.runtime';
import {
  GOOGLE_RETURN_URL,
  base64ToBase64Url,
  buildGoogleStartUrl,
  codeVerifierFrom,
  googleErrorKey,
  parseGoogleCallback,
} from './google-sign-in';

/** Public base URL of identity-service (browser leg only; the exchange goes through the gateway). */
const IDENTITY_URL = process.env.EXPO_PUBLIC_IDENTITY_URL;

/**
 * The server returns to `weav://auth/callback`, which only a native build can receive, so the
 * button is hidden on web and when the identity URL is not configured.
 */
export const googleSignInAvailable = Platform.OS !== 'web' && buildGoogleStartUrl(IDENTITY_URL, 'x') !== null;

export type GoogleSignInResult =
  | { kind: 'signedIn' }
  | { kind: 'cancelled' }
  | { kind: 'stale' }
  | { kind: 'error'; messageKey: string };

/**
 * One attempt with a fresh verifier (kept in memory only). Never retries the exchange: the handoff
 * code is single use, so any failure sends the user back to the button.
 */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const codeVerifier = codeVerifierFrom(Crypto.getRandomBytes(43));
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, codeVerifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const startUrl = buildGoogleStartUrl(IDENTITY_URL, base64ToBase64Url(digest));
  if (!startUrl) return { kind: 'error', messageKey: 'au.google.err.unavailable' };

  const operation = beginAuthOperation();
  const result = await WebBrowser.openAuthSessionAsync(startUrl, GOOGLE_RETURN_URL);
  // cancel / dismiss / locked, or the browser stopped on an identity error page.
  if (result.type !== 'success') return { kind: 'cancelled' };

  const callback = parseGoogleCallback(result.url);
  if (callback.kind === 'cancelled') return { kind: 'cancelled' };
  if (callback.kind === 'unavailable') return { kind: 'error', messageKey: 'au.google.err.unavailable' };

  try {
    const session = await authRepository.exchangeGoogleHandoff({
      transactionId: callback.transactionId,
      handoffCode: callback.handoffCode,
      codeVerifier,
    });
    return (await establishAuthSession(session, operation)) ? { kind: 'signedIn' } : { kind: 'stale' };
  } catch (error) {
    return { kind: 'error', messageKey: googleErrorKey(error) };
  }
}
