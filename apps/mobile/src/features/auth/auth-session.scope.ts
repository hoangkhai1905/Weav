import type { NotificationSessionScope } from '../../domain/notification/notification.types';
import { useAuthStore } from '../../stores/auth.store';

export function captureAuthSessionScope(): NotificationSessionScope | null {
  const auth = useAuthStore.getState();
  if (!auth.isAuthenticated || !auth.user?.id) return null;
  return { userId: auth.user.id, generation: auth.sessionGeneration };
}

export function isAuthSessionScopeCurrent(
  scope: NotificationSessionScope | null | undefined,
): scope is NotificationSessionScope {
  if (!scope) return false;
  const auth = useAuthStore.getState();
  return (
    auth.isAuthenticated &&
    auth.user?.id === scope.userId &&
    auth.sessionGeneration === scope.generation
  );
}
