import { useEffect, useId, useState } from 'react';
import { connectionApi, type ConnectionResponse } from '../../api/connection.api';
import { useWorkflowGeneration, type ReadyGeneration } from '../ai/useWorkflowGeneration';
import { autoPickConnections } from '../../lib/autoPickConnections';
import { requiredConnectionProvider } from '../../lib/nodeReadiness';
import { useI18nStore } from '../../store/useI18nStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

interface GenerateWorkflowPanelProps {
  open: boolean;
  onClose: () => void;
  onReady: (result: ReadyGeneration) => void;
}

export function GenerateWorkflowPanel({ open, onClose, onReady }: GenerateWorkflowPanelProps) {
  const { t } = useI18nStore();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const promptId = useId();
  const [prompt, setPrompt] = useState('');
  const [connections, setConnections] = useState<ConnectionResponse[]>([]);
  const { isPending, error, result, generate, reset } = useWorkflowGeneration();
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    reset();
    setConnections([]);
  }

  useEffect(() => {
    if (!open || !activeWorkspaceId) return;
    const controller = new AbortController();
    connectionApi
      .list(activeWorkspaceId, controller.signal)
      .then((items) => setConnections(items))
      .catch(() => setConnections([]));
    return () => controller.abort();
  }, [open, activeWorkspaceId]);

  if (!open) return null;

  const canSubmit = !isPending && prompt.trim() !== '';

  const handleGenerate = async () => {
    if (!canSubmit) return;
    const generated = await generate({ prompt: prompt.trim(), allowBlanks: true });
    if (generated?.status === 'ready') {
      onReady({ ...generated, definition: autoPickConnections(generated.definition, connections, requiredConnectionProvider) as typeof generated.definition });
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={t('ai.generate_with_ai')} className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-4 shadow-pop">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{t('ai.generate_with_ai')}</h2>
          <button type="button" onClick={onClose} aria-label={t('ai.close')} className="rounded p-1 text-muted-foreground hover:bg-subtle hover:text-foreground">
            ×
          </button>
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor={promptId} className="mb-1 block text-[13px] font-medium text-foreground">{t('ai.describe_workflow')}</label>
            <textarea
              id={promptId}
              rows={4}
              maxLength={4000}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="w-full resize-y rounded border border-border bg-subtle px-2.5 py-1.5 text-xs text-foreground"
            />
          </div>
          <div aria-live="polite" className="space-y-3">
            {error ? <p role="alert" className="text-[11px] text-err">{error}</p> : null}
            {result?.status === 'needs_input' || result?.status === 'unsupported' ? (
              <div className="rounded border border-warn/30 bg-warn-bg px-2.5 py-1.5 text-[11px] text-foreground">
                <p className="font-medium">{t('hp.ai.unclear')}</p>
                <ul className="mt-1 list-disc pl-4 text-text-2">
                  {result.status === 'needs_input'
                    ? result.questions.map((question, index) => <li key={`${question.code}-${index}`}>{t(`ai.question.${question.code}`)}</li>)
                    : result.reasons.map((reason, index) => <li key={`${reason.code}-${index}`}>{t(`ai.reason.${reason.code}`)}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-text-2 hover:bg-subtle"
            >
              {t('ai.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={!canSubmit}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('ai.generate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
