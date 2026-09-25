export interface AuthSessionStorage {
  readonly persistent: boolean;
  loadRefreshToken(): Promise<string | null>;
  saveRefreshToken(refreshToken: string): Promise<void>;
  clearRefreshToken(): Promise<void>;
}

export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export const AUTH_REFRESH_TOKEN_KEY = 'weav.auth.refresh-token.v1';

interface AuthSessionStorageOptions {
  platform: string;
  mockMode: boolean;
  secureStore?: SecureStoreLike;
}

export function createAuthSessionStorage({
  platform,
  mockMode,
  secureStore,
}: AuthSessionStorageOptions): AuthSessionStorage {
  const persistent = platform !== 'web' && !mockMode;

  if (!persistent) {
    return {
      persistent: false,
      async loadRefreshToken() {
        return null;
      },
      async saveRefreshToken() {},
      async clearRefreshToken() {},
    };
  }

  if (!secureStore) {
    throw new Error('SecureStore is required for native HTTP auth persistence.');
  }

  return {
    persistent: true,
    loadRefreshToken: () => secureStore.getItemAsync(AUTH_REFRESH_TOKEN_KEY),
    saveRefreshToken: (refreshToken) => {
      if (!refreshToken) {
        return Promise.reject(new Error('A refresh token is required.'));
      }
      return secureStore.setItemAsync(AUTH_REFRESH_TOKEN_KEY, refreshToken);
    },
    clearRefreshToken: () => secureStore.deleteItemAsync(AUTH_REFRESH_TOKEN_KEY),
  };
}
