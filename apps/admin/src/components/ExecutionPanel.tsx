import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, LoaderCircle, X } from 'lucide-react';
import { getExecution, type ExecutionStep } from '../api/executions';
import { useFormatDateTime } from '../lib/format';
import { durationBetween, enumLabel, formatDuration, nodeTypeKey } from '../lib/executions';
import { useT } from '../lib/i18n';
import { btnCls } from '../lib/ui';
import { RunStatusBadge } from './RunStatusBadge';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px]">{children}</dd>
    </div>
  );
}

function ErrorText({ code, message }: { code: string | null; message: string | null }) {
  if (!code && !message) return null;
  return (
    <p className="mt-1 break-words text-xs text-err">
      {code && <span className="font-mono font-medium">{code}</span>}
      {code && message && ' · '}
      {message}
    </p>
  );
}

function StepItem({ step }: { step: ExecutionStep }) {
  const t = useT();
  const key = nodeTypeKey(step.nodeType);
  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {key ? <span className="font-medium" title={step.nodeType}>{t(key)}</span> : <span className="font-mono text-xs text-muted-foreground">{step.nodeType}</span>}
        <RunStatusBadge status={step.status} />
      </div>
      <p className="mt-1 text-xs text-text-2">
        {t('exec.attempts', { count: step.attemptCount })} · {formatDuration(durationBetween(step.startedAt, step.finishedAt))}
      </p>
      <ErrorText code={step.errorCode} message={step.errorMessage} />
    </li>
  );
}

interface ExecutionPanelProps {
  executionId: string;
  workspaceName: string;
  onClose: () => void;
}

/** Read-only side panel for one run: summary plus its steps. Escape or the close button dismisses it. */
export function ExecutionPanel({ executionId, workspaceName, onClose }: ExecutionPanelProps) {
  const t = useT();
  const formatDateTime = useFormatDateTime();
  const closeRef = useRef<HTMLButtonElement>(null);
  const run = useQuery({ queryKey: ['admin', 'execution', executionId], queryFn: () => getExecution(executionId) });
  const data = run.data;

  // Move focus in on open and give it back to the row that opened the panel on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-label={t('exec.panel_title')} className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-background p-5 shadow-lg">
        <div className="flex items-start gap-3">
          <h2 className="min-w-0 flex-1 break-words text-base font-semibold">{data?.workflowName ?? t('exec.panel_title')}</h2>
          <button ref={closeRef} type="button" className={btnCls} onClick={onClose} aria-label={t('common.close')}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {run.isLoading && (
          <div role="status" className="flex justify-center py-10">
            <LoaderCircle size={20} className="animate-spin text-muted-foreground" aria-label={t('common.loading')} />
          </div>
        )}
        {run.isError && (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-err-border bg-err-bg p-3 text-[13px] text-err">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{t('exec.panel_error')}</span>
            <button type="button" className="font-medium underline" onClick={() => void run.refetch()}>{t('common.retry')}</button>
          </div>
        )}

        {data && (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-3">
              <Field label={t('exec.col_status')}><RunStatusBadge status={data.status} /></Field>
              <Field label={t('exec.col_trigger')}>{enumLabel(t, 'run.trigger', data.triggerType)}</Field>
              <Field label={t('exec.col_workspace')}>{workspaceName}</Field>
              <Field label={t('exec.col_duration')}>{formatDuration(durationBetween(data.startedAt, data.finishedAt))}</Field>
              <Field label={t('exec.started')}>{formatDateTime(data.startedAt ?? data.createdAt)}</Field>
              <Field label={t('exec.finished')}>{formatDateTime(data.finishedAt)}</Field>
            </dl>
            <ErrorText code={data.errorCode} message={data.errorMessage} />

            <h3 className="mt-6 text-sm font-semibold">{t('exec.steps')}</h3>
            {data.steps.length === 0 ? (
              <p className="mt-2 text-[13px] text-text-2">{t('exec.steps_empty')}</p>
            ) : (
              <ol className="mt-2 space-y-2" aria-label={t('exec.steps')}>
                {data.steps.map((step) => <StepItem key={step.nodeId} step={step} />)}
              </ol>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
