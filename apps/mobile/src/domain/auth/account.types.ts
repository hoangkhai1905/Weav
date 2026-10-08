export interface LinkedOAuthAccount {
  id: string;
  provider: 'GOOGLE';
  providerEmail: string | null;
  createdAt: string;
}

export interface AvatarUpload {
  uri: string;
  name: string;
  type: string;
}

/** Account extras of the signed-in user: avatar image and linked sign-in providers. */
export interface AccountRepository {
  /** Short-lived signed URL of the avatar, or null when the user has none. */
  getAvatarUrl(): Promise<string | null>;
  /** Replaces the avatar with a picked image (multipart field `file`). */
  uploadAvatar(file: AvatarUpload): Promise<void>;
  deleteAvatar(): Promise<void>;
  listOAuthAccounts(): Promise<LinkedOAuthAccount[]>;
}
