export interface LinkedOAuthAccount {
  id: string;
  provider: 'GOOGLE';
  providerEmail: string | null;
  createdAt: string;
}

/** Account extras of the signed-in user: avatar image and linked sign-in providers. */
export interface AccountRepository {
  /** Short-lived signed URL of the avatar, or null when the user has none. */
  getAvatarUrl(): Promise<string | null>;
  deleteAvatar(): Promise<void>;
  listOAuthAccounts(): Promise<LinkedOAuthAccount[]>;
}
