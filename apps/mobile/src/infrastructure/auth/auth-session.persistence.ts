import { authSessionStorage } from './expo-auth-session.storage';
import { useAuthStore } from '../../stores/auth.store';

let invalidateAuthOperation: (() => void) | null = null;

export function registerAuthSessionInvalidator(invalidator: () => void): void {
  invalidateAuthOperation = invalidator;
}

export async function expirePersistedAuthSession(): Promise<void> {
  useAuthStore.getState().clearAuthSession();
  invalidateAuthOperation?.();
  useAuthStore.getState().clearAuthSession();
  try {
    await authSessionStorage.clearRefreshToken();
  } catch {
    // The app remains signed out even when secure storage cleanup fails.
  }
}
