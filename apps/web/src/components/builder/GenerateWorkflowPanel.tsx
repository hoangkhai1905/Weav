import { useEffect, useId, useState } from 'react';
import { connectionApi, type ConnectionResponse } from '../../api/connection.api';
import { workflowApi } from '../../api/workflow.api';
import { WorkflowApiError, type GenerationResponse } from '../../api/workflow-v1.api';
import { useI18nStore } from '../../store/useI18nStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { tr } from '../../lib/i18n/tr';

type ReadyResult = Extract<GenerationResponse, { status: 'ready' }>;

interface GenerateWorkflowPanelProps {
  open: boolean;
  onClose: () => void;
  onReady: (result: ReadyResult) => void;
  /** Prefills the description (e.g. handed over from the Create with AI page). */
  initialPrompt?: string;
}

export function GenerateWorkflowPanel({ open, onClose, onReady, initialPrompt = '' }: GenerateWorkflowPanelProps) {
  const { t } = useI18nStore();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const promptId = useId();
  const sheetsConnectionId = useId();
  const emailConnectionId = useId();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [sheetsConnection, setSheetsConnection] = useState('');
  const [emailConnection, setEmailConnection] = useState('');
  const [connections, setConnections] = useState<ConnectionResponse[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResponse | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setError(null);
    setResult(null);
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

  const sheetsConnections = connections.filter(
    (connection) => connection.provider === 'GOOGLE_SHEETS' && connection.status === 'ACTIVE',
  );
  const emailConnections = connections.filter(
    (connection) => connection.provider === 'GMAIL' && connection.status === 'ACTIVE',
  );

  const handleGenerate = async () => {
    if (isPending || !prompt.trim()) return;
    setIsPending(true);
    setError(null);
    setResult(null);
    try {
      const generated = await workflowApi.generateWorkflow({
        prompt: prompt.trim(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...((sheetsConnection || emailConnection)
          ? {
              connections: {
                ...(sheetsConnection ? { 'google.sheets': sheetsConnection } : {}),
                ...(emailConnection ? { 'email.send': emailConnection } : {}),
              },
            }
          : {}),
      });
      if (generated.status === 'ready') {
        onReady(generated);
        return;
      }
      setResult(generated);
    } catch (unknown) {
      if (unknown instanceof WorkflowApiError) {
        if (unknown.status === 429) setError(tr('msg.too_many_requests_wait_a_minute'));
        else if (unknown.status === 503) setError(tr('msg.ai_is_unavailable_right_now'));
        else if (unknown.status === 504) setError(tr('msg.ai_took_too_long_try_a_shorter'));
        else setError(unknown.message);
      } else {
        setError(unknown instanceof Error ? unknown.message : tr('msg.the_workflow_request_could_not_be_completed'));
      }
    } finally {
      setIsPending(false);
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
            <label htmlFor={promptId} className="mb-1 block text-[11px] font-medium text-text-2">{t('ai.describe_workflow')}</label>
            <textarea
              id={promptId}
              rows={4}
              maxLength={4000}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="w-full resize-y rounded border border-border bg-subtle px-2.5 py-1.5 text-xs text-foreground"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={sheetsConnectionId} className="mb-1 block text-[11px] font-medium text-text-2">{t('ai.connection_sheets')}</label>
              <select
                id={sheetsConnectionId}
                value={sheetsConnection}
                onChange={(event) => setSheetsConnection(event.target.value)}
                className="w-full rounded border border-border bg-subtle px-2.5 py-1.5 text-xs text-foreground"
              >
                <option value="">{t('ai.connection_none')}</option>
                {sheetsConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>{connection.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={emailConnectionId} className="mb-1 block text-[11px] font-medium text-text-2">{t('ai.connection_email')}</label>
              <select
                id={emailConnectionId}
                value={emailConnection}
                onChange={(event) => setEmailConnection(event.target.value)}
                className="w-full rounded border border-border bg-subtle px-2.5 py-1.5 text-xs text-foreground"
              >
                <option value="">{t('ai.connection_none')}</option>
                {emailConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>{connection.name}</option>
                ))}
              </select>
            </div>
          </div>
          {error ? <p role="alert" className="text-[11px] text-err">{error}</p> : null}
          {result?.status === 'needs_input' ? (
            <ul className="space-y-1.5">
              {result.questions.map((question, index) => (
                <li key={`${question.code}-${index}`} className="rounded border border-warn/30 bg-warn-bg px-2.5 py-1.5 text-[11px] text-warn">
                  <span className="font-medium">{t(`ai.question.${question.code}`)}</span>
                  <span className="ml-1.5 text-muted-foreground">{question.field}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {result?.status === 'unsupported' ? (
            <ul className="space-y-1.5">
              {result.reasons.map((reason, index) => (
                <li key={`${reason.code}-${index}`} className="rounded border border-border bg-subtle px-2.5 py-1.5 text-[11px] text-text-2">
                  {t(`ai.reason.${reason.code}`)}
                </li>
              ))}
            </ul>
          ) : null}
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
              disabled={isPending || !prompt.trim()}
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
