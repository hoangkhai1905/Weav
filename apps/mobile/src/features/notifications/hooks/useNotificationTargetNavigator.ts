import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { workspaceRepository } from '../../../infrastructure/repository-factory';
import { loadAllPages } from '../../workspace/workspace.pagination';
import { workspaceKeys } from '../../workspace/hooks/useWorkspace';
import { useWorkspaceStore } from '../../../stores/workspace.store';
import { translations, useI18nStore } from '../../../stores/i18n.store';
import { useUIStore } from '../../../stores/ui.store';
import { isAuthSessionScopeCurrent } from '../../auth/auth-session.scope';
import {
  createNotificationTargetNavigator,
  type NotificationTargetNavigatorDependencies,
} from '../notification.target';

export function useNotificationTargetNavigator() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const navigatorRef = useRef<ReturnType<typeof createNotificationTargetNavigator> | null>(null);

  if (!navigatorRef.current) {
    const dependencies: NotificationTargetNavigatorDependencies = {
      isSessionCurrent: isAuthSessionScopeCurrent,
      authorizeWorkspace: (workspaceId, signal) =>
        workspaceRepository.getWorkspace(workspaceId, signal),
      loadWorkspaces: async (signal, scope) => {
        const page = await loadAllPages(
          (pageIndex) =>
            workspaceRepository.listWorkspaces({ page: pageIndex, size: 100 }, signal),
          'Notification target workspace list',
          () => isAuthSessionScopeCurrent(scope) && !signal.aborted,
        );
        return page;
      },
      selectWorkspace: (workspaceId, workspaces, scope) => {
        if (!isAuthSessionScopeCurrent(scope)) return;
        queryClient.setQueryData(workspaceKeys.list(scope.userId), workspaces);
        useWorkspaceStore.getState().setWorkspaces(workspaces.items);
        useWorkspaceStore.getState().selectWorkspace(workspaceId);
      },
      clearDestinationCache: (target, scope) => {
        if (target.kind === 'WORKFLOW') {
          queryClient.removeQueries({ queryKey: ['workflow', target.workflowId] });
        } else if (target.kind === 'EXECUTION') {
          queryClient.removeQueries({ queryKey: ['execution', target.executionId] });
        } else if (target.kind === 'WORKSPACE') {
          queryClient.removeQueries({ queryKey: workspaceKeys.detail(scope.userId, target.workspaceId) });
          queryClient.removeQueries({ queryKey: workspaceKeys.members(scope.userId, target.workspaceId) });
        } else if (target.kind === 'CONNECTION') {
          queryClient.removeQueries({ queryKey: ['connections'] });
        }
      },
      navigate: (path) => router.push(path as Href),
      onUnavailable: () => {
        const language = useI18nStore.getState().language;
        useUIStore.getState().showToast({
          type: 'warning',
          title: translations[language]['notif.target_unavailable'],
        });
      },
    };
    navigatorRef.current = createNotificationTargetNavigator(dependencies);
  }

  return navigatorRef.current;
}
