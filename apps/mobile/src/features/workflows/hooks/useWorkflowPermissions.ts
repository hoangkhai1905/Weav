import { useQuery } from '@tanstack/react-query';
import { workspaceRepository } from '../../../infrastructure/repository-factory';
import { useAuthStore } from '../../../stores/auth.store';
import { useActiveWorkspaceId } from '../../workspace/active-workspace';

export interface WorkflowPermissions {
  /** False until the caller's membership record is known: actions stay hidden meanwhile. */
  loaded: boolean;
  canPublish: boolean;
  /** Pause, resume and delete all need WORKFLOW_MANAGE_STATE on the backend. */
  canManageState: boolean;
}

const NONE: WorkflowPermissions = { loaded: false, canPublish: false, canManageState: false };

/**
 * The caller's own membership row (GET members?search=<email>) decides the two optional
 * permissions; an OWNER has all of them. Run/edit/monitor are default member permissions.
 */
export function useWorkflowPermissions(): WorkflowPermissions {
  const workspaceId = useActiveWorkspaceId();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const email = useAuthStore((s) => s.user?.email ?? '');
  const { data } = useQuery({
    queryKey: ['workflow-permissions', workspaceId, userId],
    enabled: !!workspaceId && !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<WorkflowPermissions> => {
      const page = await workspaceRepository.getMembers(workspaceId ?? '', { search: email, size: 100 });
      const me = page.items.find((m) => m.id === userId);
      if (!me) return NONE;
      const owner = me.role === 'OWNER';
      return {
        loaded: true,
        canPublish: owner || me.canPublishWorkflow,
        canManageState: owner || me.canManageWorkflowState,
      };
    },
  });
  return data ?? NONE;
}
