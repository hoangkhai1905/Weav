import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';

/** Neutral empty state with a shortcut to create the first workspace. */
export function NoWorkspaceNotice() {
  const { t } = useI18nStore();
  return (
    <div data-testid="no-workspace-notice" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
      <p>{t('msg.create_or_join_a_workspace_before_using')}</p>
      <Link
        to="/workspace"
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus size={14} aria-hidden="true" />
        {t('workspace.create')}
      </Link>
    </div>
  );
}
