import type { UserProfile } from '../../domain/auth/auth.types';

export const MAX_DISPLAY_NAME_LENGTH = 120;

export function normalizeDisplayName(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function validateDisplayName(value: string): string | null {
  if (value.trim().length > MAX_DISPLAY_NAME_LENGTH) {
    return `Display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`;
  }
  return null;
}

export function isProfileScopeCurrent(
  capturedUserId: string,
  currentUserId: string | null,
  isAuthenticated: boolean,
): boolean {
  return isAuthenticated && capturedUserId.length > 0 && capturedUserId === currentUserId;
}

export function canApplyProfileResponse(
  capturedUserId: string,
  currentUserId: string | null,
  isAuthenticated: boolean,
  response: UserProfile,
): boolean {
  return (
    isProfileScopeCurrent(capturedUserId, currentUserId, isAuthenticated) &&
    response.id === capturedUserId
  );
}

export function createProfileSubmissionGate() {
  let inFlight = false;

  return {
    tryStart(): boolean {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    finish(): void {
      inFlight = false;
    },
  };
}
