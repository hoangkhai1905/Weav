import type {
  AuthSession,
  AuthTokens,
  UserProfile,
} from '../../domain/auth/auth.types';
import type { AuthSessionStorage } from '../../infrastructure/auth/auth-session.storage';

interface AuthStoreSnapshot {
  tokens: AuthTokens | null;
}

export interface AuthSessionStoreAdapter {
  getState(): AuthStoreSnapshot;
  setHydrating(isHydrating: boolean): void;
  setAuthSession(user: UserProfile, tokens: AuthTokens): void;
  clearAuthSession(): void;
  setAuthError(message: string | null): void;
}

export interface AuthSessionRepositoryAdapter {
  restoreSession(refreshToken: string): Promise<AuthSession>;
  logout(refreshToken?: string): Promise<void>;
}

export type AuthSessionBootstrapResult =
  | 'restored'
  | 'empty'
  | 'signed-out'
  | 'stale'
  | 'skipped';

interface AuthSessionCoordinatorOptions {
  store: AuthSessionStoreAdapter;
  storage: AuthSessionStorage;
  repository: AuthSessionRepositoryAdapter;
  persistenceEnabled: boolean;
}

function isUnauthorized(error: unknown): boolean {
  const candidate = error as { code?: string; status?: number } | null;
  return candidate?.status === 401 || candidate?.code === 'UNAUTHORIZED';
}

function isStorageError(error: unknown): boolean {
  const candidate = error as { code?: string } | null;
  return candidate?.code === 'AUTH_STORAGE_WRITE_FAILED';
}

export function createAuthSessionCoordinator({
  store,
  storage,
  repository,
  persistenceEnabled,
}: AuthSessionCoordinatorOptions) {
  let lifecycle = 0;
  let bootstrapPromise: Promise<AuthSessionBootstrapResult> | null = null;
  let refreshPromise: Promise<AuthSession | null> | null = null;
  let storageOperation: Promise<unknown> = Promise.resolve();

  const isCurrent = (operation: number) => operation === lifecycle;

  const invalidate = (): number => {
    lifecycle += 1;
    return lifecycle;
  };

  const queueStorageOperation = <T>(operation: () => Promise<T>): Promise<T> => {
    const queued = storageOperation.then(operation, operation);
    storageOperation = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  };

  const clearPersistedState = async () => {
    try {
      await queueStorageOperation(() => storage.clearRefreshToken());
    } catch {
      // Memory state is still cleared; persistence failures are not auth success.
    }
  };

  const applySession = async (
    session: AuthSession,
    operation: number,
  ): Promise<boolean> => {
    if (!isCurrent(operation)) return false;

    if (persistenceEnabled) {
      const persisted = await queueStorageOperation(async () => {
        if (!isCurrent(operation)) return false;
        try {
          await storage.saveRefreshToken(session.tokens.refreshToken);
        } catch {
          const failure = new Error('Unable to persist the mobile session.');
          Object.assign(failure, { code: 'AUTH_STORAGE_WRITE_FAILED' });
          throw failure;
        }
        if (!isCurrent(operation)) {
          await storage.clearRefreshToken();
          return false;
        }
        return true;
      });
      if (!persisted) return false;
    }

    if (!isCurrent(operation)) return false;
    store.setAuthError(null);
    store.setAuthSession(session.user, session.tokens);
    return true;
  };

  const runBootstrap = async (): Promise<AuthSessionBootstrapResult> => {
    if (!persistenceEnabled) {
      store.setHydrating(false);
      return 'skipped';
    }

    const operation = lifecycle;
    store.setHydrating(true);
    try {
      const refreshToken = await storage.loadRefreshToken();
      if (!isCurrent(operation)) return 'stale';

      if (!refreshToken) {
        store.clearAuthSession();
        return 'empty';
      }

      const session = await repository.restoreSession(refreshToken);
      if (!isCurrent(operation)) return 'stale';
      return (await applySession(session, operation)) ? 'restored' : 'stale';
    } catch (error) {
      if (!isCurrent(operation)) return 'stale';

      if (isUnauthorized(error) || isStorageError(error)) {
        await clearPersistedState();
      }
      store.clearAuthSession();
      store.setAuthError(
        isUnauthorized(error)
          ? 'SESSION_INVALID'
          : 'SESSION_RESTORE_UNAVAILABLE',
      );
      return 'signed-out';
    } finally {
      if (isCurrent(operation)) store.setHydrating(false);
    }
  };

  const bootstrap = (): Promise<AuthSessionBootstrapResult> => {
    if (!bootstrapPromise) bootstrapPromise = runBootstrap();
    return bootstrapPromise;
  };

  const retryBootstrap = (): Promise<AuthSessionBootstrapResult> => {
    bootstrapPromise = null;
    return bootstrap();
  };

  const beginAuthOperation = (): number => {
    const operation = invalidate();
    store.setAuthError(null);
    return operation;
  };

  const establishSession = async (
    session: AuthSession,
    operation = lifecycle,
  ): Promise<boolean> => {
    try {
      return await applySession(session, operation);
    } catch (error) {
      if (isStorageError(error)) {
        await clearPersistedState();
        store.clearAuthSession();
        store.setAuthError('SESSION_STORAGE_UNAVAILABLE');
      }
      throw error;
    }
  };

  const logout = async (): Promise<void> => {
    let refreshToken = store.getState().tokens?.refreshToken;
    invalidate();
    store.clearAuthSession();
    store.setHydrating(false);
    store.setAuthError(null);
    if (!refreshToken && persistenceEnabled) {
      try {
        refreshToken = await storage.loadRefreshToken();
      } catch {
        refreshToken = undefined;
      }
    }
    await clearPersistedState();
    try {
      await repository.logout(refreshToken);
    } catch {
      // Logout is local-first: revoke failure cannot restore the cleared session.
    }
  };

  const expire = async (): Promise<void> => {
    invalidate();
    store.clearAuthSession();
    store.setHydrating(false);
    await clearPersistedState();
  };

  const refresh = (): Promise<AuthSession | null> => {
    if (refreshPromise) return refreshPromise;

    const refreshToken = store.getState().tokens?.refreshToken;
    if (!refreshToken) return Promise.reject(new Error('Please sign in again.'));

    const operation = lifecycle;
    refreshPromise = (async () => {
      try {
        const session = await repository.restoreSession(refreshToken);
        if (
          !isCurrent(operation) ||
          store.getState().tokens?.refreshToken !== refreshToken
        ) {
          return null;
        }
        await applySession(session, operation);
        return session;
      } catch (error) {
        if (
          isCurrent(operation) &&
          store.getState().tokens?.refreshToken === refreshToken
        ) {
          if (isUnauthorized(error) || isStorageError(error)) {
            await expire();
          } else {
            // A transient refresh failure must not erase the rotated material.
            store.clearAuthSession();
            store.setAuthError('SESSION_REFRESH_UNAVAILABLE');
          }
        }
        throw error;
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  };

  return {
    bootstrap,
    retryBootstrap,
    invalidate,
    beginAuthOperation,
    establishSession,
    logout,
    expire,
    refresh,
  };
}
