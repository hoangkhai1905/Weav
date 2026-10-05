import { Link } from 'react-router-dom';
import { ChevronsUpDown } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import { useWorkspaceListContext } from '../../hooks/useWorkspace';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

/** Workspace picker shown at the top of the sidebar. Keeps the native select for accessibility. */
export function WorkspaceSwitcher() {
  const { t } = useI18nStore();
  const { workspaces, workspacesQuery } = useWorkspaceListContext();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];

  if (workspacesQuery.isPending && workspaces.length === 0) {
    return (
      <span
        data-testid="topbar-workspace-loading"
        role="status"
        className="flex h-9 items-center gap-2 px-2 text-[13px] text-muted-foreground"
      >
        <span className="h-[22px] w-[22px] shrink-0 animate-pulse rounded-md bg-muted" />
        <span className="truncate">{t('topbar.workspace_loading')}</span>
      </span>
    );
  }

  if (workspaces.length > 0) {
    return (
      <div className="min-w-0">
        <div className="relative flex h-9 items-center gap-2 rounded-md px-2 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-subtle">
          <span
            aria-hidden="true"
            className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-foreground text-[11px] font-semibold text-background"
          >
            {initialsOf(active?.name ?? '') || 'W'}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{active?.name}</span>
          <ChevronsUpDown size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
          <label className="sr-only" htmlFor="topbar-workspace-selector">
            {t('topbar.select_workspace')}
          </label>
          <select
            id="topbar-workspace-selector"
            data-testid="topbar-workspace-selector"
            aria-label={t('topbar.select_workspace')}
            aria-busy={workspacesQuery.isFetching}
            value={activeWorkspaceId ?? ''}
            onChange={(event) => selectWorkspace(event.target.value || null)}
            title={t('topbar.select_workspace')}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-md bg-transparent text-transparent opacity-0 outline-none"
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id} className="text-foreground">
                {workspace.name}
              </option>
            ))}
          </select>
        </div>
        {workspacesQuery.isError && (
          <span
            data-testid="topbar-workspace-error"
            role="alert"
            className="block truncate px-2 text-[11px] text-err"
            title={t('topbar.workspace_load_error')}
          >
            {t('topbar.workspace_load_error')}
          </span>
        )}
      </div>
    );
  }

  if (workspacesQuery.isError) {
    return (
      <div className="flex h-9 items-center gap-1 px-2">
        <span data-testid="topbar-workspace-error" role="alert" className="min-w-0 flex-1 truncate text-xs text-err">
          {t('topbar.workspace_load_error')}
        </span>
        <button
          type="button"
          aria-label={t('topbar.retry_workspace_load')}
          onClick={() => void workspacesQuery.refetch()}
          className="rounded-md px-1.5 py-1 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('topbar.retry')}
        </button>
      </div>
    );
  }

  return (
    <Link
      data-testid="topbar-no-workspace"
      to="/workspace"
      className="flex h-9 items-center rounded-md border border-border-strong px-2 text-[13px] font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate">{t('topbar.no_workspace')}</span>
    </Link>
  );
}
