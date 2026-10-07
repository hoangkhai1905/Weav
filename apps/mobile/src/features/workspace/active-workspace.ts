import { useWorkspaceStore } from '../../stores/workspace.store';

/** React hook form: the workspace every workflow/execution/connection/AI call is scoped to. */
export function useActiveWorkspaceId(): string | null {
  return useWorkspaceStore((s) => s.activeWorkspaceId);
}

/**
 * Non-hook form for mutation functions. Returns '' when no workspace is selected so the
 * request builders reject it ("Invalid workspace id.") instead of calling a wrong route.
 */
export function getActiveWorkspaceId(): string {
  return useWorkspaceStore.getState().activeWorkspaceId ?? '';
}
