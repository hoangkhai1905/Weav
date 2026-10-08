import type { AccountRepository, AvatarUpload, LinkedOAuthAccount } from '../../domain/auth/account.types';
import {
  buildDeleteAvatarRequest,
  buildGetAvatarRequest,
  buildOAuthAccountsRequest,
  buildUploadAvatarRequest,
  mapAvatarUrl,
  mapOAuthAccounts,
} from './account.http.contract';
import { requestGateway } from './gateway-request';

export class HttpAccountRepository implements AccountRepository {
  async getAvatarUrl(): Promise<string | null> {
    try {
      return await requestGateway(buildGetAvatarRequest(), mapAvatarUrl);
    } catch (error) {
      // 404 simply means the user has no avatar.
      if ((error as { status?: number } | null)?.status === 404) return null;
      throw error;
    }
  }

  async uploadAvatar(file: AvatarUpload): Promise<void> {
    const form = new FormData();
    // React Native reads { uri, name, type } as a file part.
    form.append('file', file as unknown as Blob);
    await requestGateway(buildUploadAvatarRequest(form), () => undefined);
  }

  async deleteAvatar(): Promise<void> {
    await requestGateway(buildDeleteAvatarRequest(), () => undefined);
  }

  listOAuthAccounts(): Promise<LinkedOAuthAccount[]> {
    return requestGateway(buildOAuthAccountsRequest(), mapOAuthAccounts);
  }
}
