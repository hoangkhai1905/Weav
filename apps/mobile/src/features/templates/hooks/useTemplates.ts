import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { templateRepository } from '../../../infrastructure/repository-factory';
import type { TemplateScope } from '../../../domain/template/template.types';
import { useAuthStore } from '../../../stores/auth.store';
import { getActiveWorkspaceId } from '../../workspace/active-workspace';

export const TEMPLATE_PAGE_SIZE = 20;

// Template reads depend on who is signed in (`owned`, share code), so keys carry the user id at
// index 1 and are dropped on sign-out / account switch (see isAccountScopedQuery).
const useUserId = () => useAuthStore((s) => s.user?.id ?? null);

/** Gallery ("public") or the user's own ("mine") templates, pages of 20; `q` only filters the public tab. */
export function useInfiniteTemplates(scope: TemplateScope, q: string) {
  const userId = useUserId();
  return useInfiniteQuery({
    queryKey: ['templates', userId, scope, q],
    queryFn: ({ pageParam }) =>
      templateRepository.listTemplates(scope, { q, page: pageParam, size: TEMPLATE_PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    // Keep the rows while the search text changes, but never show the other tab's rows.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === scope ? previous : undefined),
    enabled: !!userId,
    staleTime: 5000,
  });
}

export function useTemplate(id: string) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['template', userId, id],
    queryFn: () => templateRepository.getTemplate(id),
    enabled: !!userId && !!id,
    staleTime: 5000,
  });
}

/** Opens a template by its code; the detail is cached so the detail screen shows it at once. */
export function useTemplateByCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => templateRepository.getTemplateByCode(code),
    onSuccess: (detail) => {
      queryClient.setQueryData(['template', useAuthStore.getState().user?.id ?? null, detail.id], detail);
    },
  });
}

/** Copies the template into the active workspace as a new draft workflow. */
export function useUseTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) =>
      templateRepository.useTemplate(id, getActiveWorkspaceId(), name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      // usageCount went up.
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}
