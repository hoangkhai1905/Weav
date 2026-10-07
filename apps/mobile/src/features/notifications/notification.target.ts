import type {
  NotificationItem,
  NotificationSessionScope,
  NotificationTarget,
} from '../../domain/notification/notification.types';
import type { PageResult, Workspace } from '../../domain/workspace/workspace.types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export type SafeNotificationRoute =
  | `/(app)/workflows/${string}`
  | `/(app)/executions/${string}`
  | '/(app)/workspace'
  | '/(app)/connections'
  | '/(app)/settings';

export function getSafeNotificationRoute(value: unknown): SafeNotificationRoute | null {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return null;
  const target = value as Record<string, unknown>;
  switch (target.kind) {
    case 'WORKFLOW':
      return isUuid(target.workspaceId) && isUuid(target.workflowId)
        ? `/(app)/workflows/${target.workflowId}`
        : null;
    case 'EXECUTION':
      // CONTRACT LIMITATION: the notification has no workflowId, so it opens the lookup screen,
      // which resolves it via executionRepository.findWorkflowIdForExecution.
      return isUuid(target.workspaceId) && isUuid(target.executionId)
        ? `/(app)/executions/lookup/${target.executionId}`
        : null;
    case 'WORKSPACE':
      return isUuid(target.workspaceId) ? '/(app)/workspace' : null;
    case 'CONNECTION':
      return isUuid(target.workspaceId) && isUuid(target.connectionId)
        ? '/(app)/connections'
        : null;
    case 'SECURITY_SETTINGS':
      return '/(app)/settings';
    case 'NONE':
    default:
      return null;
  }
}

export interface NotificationTargetNavigatorDependencies {
  isSessionCurrent(scope: NotificationSessionScope): boolean;
  authorizeWorkspace(workspaceId: string, signal: AbortSignal): Promise<{ id: string }>;
  loadWorkspaces(
    signal: AbortSignal,
    scope: NotificationSessionScope,
  ): Promise<PageResult<Workspace>>;
  selectWorkspace(
    workspaceId: string,
    workspaces: PageResult<Workspace>,
    scope: NotificationSessionScope,
  ): void;
  clearDestinationCache(target: NotificationTarget, scope: NotificationSessionScope): void;
  navigate(path: SafeNotificationRoute): void;
  onUnavailable?(): void;
}

export type NotificationNavigationResult =
  | 'navigated'
  | 'ignored'
  | 'unavailable'
  | 'stale'
  | 'superseded';

export function createNotificationTargetNavigator(
  dependencies: NotificationTargetNavigatorDependencies,
) {
  let attemptId = 0;
  let activeController: AbortController | null = null;

  return {
    async navigate(
      notification: Pick<NotificationItem, 'eventType' | 'target'>,
      scope: NotificationSessionScope,
    ): Promise<NotificationNavigationResult> {
      if (notification.eventType === 'workspace.member_removed') return 'ignored';
      const route = getSafeNotificationRoute(notification.target);
      if (!route) return 'ignored';
      if (!dependencies.isSessionCurrent(scope)) return 'stale';

      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const thisAttempt = ++attemptId;
      const current = () =>
        thisAttempt === attemptId &&
        !controller.signal.aborted &&
        dependencies.isSessionCurrent(scope);
      const superseded = () => thisAttempt !== attemptId || controller.signal.aborted;
      const workspaceId =
        'workspaceId' in notification.target ? notification.target.workspaceId : null;

      if (workspaceId) {
        let authorized: { id: string };
        try {
          authorized = await dependencies.authorizeWorkspace(workspaceId, controller.signal);
        } catch {
          if (superseded()) return 'superseded';
          if (!dependencies.isSessionCurrent(scope)) return 'stale';
          dependencies.onUnavailable?.();
          return 'unavailable';
        }
        if (superseded()) return 'superseded';
        if (!current()) return 'stale';
        if (authorized?.id !== workspaceId) {
          dependencies.onUnavailable?.();
          return 'unavailable';
        }

        let visibleWorkspaces: PageResult<Workspace>;
        try {
          visibleWorkspaces = await dependencies.loadWorkspaces(controller.signal, scope);
        } catch {
          if (superseded()) return 'superseded';
          if (!dependencies.isSessionCurrent(scope)) return 'stale';
          dependencies.onUnavailable?.();
          return 'unavailable';
        }
        if (superseded()) return 'superseded';
        if (!current()) return 'stale';
        if (!visibleWorkspaces.items.some((workspace) => workspace.id === workspaceId)) {
          dependencies.onUnavailable?.();
          return 'unavailable';
        }
        dependencies.selectWorkspace(workspaceId, visibleWorkspaces, scope);
      }

      if (!current()) return superseded() ? 'superseded' : 'stale';
      dependencies.clearDestinationCache(notification.target, scope);
      if (!current()) return superseded() ? 'superseded' : 'stale';
      dependencies.navigate(route);
      return 'navigated';
    },
  };
}
