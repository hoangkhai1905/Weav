import type { AxiosRequestConfig } from 'axios';
import type { LinkedOAuthAccount } from '../../domain/auth/account.types';

export const AVATAR_PATH = '/api/users/me/avatar';
export const OAUTH_ACCOUNTS_PATH = '/api/users/me/oauth-accounts';

export const buildGetAvatarRequest = (): AxiosRequestConfig => ({ method: 'GET', url: AVATAR_PATH });
export const buildDeleteAvatarRequest = (): AxiosRequestConfig => ({ method: 'DELETE', url: AVATAR_PATH });
export const buildOAuthAccountsRequest = (): AxiosRequestConfig => ({ method: 'GET', url: OAUTH_ACCOUNTS_PATH });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** AvatarUrlResponse { url, expiresAt }. The URL is short-lived: never persist it. */
export function mapAvatarUrl(data: unknown): string {
  if (!isRecord(data) || typeof data.url !== 'string' || !/^https?:\/\//i.test(data.url)) {
    throw new Error('Invalid response: avatar url.');
  }
  return data.url;
}

/** OAuthAccountMetadata[]; the backend never returns tokens or provider subjects. */
export function mapOAuthAccounts(data: unknown): LinkedOAuthAccount[] {
  if (!Array.isArray(data)) throw new Error('Invalid response: oauth accounts.');
  return data.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || item.provider !== 'GOOGLE') {
      throw new Error('Invalid response: oauth account.');
    }
    return {
      id: item.id,
      provider: 'GOOGLE',
      providerEmail: typeof item.providerEmail === 'string' ? item.providerEmail : null,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    };
  });
}
