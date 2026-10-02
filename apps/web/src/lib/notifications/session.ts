import { getStoredAuthToken } from '../../api/ocr.api';
import { useAuthStore } from '../../store/useAuthStore';

export interface NotificationSessionSnapshot {
  userId: string | null;
  token: string | null;
  authenticated: boolean;
}

export function captureNotificationSession(): NotificationSessionSnapshot {
  const state = useAuthStore.getState();
  return {
    userId: state.user?.id ?? null,
    token: getStoredAuthToken(),
    authenticated: state.isAuthenticated,
  };
}

export function isCurrentNotificationSession(
  session: NotificationSessionSnapshot,
): boolean {
  const current = captureNotificationSession();
  return Boolean(
    session.authenticated && current.authenticated &&
    session.userId && current.userId === session.userId &&
    current.token === session.token,
  );
}

export function notificationSessionKey(session: NotificationSessionSnapshot) {
  let tokenHash = 2166136261;
  if (session.token) {
    for (let index = 0; index < session.token.length; index += 1) {
      tokenHash = Math.imul(tokenHash ^ session.token.charCodeAt(index), 16777619);
    }
  }
  return `${session.userId ?? 'anonymous'}:${session.token ? tokenHash >>> 0 : 'mock'}`;
}
