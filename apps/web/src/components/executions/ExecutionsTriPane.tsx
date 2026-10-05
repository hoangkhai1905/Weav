import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, LoaderCircle, Minus, Play, RefreshCw, X } from 'lucide-react';
import { executionApi } from '../../api/execution.api';
import { workflowApi } from '../../api/workflow.api';
import type { ExecutionDetail, NodeExecutionResult, WorkflowDefinition } from '../../types/workflow.types';
import { useI18nStore } from '../../store/useI18nStore';
import { statusBadgeClass, type StatusTone } from '../common/statusBadgeClass';

type DetailTab = 'input' | 'output' | 'logs';

const TYPE_STRIPE: Record<string, string> = {
  trigger: 'bg-t-trigger',
  logic: 'bg-t-logic',
  ai: 'bg-t-ai',
  action: 'bg-t-action',
};

function stripeFor(nodeType: string | undefined): string {
  if (!nodeType) return TYPE_STRIPE.action;
  if (nodeType.startsWith('trigger')) return TYPE_STRIPE.trigger;
  if (nodeType.startsWith('logic')) return TYPE_STRIPE.logic;
  if (nodeType.startsWith('ai') || nodeType.startsWith('agent')) return TYPE_STRIPE.ai;
  return TYPE_STRIPE.action;
}

function runTone(status: string): StatusTone {
  if (status === 'SUCCESS') return 'ok';
  if (status === 'FAILED') return 'err';
  if (status === 'RUNNING' || status === 'QUEUED') return 'run';
  return 'pause';
}

function toneText(tone: StatusTone): string {
  return tone === 'ok' ? 'text-ok' : tone === 'err' ? 'text-err' : tone === 'run' ? 'text-run' : 'text-muted-foreground';
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

function StatusIcon({ status }: { status: string }) {
  const tone = runTone(status);
  const cls = `shrink-0 ${toneText(tone)}`;
  if (status === 'SUCCESS') return <Check size={14} strokeWidth={2.25} className={cls} aria-hidden="true" />;
  if (status === 'FAILED') return <X size={14} strokeWidth={2.25} className={cls} aria-hidden="true" />;
  if (status === 'RUNNING' || status === 'QUEUED') return <LoaderCircle size={14} className={`${cls} motion-safe:animate-spin`} aria-hidden="true" />;
  return <Minus size={14} className={cls} aria-hidden="true" />;
}

interface Props {
  workflowId: string;
  selectedExecutionId?: string | null;
}

/** Per-workflow run history: run list | step table with waterfall | step detail. All data comes from the execution API. */
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
  const [tab, setTab] = useState<DetailTab>('output');
  const [copied, setCopied] = useState(false);

  const activeId = selectedExecutionId ?? runs[0]?.id ?? null;

  const loadRuns = useCallback(async () => {
    try {
      const [items, definition] = await Promise.all([
        executionApi.getExecutions(workflowId),
        workflowApi.getWorkflow(workflowId),
      ]);
      setRuns(items);
      setWorkflow(definition);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('runs.load_error'));
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
    async (id: string, silent: boolean) => {
      if (!silent) setDetailLoading(true);
      try {
        const result = await executionApi.getExecution(id, workflowId);
        setDetail(result);
        if (!result) setError(t('runs.not_found'));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('runs.load_error'));
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

  const live = detail?.status === 'RUNNING' || detail?.status === 'QUEUED';
  useEffect(() => {
    if (!live || !activeId) return;
    const timer = window.setInterval(() => {
      void loadDetail(activeId, true);
      void loadRuns();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [live, activeId, loadDetail, loadRuns]);

  const nodeTypes = useMemo(() => new Map((workflow?.nodes ?? []).map((node) => [node.id, node.type])), [workflow]);

  const steps = useMemo(() => {
    const list = Object.values(detail?.nodeResults ?? {});
    return list.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  }, [detail]);

  const timeline = useMemo(() => {
    if (!detail) return { start: 0, span: 1 };
    const starts = steps.map((step) => Date.parse(step.startedAt)).filter(Number.isFinite);
    const ends = steps
      .map((step) => (step.completedAt ? Date.parse(step.completedAt) : NaN))
      .filter(Number.isFinite);
    const start = Math.min(Date.parse(detail.startedAt), ...starts);
    const end = Math.max(detail.completedAt ? Date.parse(detail.completedAt) : 0, ...ends, ...starts);
    return { start: Number.isFinite(start) ? start : 0, span: Math.max(1, end - start) };
  }, [detail, steps]);

  const failedStep = steps.find((step) => step.status === 'FAILED');
  const selectedStep: NodeExecutionResult | undefined =
    steps.find((step) => step.nodeId === selectedStepId) ?? failedStep ?? steps[0];

  const filteredRuns = runs.filter((run) => {
    if (statusFilter !== 'ALL' && run.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    return !q || run.id.toLowerCase().includes(q) || run.triggerType.toLowerCase().includes(q);
  });
  const failedRuns = runs.filter((run) => run.status === 'FAILED').length;

  const when = (iso: string) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  };
  const exact = (iso: string | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString(locale) : '—');
  const shortId = (id: string) => id.replace(/^exec[_-]?/i, '').slice(0, 8);

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

  const selectRun = (id: string) => {
    setSelectedStepId(null);
    navigate(`/workflows/${encodeURIComponent(workflowId)}/executions?run=${encodeURIComponent(id)}`, { replace: true });
  };

  const stepBody = (() => {
    if (!selectedStep) return { caption: '', body: null as string | null, isError: false };
    if (tab === 'input') return { caption: t('runs.input_caption'), body: null, isError: false };
    if (tab === 'logs') {
      const lines = (detail?.logs ?? []).filter((log) => log.nodeId === selectedStep.nodeId);
      return {
        caption: `${t('runs.tab_logs')} · ${lines.length}`,
        body: lines.length ? lines.map((log) => `${new Date(log.timestamp).toLocaleTimeString(locale)}  ${log.level}  ${log.message}`).join('\n') : null,
        isError: false,
      };
    }
    if (selectedStep.status === 'FAILED' && selectedStep.error) return { caption: t('runs.error_response'), body: parseError(selectedStep.error).pretty, isError: true };
    return { caption: t('runs.tab_output'), body: pretty(selectedStep.output), isError: false };
  })();

  const copy = async () => {
    if (!stepBody.body) return;
    try {
      await navigator.clipboard.writeText(stepBody.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const ctl =
    'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
  const field =
    'h-8 w-full rounded-md border border-border-strong bg-card px-2.5 text-[13px] text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';
  const statusLabel = (status: string) => t(`runs.status.${status.toLowerCase()}`);

  return (
    <div data-testid="executions-tripane" className="flex h-full min-h-0 w-full flex-col bg-card">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3 sm:px-4">
        <Link
          to="/workflows"
          className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[13px] text-text-2 transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span className="hidden sm:inline">{t('nav.workflows')}</span>
        </Link>
        <span aria-hidden="true" className="text-muted-foreground">/</span>
        <h1 className="min-w-0 truncate text-sm font-semibold text-foreground">{workflow?.name ?? workflowId}</h1>
        <nav aria-label={t('builder.workflow_sections')} className="ml-4 flex h-12 items-stretch gap-5">
          <Link
            to={`/workflows/${encodeURIComponent(workflowId)}/builder`}
            className="inline-flex items-center border-b-2 border-transparent px-0.5 text-[13px] font-medium text-text-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('builder.section_editor')}
          </Link>
          <span aria-current="page" className="inline-flex items-center border-b-2 border-foreground px-0.5 text-[13px] font-medium text-foreground">
            {t('runs.tab_runs')}
          </span>
        </nav>
        <button type="button" onClick={() => void loadRuns()} className={`${ctl} ml-auto`}>
          <RefreshCw size={14} aria-hidden="true" />
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
      {notice && <p role="status" className="shrink-0 border-b border-border bg-accent px-4 py-2 text-[13px] text-accent-foreground">{notice}</p>}

      <div className="flex min-h-0 flex-1">
        {/* Run list */}
        <aside aria-label={t('runs.list_label')} className="flex w-[300px] shrink-0 flex-col border-r border-border bg-card">
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('runs.search')} aria-label={t('runs.search')} className={field} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t('runs.col_status')} className={field}>
              <option value="ALL">{t('runs.filter_all')}</option>
              {['FAILED', 'SUCCESS', 'RUNNING', 'QUEUED', 'CANCELLED'].map((status) => (
                <option key={status} value={status}>{statusLabel(status)}</option>
              ))}
            </select>
          </div>
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-subtle px-3.5 text-xs text-muted-foreground">
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
                  className={`flex h-10 w-full items-center gap-2.5 border-b border-border px-3.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${on ? 'bg-accent' : 'hover:bg-subtle'}`}
                >
                  <StatusIcon status={run.status} />
                  <span className="w-[68px] shrink-0 font-mono text-xs tabular-nums text-foreground">{shortId(run.id)}</span>
                  <span className="min-w-0 flex-1 truncate text-text-2">{when(run.startedAt)}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatDuration(run.durationMs)}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Run header + step table */}
        <main className="flex min-w-0 flex-1 flex-col bg-card">
          {!detail && !detailLoading && !loading && (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-text-2">{t('runs.select_run')}</div>
          )}
          {detailLoading && !detail && <div role="status" className="flex flex-1 items-center justify-center"><LoaderCircle size={20} className="animate-spin text-muted-foreground" aria-label={t('runs.loading')} /></div>}
          {detail && (
            <>
              <div className="border-b border-border px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-base font-semibold text-foreground">
                    {t('runs.run')} <span className="font-mono tabular-nums">{shortId(detail.id)}</span>
                  </h2>
                  <span className={statusBadgeClass(runTone(detail.status))}>{statusLabel(detail.status)}</span>
                  <span className="ml-auto flex gap-2">
                    <Link to={`/workflows/${encodeURIComponent(workflowId)}/builder`} className={ctl}>{t('runs.open_editor')}</Link>
                    <button type="button" onClick={() => void rerun()} disabled={live} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:border-primary-hover hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
                      <Play size={13} aria-hidden="true" />
                      {t('runs.rerun')}
                    </button>
                  </span>
                </div>
                <dl className="mt-2.5 flex flex-wrap gap-x-7 gap-y-2 text-xs">
                  <div><dt className="text-muted-foreground">{t('runs.started')}</dt><dd className="mt-0.5 font-mono tabular-nums">{exact(detail.startedAt)}</dd></div>
                  <div><dt className="text-muted-foreground">{t('runs.duration')}</dt><dd className="mt-0.5 font-mono tabular-nums">{formatDuration(detail.durationMs)}</dd></div>
                  <div><dt className="text-muted-foreground">{t('runs.trigger')}</dt><dd className="mt-0.5">{detail.triggerType}</dd></div>
                  <div className="min-w-0"><dt className="text-muted-foreground">{t('runs.id')}</dt><dd className="mt-0.5 truncate font-mono">{detail.id}</dd></div>
                </dl>
                {failedStep && (
                  <div role="alert" className="mt-3 flex items-center gap-2.5 rounded-md border border-err-border bg-err-bg px-3 py-2 text-[13px]">
                    <AlertTriangle size={14} className="shrink-0 text-err" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      <strong className="font-semibold text-err">
                        {t('runs.failed_at').replace('{n}', String(steps.indexOf(failedStep) + 1))}
                      </strong>
                      {failedStep.error ? ` — ${parseError(failedStep.error).message}` : ''}
                    </span>
                    <button type="button" onClick={() => { setSelectedStepId(failedStep.nodeId); setTab('output'); }} className="h-6 shrink-0 rounded px-2 text-xs font-medium text-err hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {t('runs.view_error')}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid h-8 shrink-0 grid-cols-[28px_minmax(0,1.6fr)_84px_minmax(0,1.4fr)] items-center gap-x-3 border-b border-border bg-subtle px-4 text-xs font-medium text-muted-foreground">
                <span>#</span>
                <span>{t('runs.step')}</span>
                <span className="text-right">{t('runs.time')}</span>
                <span className="flex justify-between font-mono"><span>0s</span><span className="tabular-nums">{formatDuration(timeline.span)}</span></span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {steps.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-text-2">{t('runs.no_steps')}</p>}
                {steps.map((step, index) => {
                  const on = step.nodeId === selectedStep?.nodeId;
                  const tone = runTone(step.status);
                  const start = Date.parse(step.startedAt);
                  const left = Number.isFinite(start) ? ((start - timeline.start) / timeline.span) * 100 : 0;
                  const width = step.durationMs !== undefined ? Math.max(0.8, (step.durationMs / timeline.span) * 100) : 0.8;
                  return (
                    <button
                      key={step.nodeId}
                      type="button"
                      data-testid="execution-step-row"
                      aria-pressed={on}
                      onClick={() => setSelectedStepId(step.nodeId)}
                      className={`grid h-9 w-full grid-cols-[28px_minmax(0,1.6fr)_84px_minmax(0,1.4fr)] items-center gap-x-3 border-b border-border px-4 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${on ? 'bg-accent' : 'hover:bg-subtle'}`}
                    >
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span aria-hidden="true" className={`h-4 w-[3px] shrink-0 rounded-sm ${stripeFor(nodeTypes.get(step.nodeId))}`} />
                        <StatusIcon status={step.status} />
                        <span className="min-w-0 truncate"><span className="font-medium">{step.nodeName}</span>{nodeTypes.get(step.nodeId) && <span className="text-muted-foreground"> · {nodeTypes.get(step.nodeId)}</span>}</span>
                      </span>
                      <span className="text-right font-mono text-xs tabular-nums">{formatDuration(step.durationMs)}</span>
                      <span className="relative h-2 rounded-sm bg-subtle">
                        <span
                          className={`absolute inset-y-0 rounded-sm ${tone === 'ok' ? 'bg-ok' : tone === 'err' ? 'bg-err' : tone === 'run' ? 'bg-run' : 'bg-muted-foreground'}`}
                          style={{ left: `${Math.min(99, Math.max(0, left))}%`, width: `${Math.min(100 - Math.max(0, left), width)}%` }}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </main>

        {/* Step detail */}
        <aside aria-label={t('runs.step_detail')} className="hidden w-[400px] shrink-0 flex-col border-l border-border bg-card lg:flex">
          {selectedStep ? (
            <>
              <div className="border-b border-border px-4 pt-3.5">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={`h-4 w-[3px] rounded-sm ${stripeFor(nodeTypes.get(selectedStep.nodeId))}`} />
                  <span className="min-w-0 truncate text-sm font-semibold">{t('runs.step')} {steps.indexOf(selectedStep) + 1} · {selectedStep.nodeName}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={statusBadgeClass(runTone(selectedStep.status))}>{statusLabel(selectedStep.status)}</span>
                  <span className="font-mono tabular-nums">{formatDuration(selectedStep.durationMs)}</span>
                  {selectedStep.retryCount > 1 && <span>· {t('runs.attempts').replace('{n}', String(selectedStep.retryCount))}</span>}
                </div>
                <div role="tablist" className="mt-2 flex gap-5">
                  {(['input', 'output', 'logs'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      onClick={() => setTab(key)}
                      className={`-mb-px h-9 border-b-2 px-0.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === key ? 'border-foreground text-foreground' : 'border-transparent text-text-2 hover:text-foreground'}`}
                    >
                      {key === 'output' && selectedStep.status === 'FAILED' ? t('runs.tab_error') : t(`runs.tab_${key}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{stepBody.caption}</span>
                  <button type="button" onClick={() => void copy()} disabled={!stepBody.body} className="h-6 rounded px-1.5 font-medium text-text-2 hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
                    {copied ? t('runs.copied') : t('runs.copy')}
                  </button>
                </div>
                {stepBody.body ? (
                  <pre className={`m-0 overflow-x-auto whitespace-pre-wrap break-words rounded-md border p-3 font-mono text-xs leading-relaxed ${stepBody.isError ? 'border-err-border bg-err-bg text-foreground' : 'border-border bg-subtle text-foreground'}`}>{stepBody.body}</pre>
                ) : (
                  <p className="rounded-md border border-border bg-subtle p-3 text-xs text-text-2">
                    {tab === 'input' ? t('runs.input_unavailable') : tab === 'logs' ? t('runs.no_logs') : t('runs.no_output')}
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="p-6 text-center text-[13px] text-text-2">{t('runs.select_step')}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
