import { useState } from 'react';
import { Check, Copy, Loader2, Save } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import { statusBadgeClass, type StatusTone } from '../common/statusBadgeClass';
import type { WorkflowDefinition } from '../../types/workflow.types';

interface Props {
  workflow: WorkflowDefinition;
  name: string;
  description: string;
  dirty: boolean;
  saving: boolean;
  workspaceName: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSave: () => void;
}

const field =
  'w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-[13px] text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60';

/** Only fields the draft PUT persists (name, description) plus read-only workflow info. */
export function WorkflowSettingsPanel({
  workflow,
  name,
  description,
  dirty,
  saving,
  workspaceName,
  onNameChange,
  onDescriptionChange,
  onSave,
}: Props) {
  const { t, language } = useI18nStore();
  const [copied, setCopied] = useState(false);
  const locale = language === 'VI' ? 'vi-VN' : 'en-US';
  const when = (iso: string) => (Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString(locale) : '—');
  const statusTone: StatusTone = workflow.status === 'PUBLISHED' ? 'ok' : 'pause';
  const statusLabel = workflow.status === 'PUBLISHED' ? t('workflows.status_on') : workflow.status === 'PAUSED' ? t('workflows.tab_paused') : t('workflows.tab_draft');

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(workflow.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div data-testid="workflow-settings" className="mx-auto w-full max-w-[640px] space-y-8 px-5 py-8">
      <section aria-labelledby="wf-settings-general" className="space-y-4">
        <h2 id="wf-settings-general" className="text-sm font-semibold text-foreground">{t('builder.settings.general')}</h2>
        <div>
          <label htmlFor="wf-settings-name" className="mb-1 block text-xs font-medium text-text-2">{t('builder.settings.name')}</label>
          <input id="wf-settings-name" data-testid="workflow-settings-name" value={name} maxLength={255} onChange={(e) => onNameChange(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="wf-settings-description" className="mb-1 block text-xs font-medium text-text-2">{t('builder.settings.description')}</label>
          <textarea id="wf-settings-description" data-testid="workflow-settings-description" rows={4} value={description} onChange={(e) => onDescriptionChange(e.target.value)} className={`${field} resize-y`} />
        </div>
        <button
          type="button"
          data-testid="workflow-settings-save"
          onClick={onSave}
          disabled={!dirty || saving || !name.trim()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:border-primary-hover hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}
          {t('builder.settings.save')}
        </button>
      </section>

      <section aria-labelledby="wf-settings-info" className="space-y-3">
        <h2 id="wf-settings-info" className="text-sm font-semibold text-foreground">{t('builder.settings.info')}</h2>
        <dl className="divide-y divide-border rounded-lg border border-border text-[13px]">
          <div className="flex items-center justify-between gap-4 px-3 py-2.5">
            <dt className="text-text-2">{t('builder.settings.id')}</dt>
            <dd className="flex min-w-0 items-center gap-2">
              <span data-testid="workflow-settings-id" className="truncate font-mono text-xs text-foreground">{workflow.id}</span>
              <button
                type="button"
                onClick={() => void copyId()}
                aria-label={t('builder.settings.copy_id')}
                title={t('builder.settings.copy_id')}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {copied ? <Check size={14} className="text-ok" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              </button>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-3 py-2.5">
            <dt className="text-text-2">{t('builder.settings.status')}</dt>
            <dd><span className={statusBadgeClass(statusTone)}>{statusLabel}</span></dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-3 py-2.5">
            <dt className="text-text-2">{t('builder.settings.workspace')}</dt>
            <dd className="truncate text-foreground">{workspaceName || '—'}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-3 py-2.5">
            <dt className="text-text-2">{t('builder.settings.created')}</dt>
            <dd className="tabular-nums text-foreground">{when(workflow.createdAt)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-3 py-2.5">
            <dt className="text-text-2">{t('builder.settings.updated')}</dt>
            <dd className="tabular-nums text-foreground">{when(workflow.updatedAt)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
