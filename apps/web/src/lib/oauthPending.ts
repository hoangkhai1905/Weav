// Context kept in sessionStorage across the Google OAuth redirect (see ConnectionsPage callback handling).
export const OAUTH_PENDING_CONTEXT_KEY = "weav.workspaceConnectionOAuth.pending";
export const OAUTH_PENDING_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;

export interface OAuthPendingContext {
  userId: string;
  workspaceId: string;
  connectionId: string;
  createdAt: number;
  /** Builder step to reopen after a verified authorization; anything else falls back to the Connections page. */
  returnTo?: string;
}

// Only an in-app builder step is a valid return target (no open redirect).
const OAUTH_RETURN_TO_PATTERN = /^\/workflows\/[A-Za-z0-9-]+\?step=[A-Za-z0-9_.%-]+$/;

export function storeOAuthPendingContext(context: OAuthPendingContext) {
  sessionStorage.setItem(OAUTH_PENDING_CONTEXT_KEY, JSON.stringify(context));
}

export function parseOAuthPendingContext(
  value: string | null,
): OAuthPendingContext | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as OAuthPendingContext).userId === "string" &&
      typeof (parsed as OAuthPendingContext).workspaceId === "string" &&
      typeof (parsed as OAuthPendingContext).connectionId === "string" &&
      typeof (parsed as OAuthPendingContext).createdAt === "number" &&
      Number.isFinite((parsed as OAuthPendingContext).createdAt)
    ) {
      const { userId, workspaceId, connectionId, createdAt, returnTo } =
        parsed as OAuthPendingContext;
      return typeof returnTo === "string" && OAUTH_RETURN_TO_PATTERN.test(returnTo)
        ? { userId, workspaceId, connectionId, createdAt, returnTo }
        : { userId, workspaceId, connectionId, createdAt };
    }
  } catch {
    // Invalid session data is ignored and removed by the callback handler.
  }
  return null;
}
