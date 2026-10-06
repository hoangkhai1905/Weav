import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceApiError, workspaceApi, type WorkspaceSummary } from '../api/workspace.api';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { showErrorToast } from '../lib/feedback/toast';
import {
  captureNotificationSession,
  isCurrentNotificationSession,
  notificationSessionKey,
} from '../lib/notifications/session';
import type { NotificationInboxItem, NotificationTarget } from '../types/notification.types';

function targetWorkspaceId(target: NotificationTarget) {
  return 'workspaceId' in target ? target.workspaceId : null;
}

export function useNotificationTargetNavigator() {
  const navigate = useNavigate();
  const attemptId = useRef(0);
  const pendingController = useRef<AbortController | null>(null);

  useEffect(() => () => {
    attemptId.current += 1;
    pendingController.current?.abort();
  }, []);

  return useCallback(async (item: NotificationInboxItem) => {
    if (item.eventType === 'workspace.member_removed') return;
    const target = item.target;
    if (target.kind === 'NONE' || target.kind === 'UNKNOWN') return;

    const session = captureNotificationSession();
    if (!session.authenticated || !session.userId) return;
    const attempt = ++attemptId.current;
    pendingController.current?.abort();
    const controller = new AbortController();
    pendingController.current = controller;
    const isCurrentAttempt = () =>
      attemptId.current === attempt && !controller.signal.aborted &&
      isCurrentNotificationSession(session);

    if (target.kind === 'SECURITY_SETTINGS') {
      if (isCurrentAttempt()) navigate('/settings/security');
      return;
    }

    const workspaceId = targetWorkspaceId(target);
    if (!workspaceId) return;
    const sessionKey = notificationSessionKey(session);
    const workspaceState = useWorkspaceStore.getState();
    const workspace = workspaceState.workspaces.find((item) => item.id === workspaceId);
    const isPinnedTarget = workspaceState.notificationTargetWorkspace?.sessionKey === sessionKey &&
      workspaceState.notificationTargetWorkspace.workspace.id === workspaceId;
    if (!workspace || isPinnedTarget) {
      let authorizedWorkspace: WorkspaceSummary;
      try {
        authorizedWorkspace = await workspaceApi.getWorkspace(workspaceId, controller.signal);
      } catch (error) {
        if (isCurrentAttempt()) {
          if (error instanceof WorkspaceApiError && (error.status === 403 || error.status === 404)) {
            useWorkspaceStore.getState().revokeNotificationTargetWorkspace(sessionKey, workspaceId);
          }
          showErrorToast('notif.target_unavailable', session);
        }
        return;
      }
      if (!isCurrentAttempt()) return;
      useWorkspaceStore.getState().authorizeNotificationTargetWorkspace(sessionKey, authorizedWorkspace);
    }
    if (!isCurrentAttempt()) return;

    useWorkspaceStore.getState().selectWorkspace(workspaceId);
    const route = target.kind === 'WORKFLOW'
      ? `/workflows/${encodeURIComponent(target.workflowId)}`
      : target.kind === 'EXECUTION'
        ? `/executions/${encodeURIComponent(target.executionId)}`
        : target.kind === 'WORKSPACE'
          ? '/workspace'
          : '/workspace/connections';
    navigate(route);
  }, [navigate]);
}
