export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
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

export interface AuthRepository {
  login(email: string, password: string): Promise<AuthSession>;
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
}
