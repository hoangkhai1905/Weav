import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, LoaderCircle, Minus, Play, RefreshCw, Sparkles, Square, X } from 'lucide-react';
import { isAssistantMockMode } from '../../api/assistant.api';
import { executionApi } from '../../api/execution.api';
import { workflowApi } from '../../api/workflow.api';
import type { ExecutionDetail, NodeExecutionResult, WorkflowDefinition } from '../../types/workflow.types';
import { useI18nStore } from '../../store/useI18nStore';
import { statusBadgeClass, type StatusTone } from '../common/statusBadgeClass';
import { ConfirmModal } from '../common/ConfirmModal';
import { failureOf, isLiveStatus, useLivePolling, type TickResult } from '../../lib/executions/useLivePolling';
import { errorCodeOf, errorField, errorFieldLabel, friendlyErrorMessage, orderSteps, stepDidNotRun, triggerTypeLabel } from '../../lib/executions/runView';
import { friendlyErrorAction, friendlyErrorKind } from '../../lib/executions/friendlyError';
import { nodeLabel } from '../../lib/nodeLabels';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SM, CARD, FOCUS_RING } from '../../lib/uiClasses';

function runTone(status: string): StatusTone {
  if (status === 'SUCCESS') return 'ok';
  if (status === 'FAILED') return 'err';
  if (status === 'RUNNING' || status === 'QUEUED') return 'run';
  return 'pause';
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`;
}

function pretty(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseError(raw: string | undefined): { message: string; pretty: string } {
  if (!raw) return { message: '', pretty: '' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const message = typeof record.message === 'string' ? record.message : typeof record.error === 'string' ? record.error : raw;
      return { message, pretty: JSON.stringify(parsed, null, 2) };
    }
  } catch {
    // plain-text error
  }
  return { message: raw, pretty: raw };
}

const MAX_VALUE_CHARS = 1500;

/** One step's data as label/value rows. A plain object becomes one row per field; anything else is a single row. */
function dataRows(value: unknown, fallbackLabel: string): Array<{ key: string; text: string }> {
  if (value === undefined || value === null || value === '') return [];
  const text = (item: unknown) => {
    const raw = typeof item === 'string' ? item : (pretty(item) ?? '');
    return raw.length > MAX_VALUE_CHARS ? `${raw.slice(0, MAX_VALUE_CHARS)}…` : raw;
  };
  if (typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 0) return entries.map(([key, item]) => ({ key, text: text(item) }));
  }
  return [{ key: fallbackLabel, text: text(value) }];
}

function StepDot({ status, skipped }: { status: string; skipped: boolean }) {
  const base = 'inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full';
  if (skipped) return <span className={`${base} bg-subtle text-muted-foreground`}><Minus size={14} strokeWidth={1.75} aria-hidden="true" /></span>;
  if (status === 'SUCCESS') return <span className={`${base} bg-ok-bg text-ok`}><Check size={14} strokeWidth={1.75} aria-hidden="true" /></span>;
  if (status === 'FAILED') return <span className={`${base} bg-err-bg text-err`}><X size={14} strokeWidth={1.75} aria-hidden="true" /></span>;
  if (status === 'RUNNING' || status === 'QUEUED') return <span className={`${base} bg-run-bg text-run`}><LoaderCircle size={14} strokeWidth={1.75} className="motion-safe:animate-spin" aria-hidden="true" /></span>;
  return <span className={`${base} bg-subtle text-muted-foreground`}><Minus size={14} strokeWidth={1.75} aria-hidden="true" /></span>;
}

function RunDot({ status }: { status: string }) {
  const cls = `shrink-0 ${runTone(status) === 'ok' ? 'text-ok' : runTone(status) === 'err' ? 'text-err' : runTone(status) === 'run' ? 'text-run' : 'text-muted-foreground'}`;
  if (status === 'SUCCESS') return <Check size={14} strokeWidth={1.75} className={cls} aria-hidden="true" />;
  if (status === 'FAILED') return <X size={14} strokeWidth={1.75} className={cls} aria-hidden="true" />;
  if (status === 'RUNNING' || status === 'QUEUED') return <LoaderCircle size={14} strokeWidth={1.75} className={`${cls} motion-safe:animate-spin`} aria-hidden="true" />;
  return <Minus size={14} strokeWidth={1.75} className={cls} aria-hidden="true" />;
}

function DataBlock({ title, rows, empty, action }: { title: string; rows: Array<{ key: string; text: string }>; empty: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-text-2">{title}</h3>
        {action}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-subtle px-3 py-2.5 text-[13px] text-text-2">{empty}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {rows.map((row, index) => (
            <div key={`${row.key}-${index}`} className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
              <span className="break-words text-[13px] text-muted-foreground">{row.key}</span>
              <span className="whitespace-pre-wrap break-words text-[13px] text-foreground [overflow-wrap:anywhere]">{row.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  workflowId: string;
  selectedExecutionId?: string | null;
}

/** Per-workflow run history: run list | one run (header, plain-language error, steps, data of the chosen step). */
export function ExecutionsTriPane({ workflowId, selectedExecutionId }: Props) {
  const { t, language } = useI18nStore();
  const navigate = useNavigate();
  const locale = language === 'VI' ? 'vi-VN' : 'en-US';
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [runs, setRuns] = useState<ExecutionDetail[]>([]);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // W6-C3: the stop button. `stopRequestedFor` keeps the "Stopping…" badge until a poll shows CANCELLED.
  const [stopOpen, setStopOpen] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [stopRequestedFor, setStopRequestedFor] = useState<string | null>(null);

  const activeId = selectedExecutionId ?? runs[0]?.id ?? null;

  // Responses for another workflow/run than the current one (an in-flight poll) must never overwrite the view.
  const workflowIdRef = useRef(workflowId);
  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    workflowIdRef.current = workflowId;
    activeIdRef.current = activeId;
  });

  const loadRuns = useCallback(async (): Promise<TickResult> => {
    try {
      const [items, definition] = await Promise.all([
        executionApi.getExecutions(workflowId),
        workflowApi.getWorkflow(workflowId),
      ]);
      if (workflowIdRef.current !== workflowId) return;
      setRuns(items);
      setWorkflow(definition);
      setError(null);
    } catch (cause) {
      if (workflowIdRef.current !== workflowId) return;
      setError(cause instanceof Error ? cause.message : t('runs.load_error'));
      return failureOf(cause);
    } finally {
      setLoading(false);
    }
  }, [workflowId, t]);

  useEffect(() => {
    // Fetch on mount / workflow change; state is set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRuns();
  }, [loadRuns]);

  const loadDetail = useCallback(
    async (id: string, silent: boolean): Promise<TickResult> => {
      if (!silent) setDetailLoading(true);
      try {
        const result = await executionApi.getExecution(id, workflowId);
        if (activeIdRef.current !== id || workflowIdRef.current !== workflowId) return;
        setDetail(result);
        if (!result) setError(t('runs.not_found'));
      } catch (cause) {
        if (activeIdRef.current !== id || workflowIdRef.current !== workflowId) return;
        setError(cause instanceof Error ? cause.message : t('runs.load_error'));
        return failureOf(cause);
      } finally {
        setDetailLoading(false);
      }
    },
    [workflowId, t],
  );

  useEffect(() => {
    if (!activeId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDetail(activeId, false);
  }, [activeId, loadDetail]);

  const live = isLiveStatus(detail?.status);
  const listLive = runs.some((run) => isLiveStatus(run.status));
  // Every 2 s while the open run or any listed run is queued/running: the list only while a listed run is live, the
  // detail only while the open run is. One round at a time, backed off on failure, paused in a hidden tab.
  useLivePolling(live || listLive, async () => {
    const results = await Promise.all([
      listLive ? loadRuns() : undefined,
      live && activeId ? loadDetail(activeId, true) : undefined,
    ]);
    if (results.includes('stop')) return 'stop';
    return !results.includes(false);
  });

  const nodeTypes = useMemo(() => new Map((workflow?.nodes ?? []).map((node) => [node.id, node.type])), [workflow]);

  const steps = useMemo(
    () => orderSteps(Object.values(detail?.nodeResults ?? {}), workflow?.nodes ?? [], workflow?.edges ?? []),
    [detail, workflow],
  );
  const runTerminal = !!detail && !isLiveStatus(detail.status);
  const didNotRun = (step: NodeExecutionResult) => stepDidNotRun(step, runTerminal);

  const failedStep = steps.find((step) => step.status === 'FAILED');
  const selectedStep: NodeExecutionResult | undefined =
    steps.find((step) => step.nodeId === selectedStepId) ?? failedStep ?? steps.find((step) => !didNotRun(step)) ?? steps[0];

  const filteredRuns = runs.filter((run) => {
    if (statusFilter !== 'ALL' && run.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    return !q || run.id.toLowerCase().includes(q) || run.triggerType.toLowerCase().includes(q);
  });
  const failedRuns = runs.filter((run) => run.status === 'FAILED').length;

  const fieldPrefix = (raw: string | undefined) => {
    const field = errorField(raw);
    return field ? `${errorFieldLabel(field, t)}: ` : '';
  };

  const when = (iso: string) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  };
  const exact = (iso: string | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString(locale) : '—');
  const shortId = (id: string) => id.replace(/^exec[_-]?/i, '').slice(0, 8);
  const stepName = (step: NodeExecutionResult) => {
    const type = nodeTypes.get(step.nodeId);
    return step.nodeName || (type ? nodeLabel(type, t) : step.nodeId);
  };

  const rerun = async () => {
    setNotice(null);
    try {
      if (!workflow || workflow.status !== 'PUBLISHED') {
        setNotice(t('runs.only_published'));
        return;
      }
      const receipt = await workflowApi.runWorkflow(workflowId);
      setNotice(t('runs.queued').replace('{id}', receipt.executionId));
      await loadRuns();
      navigate(`/workflows/${encodeURIComponent(workflowId)}/executions?run=${encodeURIComponent(receipt.executionId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('runs.load_error'));
    }
  };

  const stop = async () => {
    if (!detail) return;
    setStopBusy(true);
    setNotice(null);
    try {
      const result = await executionApi.cancelExecution(workflowId, detail.id);
      if (result.status === 'CANCEL_REQUESTED') {
        setStopRequestedFor(detail.id);
        setNotice(t('runs.stop_requested'));
      } else {
        setNotice(t('runs.stopped_now'));
      }
    } catch (cause) {
      const finished = typeof cause === 'object' && cause !== null && (cause as { status?: unknown }).status === 409;
      if (finished) setNotice(t('runs.stop_finished'));
      else setError(cause instanceof Error ? cause.message : t('runs.stop_error'));
    } finally {
      setStopBusy(false);
      setStopOpen(false);
    }
    await Promise.all([loadRuns(), loadDetail(detail.id, true)]);
  };

  const selectRun = (id: string) => {
    setSelectedStepId(null);
    navigate(`/workflows/${encodeURIComponent(workflowId)}/executions?run=${encodeURIComponent(id)}`, { replace: true });
  };

  const statusLabel = (status: string) => t(`runs.status.${status.toLowerCase()}`);

  // The chosen step's two data blocks. A failed step shows its plain-language reason instead of the raw error body.
  const stepError = selectedStep?.status === 'FAILED' ? selectedStep.error : undefined;
  const inputRows = selectedStep ? dataRows(selectedStep.input, t('run2.value')) : [];
  const outputRows = selectedStep
    ? stepError
      ? [{ key: t('run2.error_label'), text: `${fieldPrefix(stepError)}${friendlyErrorMessage(stepError, t) ?? t(`runerr.${friendlyErrorKind(errorCodeOf(stepError))}.title`)}` }]
      : dataRows(selectedStep.output, t('run2.value'))
    : [];
  const stepLogs = selectedStep ? (detail?.logs ?? []).filter((log) => log.nodeId === selectedStep.nodeId) : [];
  const rawOutput = selectedStep ? (stepError ? parseError(stepError).pretty : pretty(selectedStep.output)) : null;

  const copy = async () => {
    if (!rawOutput) return;
    try {
      await navigator.clipboard.writeText(rawOutput);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  // Plain-language failure block: what broke, how to fix it, one fix button; the code stays inside <details>.
  const failure = (() => {
    if (!failedStep) return null;
    const code = errorCodeOf(failedStep.error);
    const kind = friendlyErrorKind(code);
    const action = friendlyErrorAction(kind);
    const fix = friendlyErrorMessage(failedStep.error, t);
    return { code, kind, action, fix, number: steps.indexOf(failedStep) + 1, name: stepName(failedStep), message: parseError(failedStep.error).message };
  })();

  const fieldCls = `h-9 w-full rounded-md border border-border-strong bg-card px-2.5 text-[13px] text-foreground ${FOCUS_RING}`;

  return (
    <div data-testid="executions-tripane" className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-3 sm:px-4">
        <Link
          to="/workflows"
          className={`flex h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-[13px] text-text-2 transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
        >
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="hidden sm:inline">{t('nav.workflows')}</span>
        </Link>
        <span aria-hidden="true" className="text-muted-foreground">/</span>
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">{workflow?.name ?? t('nav.workflows')}</p>
        <nav aria-label={t('builder.workflow_sections')} className="ml-4 flex h-14 shrink-0 items-stretch gap-5 whitespace-nowrap">
          <Link
            to={`/workflows/${encodeURIComponent(workflowId)}/builder`}
            className={`inline-flex items-center border-b-2 border-transparent px-0.5 text-[13px] font-medium text-text-2 transition-colors hover:text-foreground ${FOCUS_RING}`}
          >
            {t('builder.section_editor')}
          </Link>
          <span aria-current="page" className="inline-flex items-center border-b-2 border-foreground px-0.5 text-[13px] font-medium text-foreground">
            {t('runs.tab_runs')}
          </span>
          <Link
            to={`/workflows/${encodeURIComponent(workflowId)}/builder?tab=settings`}
            className={`inline-flex items-center border-b-2 border-transparent px-0.5 text-[13px] font-medium text-text-2 transition-colors hover:text-foreground ${FOCUS_RING}`}
          >
            {t('builder.section_settings')}
          </Link>
        </nav>
        <button type="button" onClick={() => void loadRuns()} className={`${BTN_SECONDARY} ${BTN_SM} ml-auto`}>
          <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="hidden sm:inline">{t('runs.refresh')}</span>
        </button>
      </header>

      {error && (
        <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-err-border bg-err-bg px-4 py-2 text-[13px] text-err">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button type="button" className="font-medium underline" onClick={() => { setLoading(true); void loadRuns(); }}>
            {t('topbar.retry')}
          </button>
        </div>
      )}
      {notice && <p role="status" className="shrink-0 border-b border-border bg-run-bg px-4 py-2 text-[13px] text-foreground">{notice}</p>}

      <div className="flex min-h-0 flex-1">
        {/* Run list */}
        <aside aria-label={t('runs.list_label')} className="hidden w-[280px] shrink-0 flex-col border-r border-border bg-background md:flex">
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('runs.search')} aria-label={t('runs.search')} className={fieldCls} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t('runs.col_status')} className={fieldCls}>
              <option value="ALL">{t('runs.filter_all')}</option>
              {['FAILED', 'SUCCESS', 'RUNNING', 'QUEUED', 'CANCELLED'].map((status) => (
                <option key={status} value={status}>{statusLabel(status)}</option>
              ))}
            </select>
          </div>
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-3.5 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {runs.length} {t('runs.runs_unit')}
              {failedRuns > 0 && <span className="text-err"> · {failedRuns} {t('runs.failed_unit')}</span>}
            </span>
            <span>{t('runs.newest_first')}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && <div role="status" className="flex justify-center py-8"><LoaderCircle size={18} className="animate-spin text-muted-foreground" aria-label={t('runs.loading')} /></div>}
            {!loading && filteredRuns.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-text-2">{t('runs.empty')}</p>}
            {filteredRuns.map((run) => {
              const on = run.id === activeId;
              return (
                <button
                  key={run.id}
                  type="button"
                  data-testid="execution-run-item"
                  aria-pressed={on}
                  onClick={() => selectRun(run.id)}
                  title={exact(run.startedAt)}
                  className={`flex h-11 w-full items-center gap-2.5 border-b border-border px-3.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${on ? 'bg-card' : 'hover:bg-subtle'}`}
                >
                  <RunDot status={run.status} />
                  <span className="w-[68px] shrink-0 font-mono text-xs tabular-nums text-foreground">{shortId(run.id)}</span>
                  <span className="min-w-0 flex-1 truncate text-text-2">{when(run.startedAt)}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatDuration(run.durationMs)}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* One run */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {!detail && !detailLoading && !loading && (
            <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-text-2">{t('runs.select_run')}</div>
          )}
          {detailLoading && !detail && <div role="status" className="flex h-full items-center justify-center"><LoaderCircle size={20} className="animate-spin text-muted-foreground" aria-label={t('runs.loading')} /></div>}
          {detail && (
            <div className="mx-auto flex max-w-[1040px] flex-col gap-5 p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h1 className="text-2xl font-semibold leading-tight tracking-tight text-foreground">{workflow?.name ?? detail.workflowName}</h1>
                    <span data-testid="execution-status" className={statusBadgeClass(runTone(detail.status))}>
                      {live && stopRequestedFor === detail.id ? t('runs.stopping') : statusLabel(detail.status)}
                    </span>
                  </div>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-text-2">
                    <span>{t('run2.started')} <span className="font-mono text-foreground">{exact(detail.startedAt)}</span></span>
                    <span>{t('run2.ran')} <span className="font-mono text-foreground">{formatDuration(detail.durationMs)}</span></span>
                    <span>{t('run2.triggered_by').replace('{trigger}', triggerTypeLabel(detail.triggerType, t))}</span>
                    <span className="min-w-0 truncate">{t('runs.id')} <span className="font-mono text-foreground">{shortId(detail.id)}</span></span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {live && (
                    <button type="button" data-testid="execution-stop" onClick={() => setStopOpen(true)} disabled={stopRequestedFor === detail.id} className={BTN_SECONDARY}>
                      <Square size={14} strokeWidth={1.75} aria-hidden="true" />
                      {t('runs.stop')}
                    </button>
                  )}
                  {detail.status === 'FAILED' && !isAssistantMockMode && (
                    <button
                      type="button"
                      data-testid="execution-ask-ai"
                      onClick={() => navigate('/assistant', { state: { explainRun: { workflowId, executionId: detail.id } } })}
                      className={BTN_SECONDARY}
                    >
                      <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" />
                      {t('executions.askAi.button')}
                    </button>
                  )}
                  <Link to={`/workflows/${encodeURIComponent(workflowId)}/builder`} className={BTN_SECONDARY}>{t('home.action.open_workflow')}</Link>
                  <button type="button" onClick={() => void rerun()} disabled={live} className={BTN_PRIMARY}>
                    <Play size={14} strokeWidth={1.75} aria-hidden="true" />
                    {t('runs.rerun')}
                  </button>
                </div>
              </div>

              {failure && (
                <section aria-label={t('run2.failure_label')} role="alert" className="flex flex-wrap gap-3.5 rounded-xl bg-err-bg px-[18px] py-4 text-foreground">
                  <span className="mt-0.5 inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-card text-err">
                    <X size={14} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
                    <span className="font-semibold">{t('run2.failed_title').replace('{n}', String(failure.number)).replace('{name}', failure.name)}</span>
                    <span data-testid="step-error-message" className="text-text-2">
                      {t(`runerr.${failure.kind}.title`)}{' '}
                      {failure.fix ?? t(`runerr.${failure.kind}.hint`)}
                    </span>
                    <details className="group">
                      <summary className={`w-fit cursor-pointer rounded-sm text-[13px] font-medium text-accent-ink ${FOCUS_RING}`}>{t('run2.details')}</summary>
                      <dl className="mt-2 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md bg-card px-3 py-2.5 font-mono text-xs text-text-2">
                        {failure.code && (<><dt className="text-muted-foreground">{t('run2.code')}</dt><dd className="break-words">{failure.code}</dd></>)}
                        {failure.message && (<><dt className="text-muted-foreground">{t('run2.message')}</dt><dd className="whitespace-pre-wrap break-words">{failure.message}</dd></>)}
                        <dt className="text-muted-foreground">{t('run2.run_id')}</dt><dd className="break-all">{detail.id}</dd>
                        <dt className="text-muted-foreground">{t('run2.step_id')}</dt><dd className="break-all">{failedStep?.nodeId}</dd>
                      </dl>
                    </details>
                  </div>
                  {failure.action === 'reconnect' && (
                    <Link to="/workspace/connections" className={`${BTN_SECONDARY} ${BTN_SM} self-start`}>{t('home.action.reconnect')}</Link>
                  )}
                  {failure.action === 'open_workflow' && (
                    <Link to={`/workflows/${encodeURIComponent(workflowId)}/builder`} className={`${BTN_SECONDARY} ${BTN_SM} self-start`}>{t('home.action.open_workflow')}</Link>
                  )}
                </section>
              )}

              <div className="grid items-start gap-5 lg:grid-cols-3">
                <section className={`${CARD} p-2`} aria-labelledby="run-steps">
                  <h2 id="run-steps" className="px-2.5 pb-2 pt-2.5 text-[15px] font-semibold text-foreground">{t('run2.steps_title')}</h2>
                  {steps.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-text-2">{t('runs.no_steps')}</p>}
                  {steps.map((step, index) => {
                    const on = step.nodeId === selectedStep?.nodeId;
                    const skipped = didNotRun(step);
                    const type = nodeTypes.get(step.nodeId);
                    const note = skipped
                      ? t('run2.skipped_note')
                      : step.status === 'FAILED'
                        ? t(`runerr.${friendlyErrorKind(errorCodeOf(step.error))}.title`)
                        : type ? nodeLabel(type, t) : '';
                    return (
                      <button
                        key={step.nodeId}
                        type="button"
                        data-testid="execution-step-row"
                        aria-pressed={on}
                        onClick={() => setSelectedStepId(step.nodeId)}
                        className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors ${FOCUS_RING} ${on ? 'bg-subtle shadow-[0_0_0_1px_var(--border)]' : 'hover:bg-subtle'}`}
                      >
                        <StepDot status={step.status} skipped={skipped} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className={`truncate font-medium ${skipped ? 'text-muted-foreground' : 'text-foreground'}`}>{index + 1}. {stepName(step)}</span>
                          {note && <span className="truncate text-xs text-muted-foreground">{note}</span>}
                        </span>
                        <span className="font-mono text-xs text-text-2">{skipped ? '—' : formatDuration(step.durationMs)}</span>
                      </button>
                    );
                  })}
                </section>

                <section className={`${CARD} min-w-0 lg:col-span-2`} aria-labelledby="run-step-data">
                  {selectedStep ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[18px] py-3.5">
                        <h2 id="run-step-data" className="text-[15px] font-semibold text-foreground">
                          {t('run2.step_heading').replace('{n}', String(steps.indexOf(selectedStep) + 1)).replace('{name}', stepName(selectedStep))}
                        </h2>
                        {didNotRun(selectedStep)
                          ? <span className={statusBadgeClass('pause')}>{t('runs.step_skipped')}</span>
                          : <span className={statusBadgeClass(runTone(selectedStep.status))}>{statusLabel(selectedStep.status)}</span>}
                      </div>
                      <div className="flex flex-col gap-4 px-[18px] py-4">
                        {selectedStep.retryCount > 1 && <p className="text-xs text-muted-foreground">{t('runs.attempts').replace('{n}', String(selectedStep.retryCount))}</p>}
                        <DataBlock title={t('run2.received')} rows={inputRows} empty={t('run2.no_input')} />
                        <DataBlock
                          title={t('run2.result')}
                          rows={outputRows}
                          empty={didNotRun(selectedStep) ? t('run2.skipped_result') : t('run2.no_output')}
                          action={rawOutput ? (
                            <button type="button" onClick={() => void copy()} className={`h-6 rounded px-1.5 text-xs font-medium text-text-2 hover:bg-subtle hover:text-foreground ${FOCUS_RING}`}>
                              {copied ? t('runs.copied') : t('runs.copy')}
                            </button>
                          ) : null}
                        />
                        {errorField(stepError) && (
                          <p data-testid="step-error-field" className="text-xs text-foreground">
                            <span className="text-muted-foreground">{t('runs.error_field')}: </span>
                            <strong className="font-medium">{errorFieldLabel(errorField(stepError) ?? '', t)}</strong>
                          </p>
                        )}
                        {stepLogs.length > 0 && (
                          <details>
                            <summary className={`w-fit cursor-pointer rounded-sm text-[13px] font-medium text-accent-ink ${FOCUS_RING}`}>{t('run2.logs').replace('{count}', String(stepLogs.length))}</summary>
                            <pre className="m-0 mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border bg-subtle p-3 font-mono text-xs leading-relaxed text-foreground">
                              {stepLogs.map((log) => `${new Date(log.timestamp).toLocaleTimeString(locale)}  ${log.level}  ${log.message}`).join('\n')}
                            </pre>
                          </details>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="p-6 text-center text-[13px] text-text-2">{t('runs.select_step')}</p>
                  )}
                </section>
              </div>
            </div>
          )}
        </main>
      </div>
      <ConfirmModal
        isOpen={stopOpen}
        onClose={() => { if (!stopBusy) setStopOpen(false); }}
        onConfirm={stop}
        title={t('runs.stop_confirm_title')}
        description={t('runs.stop_confirm_body')}
        confirmText={t('runs.stop_confirm_yes')}
        cancelText={t('runs.stop_confirm_no')}
        variant="warning"
        loading={stopBusy}
      />
    </div>
  );
}
