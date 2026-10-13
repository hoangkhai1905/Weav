import { NavLink } from 'react-router-dom';
import { useI18nStore } from '../../store/useI18nStore';
import { useWorkspaceListContext } from '../../hooks/useWorkspace';
import { FOCUS_RING } from '../../lib/uiClasses';

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
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground">{t('workspace.title')}</h1>
        {activeWorkspace && (
          <span
            data-testid="workspace-header-name"
            className="max-w-[320px] truncate rounded bg-subtle px-2 py-0.5 text-[13px] font-medium text-text-2"
            title={activeWorkspace.name}
          >
            {activeWorkspace.name}
          </span>
        )}
      </div>
      <p className="max-w-2xl text-text-2">{t('workspace.subtitle')}</p>
    </div>
  );
}

export function WorkspaceTabs() {
  const { t } = useI18nStore();
  return (
    <nav aria-label={t('workspace.tabs_label')} className="flex gap-6 overflow-x-auto border-b border-border">
      {TABS.map((tab) => (
        <NavLink
          key={tab.key}
          to={tab.path}
          end={tab.end}
          data-testid={`workspace-tab-${tab.key}`}
          className={({ isActive }) =>
            `-mb-px inline-flex h-10 items-center whitespace-nowrap border-b-2 px-0.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
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
