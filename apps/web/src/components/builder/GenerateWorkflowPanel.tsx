import { useEffect, useId, useState } from 'react';
import { connectionApi, type ConnectionResponse } from '../../api/connection.api';
import type { GenerationResponse } from '../../api/workflow-v1.api';
import { useWorkflowGeneration, type ReadyGeneration } from '../ai/useWorkflowGeneration';
import { useI18nStore } from '../../store/useI18nStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

type Question = Extract<GenerationResponse, { status: 'needs_input' }>['questions'][number];

/** Everything except a connection pick can be answered in words. */
const isAnswerable = (question: Question) => question.code !== 'CONNECTION';

/** Plain-language question for a server question; never shows field paths or node ids. */
function questionText(t: (key: string) => string, question: Question): string {
  const lookup = (key: string) => {
    const text = t(key);
    return text === key ? null : text;
  };
  const parts = question.field.split('.');
  const name = parts[parts.length - 1];
  if (question.code === 'CONNECTION') {
    return `${t('ai.question.CONNECTION')} (${lookup(`ai.service.${question.field}`) ?? name.replace(/_/g, ' ')})`;
  }
  if (question.code !== 'VALUE') return t(`ai.question.${question.code}`);
  // "email.send.body" (node type + field) or "<nodeId>.config.body" (a node id from the model).
  const type = question.field.includes('.config.') ? '' : parts.slice(0, -1).join('.');
  return (
    (type ? lookup(`ai.ask.${type}.${name}`) : null) ??
    lookup(`ai.ask.${name}`) ??
    t('ai.ask.generic').replace('{label}', name.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase())
  );
}

interface GenerateWorkflowPanelProps {
  open: boolean;
  onClose: () => void;
  onReady: (result: ReadyGeneration) => void;
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
  const { isPending, error, result, generate, reset } = useWorkflowGeneration();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    reset();
    setAnswers({});
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

  const questions = result?.status === 'needs_input' ? result.questions.filter(isAnswerable) : [];
  const canSubmit = !isPending && prompt.trim() !== '' && questions.every((question) => answers[question.field]?.trim());

  const handleGenerate = async () => {
    if (!canSubmit) return;
    const given = Object.fromEntries(Object.entries(answers).filter(([, value]) => value.trim()));
    const generated = await generate({
      prompt: prompt.trim(),
      answers: given,
      connections: {
        ...(sheetsConnection ? { 'google.sheets': sheetsConnection } : {}),
        ...(emailConnection ? { 'email.send': emailConnection } : {}),
      },
    });
    if (generated?.status === 'ready') onReady(generated);
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
            <ul className="space-y-2" data-testid="generate-questions">
              {result.questions.map((question, index) => (
                <li key={`${question.code}-${question.field}-${index}`} className="rounded border border-warn/30 bg-warn-bg px-2.5 py-1.5 text-[11px] text-warn">
                  <label htmlFor={`${promptId}-q${index}`} className="block font-medium">{questionText(t, question)}</label>
                  {isAnswerable(question) ? (
                    <input
                      id={`${promptId}-q${index}`}
                      type="text"
                      maxLength={1000}
                      value={answers[question.field] ?? ''}
                      onChange={(event) => setAnswers((current) => ({ ...current, [question.field]: event.target.value }))}
                      className="mt-1 w-full rounded border border-border bg-card px-2.5 py-1.5 text-xs text-foreground"
                    />
                  ) : null}
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
              disabled={!canSubmit}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {questions.length ? t('ai.continue') : t('ai.generate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
