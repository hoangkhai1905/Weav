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

export interface AuthRepository {
  login(email: string, password: string): Promise<AuthSession>;
  register(email: string, name: string, password: string): Promise<AuthSession>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<UserProfile | null>;
  refreshToken(): Promise<AuthTokens>;
}
