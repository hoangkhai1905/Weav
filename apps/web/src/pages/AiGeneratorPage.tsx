import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { connectionApi, type ConnectionProvider, type ConnectionResponse } from '../api/connection.api';
import { definitionToCanvas, workflowV1Api } from '../api/workflow-v1.api';
import { useWorkflowGeneration, type ReadyGeneration } from '../components/ai/useWorkflowGeneration';
import { useNotificationMilestoneRefresh } from '../hooks/useNotificationMilestoneRefresh';
import { showSuccessToast } from '../lib/feedback/toast';
import { NODE_SCHEMAS } from '../lib/nodeSchemas';
import { NODE_NAME_KEYS, nodeLabel } from '../lib/nodeLabels';
import { errorFieldLabel } from '../lib/executions/runView';
import { captureNotificationSession, isCurrentNotificationSession } from '../lib/notifications/session';
import { useAuthStore } from '../store/useAuthStore';
import { useI18nStore } from '../store/useI18nStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

type Question = { code: string; field: string };

// Which connection provider each node type needs, to offer the right connections for a CONNECTION question.
const PROVIDER_BY_NODE: Record<string, ConnectionProvider> = {
  'google.sheets': 'GOOGLE_SHEETS',
  'google.calendar': 'GOOGLE_CALENDAR',
  'google.drive': 'GOOGLE_DRIVE',
  'email.send': 'GMAIL',
  'trigger.gmail': 'GMAIL',
  'telegram.send_message': 'TELEGRAM',
  'trigger.telegram': 'TELEGRAM',
  'http.request': 'HTTP',
};

/** "email.send.to" / "send_email.config.to" -> the node type when the field names one, plus the config key. */
const splitQuestionField = (field: string) => {
  const type = Object.keys(NODE_NAME_KEYS).find((candidate) => field === candidate || field.startsWith(`${candidate}.`));
  return { type, key: field.split('.').pop() ?? field };
};

const STARTER_KEYS = ['gmail_drive', 'webhook_sheets', 'schedule_telegram', 'telegram_reply'] as const;
const RECIPIENT_FIELD = /(^|[._])(to|cc|bcc|recipient|recipients)$/i;

const fieldClass = 'w-full rounded-md border border-border bg-subtle px-3 py-2 text-sm text-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10';
const primaryButton = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function AiGeneratorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18nStore();
  const userEmail = useAuthStore((state) => state.user?.email ?? '');
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const refreshNotifications = useNotificationMilestoneRefresh();
  const promptId = useId();
  const { isPending, error, result, generate, reset } = useWorkflowGeneration();

  const [prompt, setPrompt] = useState<string>((location.state as { initialPrompt?: string } | null)?.initialPrompt ?? '');
  const [connections, setConnections] = useState<ConnectionResponse[]>([]);
  // Answers typed for the current needs_input round, keyed by question index.
  const [answers, setAnswers] = useState<Record<number, string>>({});
  // Connection picked per node type, sent as `connections` on the next request.
  const [picked, setPicked] = useState<Record<string, string>>({});
  // Answers from earlier rounds, by field. Sent as `answers` with the original prompt.
  const [known, setKnown] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const mounted = useRef(true);
  const isMounted = useCallback(() => mounted.current, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Connections, answers and results belong to one workspace: start over when it changes.
  const [seenWorkspaceId, setSeenWorkspaceId] = useState(activeWorkspaceId);
  if (seenWorkspaceId !== activeWorkspaceId) {
    setSeenWorkspaceId(activeWorkspaceId);
    setPicked({});
    setAnswers({});
    setKnown({});
    setLocalError(null);
    setConnections([]);
    reset();
  }

  useEffect(() => {
    if (!activeWorkspaceId) return;
    const controller = new AbortController();
    connectionApi
      .list(activeWorkspaceId, controller.signal)
      .then(setConnections)
      .catch(() => setConnections([]));
    return () => controller.abort();
  }, [activeWorkspaceId]);

  const trimmedPrompt = prompt.trim();

  const submitFresh = async () => {
    if (isPending || !trimmedPrompt) return;
    setAnswers({});
    setPicked({});
    setKnown({});
    setLocalError(null);
    setDraftError(null);
    await generate({ prompt: trimmedPrompt });
  };

  const defaultAnswer = (question: Question) =>
    question.code === 'VALUE' && RECIPIENT_FIELD.test(question.field) ? userEmail : '';

  const submitAnswers = async (questions: Question[]) => {
    if (isPending) return;
    const next = { ...known };
    questions.forEach((question, index) => {
      if (question.code === 'CONNECTION') return;
      const value = (answers[index] ?? defaultAnswer(question)).trim();
      if (value) next[question.field] = value;
    });
    setLocalError(null);
    setKnown(next);
    setAnswers({});
    await generate({ prompt: trimmedPrompt, answers: next, connections: picked });
  };

  const createDraft = async (ready: ReadyGeneration) => {
    if (isSaving) return;
    const session = captureNotificationSession();
    setIsSaving(true);
    setDraftError(null);
    try {
      const workflowId = await workflowV1Api.createWorkflowFromDefinition({
        name: ready.name,
        definition: ready.definition,
        layout: ready.layout,
      });
      if (!isMounted() || !isCurrentNotificationSession(session)) return;
      showSuccessToast('toast.workflow.created', session);
      refreshNotifications(session);
      navigate(`/workflows/${workflowId}/builder`);
    } catch (unknown) {
      if (isMounted() && isCurrentNotificationSession(session)) {
        setDraftError(unknown instanceof Error ? unknown.message : t('hp.ai.draft_failed'));
      }
    } finally {
      if (isMounted()) setIsSaving(false);
    }
  };

  const connectionsChosen = (questions: Question[]) =>
    questions.every((question) => question.code !== 'CONNECTION' || Boolean(picked[question.field]));

  const renderQuestions = (questions: Question[]) => (
    <section aria-labelledby={`${promptId}-questions`} className="space-y-3 rounded-lg border border-warn/30 bg-warn-bg p-4">
      <h2 id={`${promptId}-questions`} className="text-sm font-semibold text-foreground">{t('hp.ai.needs_input_title')}</h2>
      <p className="text-xs text-text-2">{t('hp.ai.needs_input_hint')}</p>
      <ul className="space-y-3">
        {questions.map((question, index) => {
          const { type: questionType, key: configKey } = splitQuestionField(question.field);
          const fill = (template: string, values: Record<string, string>) =>
            template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
          const label = question.code === 'VALUE'
            ? RECIPIENT_FIELD.test(configKey)
              ? t('ai.question.recipient')
              : questionType
                ? fill(t('ai.question.value_in_step'), { node: nodeLabel(questionType, t), field: errorFieldLabel(configKey, t) })
                : fill(t('ai.question.value_field'), { field: errorFieldLabel(configKey, t) })
            : t(`ai.question.${question.code}`);
          const labelOf = (item: Question) => {
            const split = splitQuestionField(item.field);
            return item.code === 'VALUE' && RECIPIENT_FIELD.test(split.key) ? t('ai.question.recipient') : item.code;
          };
          // Two questions that read the same (for example to and cc) get their field name appended.
          const ambiguous = question.code === 'VALUE' && RECIPIENT_FIELD.test(configKey)
            && questions.some((other, i) => i !== index && labelOf(other) === labelOf(question));
          const controlId = `${promptId}-q-${index}`;
          if (question.code === 'CONNECTION') {
            const provider = PROVIDER_BY_NODE[question.field];
            const options = connections.filter((item) => item.provider === provider && item.status === 'ACTIVE');
            const nodeTitle = nodeLabel(question.field, t);
            return (
              <li key={`${question.code}-${question.field}-${index}`}>
                <label htmlFor={controlId} className="mb-1 block text-xs font-medium text-foreground">
                  {label} <span className="text-muted-foreground">({nodeTitle})</span>
                </label>
                <select
                  id={controlId}
                  value={picked[question.field] ?? ''}
                  onChange={(event) => setPicked((current) => ({ ...current, [question.field]: event.target.value }))}
                  className={fieldClass}
                >
                  <option value="">{t('ai.connection_none')}</option>
                  {options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                {options.length === 0 ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t('hp.ai.no_connection')} <Link to="/connections" className="font-medium text-run underline">{t('hp.ai.open_connections')}</Link>
                  </p>
                ) : null}
              </li>
            );
          }
          return (
            <li key={`${question.code}-${question.field}-${index}`}>
              <label htmlFor={controlId} className="mb-1 block text-xs font-medium text-foreground">
                {label}{ambiguous ? <span className="text-muted-foreground"> ({errorFieldLabel(configKey, t)})</span> : null}
              </label>
              <input
                id={controlId}
                type="text"
                maxLength={500}
                value={answers[index] ?? defaultAnswer(question)}
                onChange={(event) => setAnswers((current) => ({ ...current, [index]: event.target.value }))}
                className={fieldClass}
              />
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end">
        <button type="button" onClick={() => void submitAnswers(questions)} disabled={isPending || !connectionsChosen(questions)} className={primaryButton}>
          {isPending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
          {t('hp.ai.send_answers')}
        </button>
      </div>
    </section>
  );

  const renderPreview = (ready: ReadyGeneration) => {
    const { nodes } = definitionToCanvas(ready.definition, ready.layout);
    const needsConnection = nodes.filter((node) => {
      return NODE_SCHEMAS[node.type]?.required.includes('connectionId') && !node.config.connectionId;
    });
    return (
      <section data-testid="ai-generator-preview" aria-labelledby={`${promptId}-preview`} className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div>
          <h2 id={`${promptId}-preview`} className="text-sm font-semibold text-foreground">{t('hp.ai.preview_title')}</h2>
          <p className="mt-0.5 text-lg font-bold text-foreground">{ready.name}</p>
        </div>
        <ol className="space-y-1.5">
          {nodes.map((node, index) => (
            <li key={node.id} className="flex items-center gap-2 rounded-md border border-border bg-subtle px-3 py-2 text-sm">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-text-2">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{node.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{nodeLabel(node.type, t)}</span>
            </li>
          ))}
        </ol>
        {needsConnection.length > 0 ? (
          <div className="rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-xs text-warn">
            <p className="font-semibold">{t('hp.ai.connections_needed')}</p>
            <ul className="mt-1 list-disc pl-4">
              {needsConnection.map((node) => (
                <li key={node.id}>{node.name} ({NODE_SCHEMAS[node.type]?.properties.connectionId['x-weav-connection']?.provider ?? node.type})</li>
              ))}
            </ul>
            <p className="mt-1 text-text-2">{t('hp.ai.connections_hint')}</p>
          </div>
        ) : null}
        {draftError ? <p role="alert" className="text-xs text-err">{draftError}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={reset} disabled={isSaving} className={secondaryButton}>{t('hp.ai.try_again')}</button>
          <button type="button" onClick={() => void createDraft(ready)} disabled={isSaving} className={primaryButton}>
            {isSaving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
            {t('hp.ai.create_draft')}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </section>
    );
  };

  return (
    <div data-testid="ai-generator-page" className="mx-auto max-w-3xl space-y-5 pb-16 font-sans text-foreground">
      <div className="space-y-2">
        <Link to="/workflows/new" className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft size={14} aria-hidden="true" />
          {t('ai_gen.back')}
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
          <Sparkles size={18} className="text-run" aria-hidden="true" />
          {t('ai_gen.title')}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('ai_gen.simple_subtitle')}</p>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <label htmlFor={promptId} className="block text-xs font-medium text-text-2">{t('ai_gen.prompt_label')}</label>
        <textarea
          id={promptId}
          rows={4}
          maxLength={4000}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className={`${fieldClass} resize-y`}
        />
        <p className="text-[11px] text-muted-foreground">{t('ai_gen.prompt_hint')}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">{t('ai_gen.try_example')}:</span>
          {STARTER_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setPrompt(t(`hp.ai.starter_prompt.${key}`))}
              className="rounded-full border border-border bg-subtle px-2.5 py-1 text-[11px] text-text-2 transition-colors hover:bg-muted hover:text-foreground"
            >
              {t(`hp.ai.starter.${key}`)}
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={() => void submitFresh()} disabled={isPending || !trimmedPrompt} className={primaryButton}>
            {isPending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
            {t('ai_gen.btn_generate')}
          </button>
        </div>
      </div>

      <div aria-live="polite" className="space-y-4">
        {isPending ? <p data-testid="generation-status" className="text-sm text-muted-foreground">{t('hp.ai.generating')}</p> : null}
        {error || localError ? <p role="alert" className="rounded-md border border-err-border bg-err-bg px-3 py-2 text-sm text-err">{localError ?? error}</p> : null}
        {!isPending && result?.status === 'needs_input' ? renderQuestions(result.questions) : null}
        {!isPending && result?.status === 'unsupported' ? (
          <ul className="space-y-1.5">
            {result.reasons.map((reason, index) => (
              <li key={`${reason.code}-${index}`} className="rounded-md border border-border bg-subtle px-3 py-2 text-sm text-text-2">
                {t(`ai.reason.${reason.code}`)}
              </li>
            ))}
          </ul>
        ) : null}
        {!isPending && result?.status === 'ready' ? renderPreview(result) : null}
      </div>
    </div>
  );
}
