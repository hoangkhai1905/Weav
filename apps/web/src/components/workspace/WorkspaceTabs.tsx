import { NavLink } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import { useWorkspaceListContext } from '../../hooks/useWorkspace';

const TABS = [
  { key: 'overview', path: '/workspace', end: true },
  { key: 'members', path: '/workspace/members', end: false },
  { key: 'connections', path: '/workspace/connections', end: false },
  { key: 'settings', path: '/workspace/settings', end: false },
] as const;

/** Workspace page header: the workspace name makes it clear what members and connections belong to. */
export function WorkspaceHeader() {
  const { t } = useI18nStore();
  const { activeWorkspace } = useWorkspaceListContext();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg border border-run/30 bg-run-bg text-run">
          <Building2 size={17} aria-hidden="true" />
        </span>
        <h1 className="text-xl font-bold text-foreground">{t('workspace.title')}</h1>
        {activeWorkspace && (
          <span
            data-testid="workspace-header-name"
            className="max-w-[320px] truncate rounded bg-muted px-2 py-0.5 text-xs font-medium text-text-2"
            title={activeWorkspace.name}
          >
            {activeWorkspace.name}
          </span>
        )}
      </div>
      <p className="max-w-2xl text-xs text-text-2">{t('workspace.subtitle')}</p>
    </div>
  );
}

export function WorkspaceTabs() {
  const { t } = useI18nStore();
  return (
    <nav aria-label={t('workspace.tabs_label')} className="flex gap-5 border-b border-border">
      {TABS.map((tab) => (
        <NavLink
          key={tab.key}
          to={tab.path}
          end={tab.end}
          data-testid={`workspace-tab-${tab.key}`}
          className={({ isActive }) =>
            `-mb-px inline-flex h-9 items-center whitespace-nowrap border-b-2 px-0.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              isActive ? 'border-foreground text-foreground' : 'border-transparent text-text-2 hover:text-foreground'
            }`
          }
        >
          {t(`workspace.tab.${tab.key}`)}
        </NavLink>
      ))}
    </nav>
  );
}
