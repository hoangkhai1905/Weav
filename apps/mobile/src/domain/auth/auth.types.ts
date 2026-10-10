export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
  /** True when the account has an uploaded avatar (fetch it with AccountRepository.getAvatarUrl). */
  avatarPresent?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthSession {
  user: UserProfile;
  tokens: AuthTokens;
}

export interface AuthSessionSummary {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
  userAgent: string | null;
}

export interface AuthSessionPage {
  items: AuthSessionSummary[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

export interface PasswordResetReceipt {
  challengeId: string;
  expiresIn: number;
  retryAfter: number;
}

export interface PasswordResetVerification {
  purpose: 'PASSWORD_RESET';
  resetToken: string;
  expiresIn: number;
}

export interface GoogleHandoff {
  transactionId: string;
  handoffCode: string;
  codeVerifier: string;
}

export interface AuthRepository {
  login(email: string, password: string): Promise<AuthSession>;
  /** Mobile Google sign-in: trades the deep-link handoff for a session (single use, 60 s). */
  exchangeGoogleHandoff(handoff: GoogleHandoff): Promise<AuthSession>;
  register(email: string, name: string, password: string): Promise<AuthSession>;
  logout(refreshToken?: string): Promise<void>;
  getCurrentUser(): Promise<UserProfile | null>;
  updateCurrentUser(displayName: string | null): Promise<UserProfile>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  requestPasswordReset(email: string): Promise<PasswordResetReceipt>;
  verifyPasswordResetOtp(challengeId: string, code: string): Promise<PasswordResetVerification>;
  resetPassword(resetToken: string, newPassword: string): Promise<void>;
  listSessions(page?: number, size?: number, signal?: AbortSignal): Promise<AuthSessionPage>;
  revokeSession(sessionId: string, signal?: AbortSignal): Promise<void>;
  revokeAllSessions(signal?: AbortSignal): Promise<void>;
  refreshToken(): Promise<AuthTokens>;
  restoreSession(refreshToken: string): Promise<AuthSession>;
}

export interface AuthRepositoryError {
  code: string;
  message: string;
  status?: number;
  /** Backend validation details, [{ field, message }] (see fieldErrorsFromError). */
  details?: unknown;
  requestId?: string;
}
