import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Loader2 } from 'lucide-react';
import { resetWorkflowWorkspaceCache } from '../../api/workflow-v1.api';
import { validateWorkspaceName, workspaceApi } from '../../api/workspace.api';
import { workspaceKeys } from '../../hooks/useWorkspace';
import { useI18nStore } from '../../store/useI18nStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

interface FirstWorkspaceCardProps {
  userId: string | null;
  /** Called after the workspace exists and is selected, so the page can load its data. */
  onCreated: () => void;
}

/** Shown instead of the dashboard when the signed-in user has no workspace yet. */
export function FirstWorkspaceCard({ userId, onCreated }: FirstWorkspaceCardProps) {
  const { t } = useI18nStore();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isCreating) return;
    if (validateWorkspaceName(name, true)) {
      setError(t(name.trim().length > 255 ? 'workspace.error.name_too_long' : 'workspace.error.name_required'));
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      const created = await workspaceApi.createWorkspace(name.trim());
      const store = useWorkspaceStore.getState();
      store.setWorkspaces([...store.workspaces, created]);
      store.selectWorkspace(created.id);
      resetWorkflowWorkspaceCache();
      if (userId) await queryClient.invalidateQueries({ queryKey: workspaceKeys.list(userId) });
      onCreated();
    } catch (unknown) {
      setError(unknown instanceof Error ? unknown.message : t('hp.onboarding.failed'));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section data-testid="first-workspace-card" aria-labelledby={`${inputId}-title`} className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-6">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-run-bg text-run"><Building2 size={22} aria-hidden="true" /></span>
      <h2 id={`${inputId}-title`} className="mt-4 text-lg font-bold text-foreground">{t('hp.onboarding.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('hp.onboarding.description')}</p>
      <form onSubmit={(event) => void handleSubmit(event)} className="mt-5 space-y-3">
        <label htmlFor={inputId} className="block text-xs font-medium text-text-2">{t('hp.onboarding.name_label')}</label>
        <input
          id={inputId}
          type="text"
          maxLength={255}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('hp.onboarding.name_placeholder')}
          className="h-10 w-full rounded-xl border border-border bg-subtle px-3.5 text-sm text-foreground focus:border-primary/40 focus:outline-none focus:ring-4 focus:ring-primary/10"
        />
        {error ? <p role="alert" className="text-xs text-err">{error}</p> : null}
        <button
          type="submit"
          disabled={isCreating}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {isCreating ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
          {t('hp.onboarding.submit')}
        </button>
      </form>
    </section>
  );
}
