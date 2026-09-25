export function isAuthSessionScopeCurrent(
  capturedUserId: string,
  capturedRefreshToken: string,
  currentUserId: string | null,
  currentRefreshToken: string | null,
  isAuthenticated: boolean,
): boolean {
  return (
    isAuthenticated &&
    capturedUserId.length > 0 &&
    capturedRefreshToken.length > 0 &&
    capturedUserId === currentUserId &&
    capturedRefreshToken === currentRefreshToken
  );
}
