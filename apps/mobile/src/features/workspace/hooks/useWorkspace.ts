import { useQuery } from '@tanstack/react-query';
import { workspaceRepository } from '../../../infrastructure/repository-factory';

export function useWorkspace() {
  const workspaceQuery = useQuery({
    queryKey: ['workspace'],
    queryFn: () => workspaceRepository.getWorkspace(),
  });

  const membersQuery = useQuery({
    queryKey: ['workspace', 'members'],
    queryFn: () => workspaceRepository.getMembers(),
  });

  return {
    workspace: workspaceQuery.data,
    isLoadingWorkspace: workspaceQuery.isLoading,
    members: membersQuery.data || [],
    isLoadingMembers: membersQuery.isLoading,
  };
}
