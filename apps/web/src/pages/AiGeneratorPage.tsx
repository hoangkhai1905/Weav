import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { connectionApi, type ConnectionResponse } from '../api/connection.api';
import { workflowV1Api } from '../api/workflow-v1.api';
import { useWorkflowGeneration, type ReadyGeneration } from '../components/ai/useWorkflowGeneration';
import { useNotificationMilestoneRefresh } from '../hooks/useNotificationMilestoneRefresh';
import { showSuccessToast } from '../lib/feedback/toast';
import { autoPickConnections } from '../lib/autoPickConnections';
import { requiredConnectionProvider } from '../lib/nodeReadiness';
import { captureNotificationSession, isCurrentNotificationSession } from '../lib/notifications/session';
import { useUIStore } from '../store/useUIStore';
import { useI18nStore } from '../store/useI18nStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

const STARTER_KEYS = ['gmail_drive', 'webhook_sheets', 'schedule_telegram', 'telegram_reply'] as const;

const fieldClass = 'w-full rounded-md border border-border bg-subtle px-3 py-2 text-sm text-foreground focus:border-ring/40 focus:outline-none focus:ring-2 focus:ring-ring/10';
const primaryButton = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

interface AiGeneratorPageProps {
  /** Rendered inside the "create with AI" dialog: no page header, the dialog gives the title. */
  inDialog?: boolean;
  initialPrompt?: string;
}

export function AiGeneratorPage({ inDialog = false, initialPrompt }: AiGeneratorPageProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18nStore();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const refreshNotifications = useNotificationMilestoneRefresh();
  const promptId = useId();
  const { isPending, error, result, generate, reset } = useWorkflowGeneration();

  const [prompt, setPrompt] = useState<string>(
    initialPrompt ?? (location.state as { initialPrompt?: string } | null)?.initialPrompt ?? '',
  );
  const [connections, setConnections] = useState<ConnectionResponse[]>([]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const mounted = useRef(true);
  const isMounted = useCallback(() => mounted.current, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Connections and results belong to one workspace: start over when it changes.
  const [seenWorkspaceId, setSeenWorkspaceId] = useState(activeWorkspaceId);
  if (seenWorkspaceId !== activeWorkspaceId) {
    setSeenWorkspaceId(activeWorkspaceId);
    setConnections([]);
    setDraftError(null);
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

  const busy = isPending || isSaving;

  // Set synchronously: `busy` lags a render between the generate call ending and the save starting.
  const inFlight = useRef(false);

  const submit = async () => {
    if (busy || inFlight.current || !trimmedPrompt) return;
    inFlight.current = true;
    const startedIn = activeWorkspaceId;
    try {
      setDraftError(null);
      // allowBlanks: the user wants the draft now; the builder's publish checks flag whatever stays empty.
      const generated = await generate({ prompt: trimmedPrompt, allowBlanks: true });
      // A result that comes back after the workspace changed (or the page closed) belongs to the old workspace.
      if (!isMounted() || useWorkspaceStore.getState().activeWorkspaceId !== startedIn) return;
      if (generated?.status === 'ready') await createDraft(generated);
    } finally {
      inFlight.current = false;
    }
  };

  const createDraft = async (ready: ReadyGeneration) => {
    const session = captureNotificationSession();
    setIsSaving(true);
    setDraftError(null);
    try {
      const workflowId = await workflowV1Api.createWorkflowFromDefinition({
        name: ready.name,
        definition: autoPickConnections(ready.definition, connections, requiredConnectionProvider),
        layout: ready.layout,
      });
      if (!isMounted() || !isCurrentNotificationSession(session)) return;
      showSuccessToast('toast.workflow.created', session);
      refreshNotifications(session);
      useUIStore.getState().closeAiGenerator();
      navigate(`/workflows/${workflowId}/builder`);
    } catch (unknown) {
      if (isMounted() && isCurrentNotificationSession(session)) {
        setDraftError(unknown instanceof Error ? unknown.message : t('hp.ai.draft_failed'));
      }
    } finally {
      if (isMounted()) setIsSaving(false);
    }
  };

  return (
    <div data-testid="ai-generator-page" className={inDialog ? 'space-y-4 text-foreground' : 'mx-auto max-w-3xl space-y-5 pb-16 font-sans text-foreground'}>
      {inDialog ? (
        <p className="text-sm text-muted-foreground">{t('ai_gen.simple_subtitle')}</p>
      ) : (
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
      )}

      <div className={inDialog ? 'space-y-3' : 'space-y-3 rounded-lg border border-border bg-card p-4'}>
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
          <button type="button" onClick={() => void submit()} disabled={busy || !trimmedPrompt} className={primaryButton}>
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
            {t('ai_gen.btn_generate')}
          </button>
        </div>
      </div>

      <div aria-live="polite" className="space-y-4">
        {busy ? <p data-testid="generation-status" className="text-sm text-muted-foreground">{t('hp.ai.generating')}</p> : null}
        {error || draftError ? <p role="alert" className="rounded-md border border-err-border bg-err-bg px-3 py-2 text-sm text-err">{draftError ?? error}</p> : null}
        {!busy && (result?.status === 'needs_input' || result?.status === 'unsupported') ? (
          <div className="rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-sm text-foreground">
            <p className="font-medium">{t('hp.ai.unclear')}</p>
            <ul className="mt-1 list-disc pl-5 text-text-2">
              {result.status === 'needs_input'
                ? result.questions.map((question, index) => <li key={`${question.code}-${index}`}>{t(`ai.question.${question.code}`)}</li>)
                : result.reasons.map((reason, index) => <li key={`${reason.code}-${index}`}>{t(`ai.reason.${reason.code}`)}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
