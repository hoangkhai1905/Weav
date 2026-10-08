import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceStore } from '../../../stores/workspace.store';

/** Query roots whose keys carry a workspaceId: they are refreshed when the workspace changes. */
export const WORKSPACE_SCOPED_QUERY_ROOTS = [
  'workflows',
  'workflow',
  'executions',
  'execution',
  'connections',
  'workflow-permissions',
  'assistant',
] as const;

/** Select a workspace and refresh everything scoped to a workspace (keys already include its id). */
export function useSwitchWorkspace(): (workspaceId: string) => void {
  const queryClient = useQueryClient();
  return (workspaceId) => {
    if (useWorkspaceStore.getState().activeWorkspaceId === workspaceId) return;
    useWorkspaceStore.getState().selectWorkspace(workspaceId);
    for (const root of WORKSPACE_SCOPED_QUERY_ROOTS) {
      void queryClient.invalidateQueries({ queryKey: [root] });
    }
  };
}
