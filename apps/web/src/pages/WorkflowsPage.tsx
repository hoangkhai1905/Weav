import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { primaryTrigger, triggerTypeLabel } from '../lib/executions/runView';
import { Copy, Edit3, History, MoreHorizontal, Pause, Play, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import type { ExecutionDetail, WorkflowDefinition } from '../types/workflow.types';
import { workflowApi } from '../api/workflow.api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRecentExecutions, fetchWorkflowList, invalidateWorkflowQueries, workflowRunStatsKey } from '../lib/queries/workflows';
import { WorkflowGlyph } from '../components/workflows/WorkflowGlyph';
import { StatusBadge } from '../components/common/StatusBadge';
import { statusBadgeClass } from '../components/common/statusBadgeClass';
import { TypedConfirmDialog } from '../components/common/TypedConfirmDialog';
import { REDUCED_MOTION_TRANSITION } from '../lib/motion';
import { useI18nStore } from '../store/useI18nStore';
import { captureNotificationSession, isCurrentNotificationSession } from '../lib/notifications/session';
import { showSuccessToast } from '../lib/feedback/toast';
import { useNotificationMilestoneRefresh } from '../hooks/useNotificationMilestoneRefresh';
import { tr } from '../lib/i18n/tr';
import { formatRelativeTime } from '../lib/relativeTime';

type WorkflowStatus = 'PUBLISHED' | 'PAUSED' | 'DRAFT';
type StatusTab = 'ALL' | 'ACTIVE' | 'ERROR' | 'PAUSED' | 'DRAFT';
type SortKey = 'LAST_RUN' | 'ERROR_RATE' | 'NAME' | 'NEWEST';

interface RunStats {
  lastAt?: string;
  lastStatus?: ExecutionDetail['status'];
  runs7d: number;
  failed7d: number;
  /** Type of the latest automatic (non-manual) run: proof of a real trigger the list API does not return. */
  autoTrigger?: string;
  autoTriggerAt?: number;
}

interface WorkflowItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  triggerType: string;
  triggerTypes?: string[];
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const field =
  'h-8 rounded-md border border-border-strong bg-card px-2.5 text-[13px] text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50';
const btn =
  'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50';
const btnPrimary =
  'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-primary bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:border-primary-hover hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50';
const iconBtn =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

function computeStats(executions: ExecutionDetail[]): Record<string, RunStats> {
  const now = Date.now();
  const stats: Record<string, RunStats> = {};
  for (const execution of executions) {
    const startedMs = Date.parse(execution.startedAt);
    const entry = (stats[execution.workflowId] ??= { runs7d: 0, failed7d: 0 });
    if (execution.triggerType.toUpperCase() !== 'MANUAL' && (entry.autoTriggerAt ?? -1) < (startedMs || 0)) {
      entry.autoTrigger = execution.triggerType;
      entry.autoTriggerAt = startedMs || 0;
    }
    if (Number.isFinite(startedMs)) {
      if (!entry.lastAt || startedMs > Date.parse(entry.lastAt)) {
        entry.lastAt = execution.startedAt;
        entry.lastStatus = execution.status;
      }
      if (now - startedMs <= WEEK_MS) {
        entry.runs7d += 1;
        if (execution.status === 'FAILED') entry.failed7d += 1;
      }
    }
  }
  return stats;
}

export function WorkflowsPage() {
  const refreshNotifications = useNotificationMilestoneRefresh();
  const { language, t } = useI18nStore();
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const locale = language === 'VI' ? 'vi-VN' : 'en-US';

  const [workflowsList, setWorkflowsList] = useState<WorkflowItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<StatusTab>('ALL');
  const [triggerFilter, setTriggerFilter] = useState('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('LAST_RUN');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const closeMenu = (id: string) => {
    setActiveMenuId(null);
    requestAnimationFrame(() => menuButtonRefs.current[id]?.focus());
  };

  const queryClient = useQueryClient();

  const loadWorkflows = useCallback(async (force = false) => {
    try {
      const data = await fetchWorkflowList(queryClient, { force });
      setLoadError(null);
      const mapped: WorkflowItem[] = data.map((wf: WorkflowDefinition) => ({
        id: wf.id,
        code: wf.id.slice(0, 8),
        name: wf.name,
        description: wf.description,
        status: wf.status as WorkflowStatus,
        triggerType: wf.triggerType,
        ...(wf.triggerTypes ? { triggerTypes: wf.triggerTypes } : {}),
        ownerName: wf.ownerName ?? '',
        createdAt: wf.createdAt,
        updatedAt: wf.updatedAt,
        lastRunAt: wf.lastRunAt,
      }));
      setWorkflowsList(mapped);
      setIsLoading(false);
    } catch (error) {
      setWorkflowsList([]);
      setLoadError(error instanceof Error ? error.message : t('workflows.load_error_fallback'));
      setIsLoading(false);
    }
  }, [t, queryClient]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  // Run statistics come from a cached, bounded query (20 workflows, 3 at a time) and never block the list.
  const statsQuery = useQuery({
    queryKey: workflowRunStatsKey(),
    enabled: workflowsList.some((wf) => wf.status !== 'DRAFT'),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    queryFn: () => fetchRecentExecutions(queryClient),
    select: computeStats,
  });
  const stats = useMemo<Record<string, RunStats>>(() => statsQuery.data ?? {}, [statsQuery.data]);

  const handleCreate = async () => {
    setApiError(null);
    const mutationSession = captureNotificationSession();
    try {
      const newWf = await workflowApi.createWorkflow({ name: 'New AI Workflow' });
      if (!isCurrentNotificationSession(mutationSession)) return;
      void invalidateWorkflowQueries(queryClient);
      showSuccessToast('toast.workflow.created', mutationSession);
      refreshNotifications(mutationSession);
      navigate(`/workflows/${newWf.id}/builder`);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) {
        setApiError(error instanceof Error ? error.message : tr('msg.workflow_could_not_be_created'));
      }
    }
  };

  const handleRun = async (id: string) => {
    setApiError(null);
    const mutationSession = captureNotificationSession();
    try {
      const accepted = await workflowApi.runWorkflow(id);
      if (!isCurrentNotificationSession(mutationSession)) return;
      void queryClient.invalidateQueries({ queryKey: workflowRunStatsKey() });
      showSuccessToast('toast.workflow.run_accepted', mutationSession);
      navigate(`/workflows/${encodeURIComponent(id)}/executions?run=${encodeURIComponent(accepted.executionId)}`);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) {
        setApiError(error instanceof Error ? error.message : tr('msg.workflow_could_not_be_started'));
      }
    }
  };

  const handleTogglePause = async (workflow: WorkflowItem) => {
    setApiError(null);
    const mutationSession = captureNotificationSession();
    try {
      if (workflow.status === 'PAUSED') await workflowApi.resumeWorkflow(workflow.id);
      else if (workflow.status === 'PUBLISHED') await workflowApi.pauseWorkflow(workflow.id);
      else throw new Error(tr('msg.only_published_workflows_can_be_paused'));
      if (!isCurrentNotificationSession(mutationSession)) return;
      showSuccessToast(workflow.status === 'PAUSED' ? 'toast.workflow.resumed' : 'toast.workflow.paused', mutationSession);
      refreshNotifications(mutationSession);
      await loadWorkflows(true);
      setActiveMenuId(null);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) {
        setApiError(error instanceof Error ? error.message : tr('msg.workflow_status_could_not_be_changed'));
      }
    }
  };

  const handleDuplicate = async (id: string) => {
    setApiError(null);
    try {
      const duplicate = await workflowApi.duplicateWorkflow(id);
      void invalidateWorkflowQueries(queryClient);
      navigate(`/workflows/${duplicate.id}/builder`);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : tr('msg.workflow_could_not_be_duplicated'));
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteIds) return;
    setDeleteLoading(true);
    try {
      for (const id of deleteIds) {
        await workflowApi.deleteWorkflow(id);
      }
      void invalidateWorkflowQueries(queryClient);
      setWorkflowsList((current) => current.filter((workflow) => !deleteIds.includes(workflow.id)));
      setSelectedIds((current) => {
        const next = new Set(current);
        deleteIds.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteIds(null);
    } catch (error) {
      setDeleteIds(null);
      setApiError(error instanceof Error ? error.message : tr('msg.workflow_could_not_be_deleted'));
    } finally {
      setDeleteLoading(false);
    }
  };

  const hasStats = Object.keys(stats).length > 0;
  const isErrored = useCallback(
    (wf: WorkflowItem) => wf.status === 'PUBLISHED' && stats[wf.id]?.lastStatus === 'FAILED',
    [stats],
  );
  // The API's triggerTypes decide (a real trigger beats a legacy manual node); an older API without the field falls
  // back to the latest automatic run, which proves a real trigger.
  const triggerOf = useCallback(
    (wf: WorkflowItem) => (wf.triggerTypes ? primaryTrigger(wf.triggerTypes) ?? wf.triggerType : stats[wf.id]?.autoTrigger ?? wf.triggerType),
    [stats],
  );
  const lastRunOf = useCallback((wf: WorkflowItem) => stats[wf.id]?.lastAt ?? wf.lastRunAt, [stats]);

  const counts = useMemo(
    () => ({
      ALL: workflowsList.length,
      ACTIVE: workflowsList.filter((w) => w.status === 'PUBLISHED').length,
      ERROR: workflowsList.filter(isErrored).length,
      PAUSED: workflowsList.filter((w) => w.status === 'PAUSED').length,
      DRAFT: workflowsList.filter((w) => w.status === 'DRAFT').length,
    }),
    [workflowsList, isErrored],
  );

  const triggerOptions = useMemo(
    () => Array.from(new Set(workflowsList.map(triggerOf).filter(Boolean))).sort(),
    [workflowsList, triggerOf],
  );

  const triggerLabel = useCallback((type: string) => triggerTypeLabel(type, t), [t]);

  const errorRate = useCallback(
    (wf: WorkflowItem) => {
      const s = stats[wf.id];
      return s && s.runs7d > 0 ? s.failed7d / s.runs7d : null;
    },
    [stats],
  );

  const filteredWorkflows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = workflowsList.filter((wf) => {
      if (q && !wf.name.toLowerCase().includes(q) && !wf.code.toLowerCase().includes(q) && !triggerLabel(triggerOf(wf)).toLowerCase().includes(q) && !wf.ownerName.toLowerCase().includes(q)) return false;
      if (triggerFilter !== 'ALL' && triggerOf(wf) !== triggerFilter) return false;
      if (activeTab === 'ACTIVE') return wf.status === 'PUBLISHED';
      if (activeTab === 'ERROR') return isErrored(wf);
      if (activeTab === 'PAUSED') return wf.status === 'PAUSED';
      if (activeTab === 'DRAFT') return wf.status === 'DRAFT';
      return true;
    });
    const time = (value?: string) => (value ? Date.parse(value) || 0 : 0);
    return [...list].sort((a, b) => {
      if (sortKey === 'NAME') return a.name.localeCompare(b.name, locale);
      if (sortKey === 'NEWEST') return time(b.createdAt) - time(a.createdAt);
      if (sortKey === 'ERROR_RATE') return (errorRate(b) ?? -1) - (errorRate(a) ?? -1);
      return time(lastRunOf(b)) - time(lastRunOf(a)) || time(b.updatedAt) - time(a.updatedAt);
    });
  }, [workflowsList, search, triggerFilter, activeTab, sortKey, locale, isErrored, errorRate, lastRunOf, triggerLabel, triggerOf]);

  const selectedVisibleCount = filteredWorkflows.filter((w) => selectedIds.has(w.id)).length;
  const allSelected = filteredWorkflows.length > 0 && selectedVisibleCount === filteredWorkflows.length;

  const handleToggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(filteredWorkflows.map((w) => w.id)));
  };

  const handleToggleSelectRow = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const relativeTime = useCallback(
    (iso?: string) => (iso ? formatRelativeTime(iso, locale) : t('relative.never')),
    [locale, t],
  );
  const exactTime = (iso?: string) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString(locale) : undefined);

  const statusBadge = (wf: WorkflowItem) => {
    if (isErrored(wf)) {
      return (
        <Link
          to={`/workflows/${encodeURIComponent(wf.id)}/executions`}
          title={t('workflows.view_failed_runs')}
          className={`${statusBadgeClass('err')} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
          {t('workflows.status_error')}
        </Link>
      );
    }
    if (wf.status === 'PUBLISHED') return <StatusBadge tone="ok">{t('workflows.status_on')}</StatusBadge>;
    if (wf.status === 'PAUSED') return <StatusBadge tone="pause">{t('workflows.tab_paused')}</StatusBadge>;
    return <StatusBadge tone="pause">{t('workflows.tab_draft')}</StatusBadge>;
  };

  const tabs: Array<{ key: StatusTab; label: string; count: number | null }> = [
    { key: 'ALL', label: t('workflows.tab_all'), count: counts.ALL },
    { key: 'ACTIVE', label: t('workflows.status_on'), count: counts.ACTIVE },
    { key: 'ERROR', label: t('workflows.status_error'), count: hasStats ? counts.ERROR : null },
    { key: 'PAUSED', label: t('workflows.tab_paused'), count: counts.PAUSED },
    { key: 'DRAFT', label: t('workflows.tab_draft'), count: counts.DRAFT },
  ];

  const hasFilters = search.trim() !== '' || triggerFilter !== 'ALL' || activeTab !== 'ALL';
  const clearFilters = () => {
    setSearch('');
    setTriggerFilter('ALL');
    setActiveTab('ALL');
  };

  const deleteTargets = workflowsList.filter((w) => deleteIds?.includes(w.id));
  const deleteCount = deleteIds?.length ?? 0;
  const deletePhrase = `${t('workflows.delete_word')} ${deleteCount}`;
  const showOwner = workflowsList.some((w) => w.ownerName);
  const columnCount = showOwner ? 9 : 8;
  const showToolbar = !loadError && (isLoading || workflowsList.length > 0);
  const th = 'h-8 whitespace-nowrap border-b border-border bg-subtle px-3 text-left text-xs font-medium text-muted-foreground';
  const td = 'h-10 overflow-hidden text-ellipsis whitespace-nowrap border-b border-border px-3';

  return (
    <div className="-m-4 flex h-[calc(100%+2rem)] min-h-0 flex-col bg-card sm:-m-5 sm:h-[calc(100%+2.5rem)]">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-5 py-2">
        <h1 className="text-base font-semibold text-foreground">{t('workflows.title')}</h1>
        {!isLoading && !loadError && workflowsList.length > 0 && (
          <span className="tabular-nums text-muted-foreground">
            {t('workflows.summary').replace('{total}', String(counts.ALL)).replace('{active}', String(counts.ACTIVE))}
          </span>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          <Link to="/ai/workflow-generator" className={btn}>
            <Sparkles size={14} aria-hidden="true" />
            {t('nav.ai_generator')}
          </Link>
          <button type="button" className={btn}>
            {t('workflows.import')}
          </button>
          <button type="button" onClick={handleCreate} className={btnPrimary}>
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            {t('dashboard.new_workflow')}
          </button>
        </span>
      </header>

      {apiError && (
        <div role="alert" data-testid="workflow-api-error" className="shrink-0 border-b border-err-border bg-err-bg px-5 py-2 text-[13px] text-err">
          {apiError}
        </div>
      )}

      {showToolbar && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-2">
          <label className="relative flex w-full items-center sm:w-[260px]">
            <span className="sr-only">{t('workflows.search_placeholder')}</span>
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-muted-foreground" />
            <input
              type="text"
              data-testid="workflow-search"
              placeholder={t('workflows.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${field} w-full pl-[30px] pr-8`}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label={t('workflows.bulk_clear')}
                className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={13} />
              </button>
            )}
          </label>

          <div role="group" aria-label={t('workflows.filter_status')} className="inline-flex gap-0.5 rounded-md bg-muted p-0.5">
            {tabs.map((tab) => {
              const on = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  data-testid={`workflow-stat-${tab.key.toLowerCase()}`}
                  aria-pressed={on}
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    on ? 'bg-card text-foreground shadow-[0_0_0_1px_var(--border)]' : 'text-text-2 hover:text-foreground'
                  }`}
                >
                  {tab.label}
                  {tab.count !== null && <span className="font-normal tabular-nums text-muted-foreground">{tab.count}</span>}
                </button>
              );
            })}
          </div>

          <label className="flex">
            <span className="sr-only">{t('workflows.filter_trigger')}</span>
            <select value={triggerFilter} onChange={(e) => setTriggerFilter(e.target.value)} className={field}>
              <option value="ALL">{t('workflows.trigger_all')}</option>
              {triggerOptions.map((type) => (
                <option key={type} value={type}>
                  {triggerLabel(type)}
                </option>
              ))}
            </select>
          </label>

          <label className="ml-auto flex">
            <span className="sr-only">{t('workflows.sort')}</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className={field}>
              <option value="LAST_RUN">{t('workflows.sort_last_run')}</option>
              <option value="ERROR_RATE">{t('workflows.sort_error_rate')}</option>
              <option value="NAME">{t('workflows.sort_name')}</option>
              <option value="NEWEST">{t('workflows.sort_newest')}</option>
            </select>
          </label>
        </div>
      )}

      <AnimatePresence initial={false}>
        {selectedIds.size > 0 && !loadError && (
          <motion.div
            role="region"
            aria-label={t('workflows.bulk_region')}
            data-testid="workflow-bulk-actions"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={prefersReducedMotion ? REDUCED_MOTION_TRANSITION : { duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-accent px-5 py-1.5"
            aria-live="polite"
          >
            <span className="font-medium tabular-nums text-foreground">
              {selectedIds.size} {t('workflows.bulk_selected')}
            </span>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="inline-flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium text-text-2 transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('workflows.bulk_clear')}
            </button>
            <>
            <span aria-hidden="true" className="mx-1 h-[18px] w-px bg-border-strong" />
            <button
              type="button"
              aria-label={t('workflows.bulk_delete')}
              onClick={() => setDeleteIds(Array.from(selectedIds))}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-err-border bg-card px-2.5 text-[13px] font-medium text-err transition-colors hover:bg-err-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 size={13} aria-hidden="true" />
              {t('workflows.btn_delete')}…
            </button>
              </>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="min-h-0 flex-1 overflow-auto">
        {loadError ? (
          <div role="alert" data-testid="workflow-load-error" className="px-5 py-12">
            <div className="mx-auto max-w-[560px] rounded-lg border border-err-border bg-err-bg p-4">
              <div className="text-sm font-semibold text-err">{t('workflows.load_error_title')}</div>
              <p className="mt-1.5 break-words text-foreground">{loadError}</p>
              <p className="mt-1.5 text-xs text-text-2">{t('workflows.load_error_hint')}</p>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsLoading(true);
                    void loadWorkflows(true);
                  }}
                  className={btn}
                >
                  {t('topbar.retry')}
                </button>
              </div>
            </div>
          </div>
        ) : isLoading ? (
          <div role="status" aria-label={t('workflows.loading')}>
            <div className="h-8 border-b border-border bg-subtle" />
            {[62, 48, 70, 55, 40, 66, 52, 58].map((width, row) => (
              <div key={row} className="flex h-10 items-center gap-6 border-b border-border px-3">
                <span className="h-4 w-4 animate-pulse rounded bg-muted" />
                <span className="h-2.5 animate-pulse rounded bg-muted" style={{ width: `${width}%` }} />
                <span className="ml-auto h-4 w-14 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : workflowsList.length === 0 ? (
          <div className="px-5 py-12">
            <div className="mx-auto max-w-[640px]">
              <h2 className="text-xl font-semibold text-foreground">{t('workflows.empty_title')}</h2>
              <p className="mt-2 text-sm text-text-2">{t('workflows.empty_description')}</p>
              <ol className="mt-5 list-none rounded-lg border border-border p-0">
                <li className="flex gap-3 border-b border-border px-3.5 py-3">
                  <span className="font-mono tabular-nums text-muted-foreground">1</span>
                  <span>
                    <strong className="font-medium">{t('workflows.empty_step1_title')}</strong>{' '}
                    <span className="text-text-2">
                      {t('workflows.empty_step1_desc')}{' '}
                      <Link to="/workspace/connections" className="text-accent-ink hover:underline">
                        {t('workflows.empty_open_connections')}
                      </Link>
                    </span>
                  </span>
                </li>
                <li className="flex gap-3 border-b border-border px-3.5 py-3">
                  <span className="font-mono tabular-nums text-muted-foreground">2</span>
                  <span>
                    <strong className="font-medium">{t('workflows.empty_step2_title')}</strong>{' '}
                    <span className="text-text-2">{t('workflows.empty_step2_desc')}</span>
                  </span>
                </li>
                <li className="flex gap-3 px-3.5 py-3">
                  <span className="font-mono tabular-nums text-muted-foreground">3</span>
                  <span>
                    <strong className="font-medium">{t('workflows.empty_step3_title')}</strong>{' '}
                    <span className="text-text-2">{t('workflows.empty_step3_desc')}</span>
                  </span>
                </li>
              </ol>
              <div className="mt-5 flex gap-2">
                <button type="button" onClick={handleCreate} className={btnPrimary}>
                  {t('workflows.empty_create')}
                </button>
                <Link to="/ai/workflow-generator" className={btn}>
                  <Sparkles size={14} aria-hidden="true" />
                  {t('nav.ai_generator')}
                </Link>
              </div>
            </div>
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <h3 className="text-sm font-semibold text-foreground">{t('workflows.no_results')}</h3>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-text-2">{t('workflows.no_results_description')}</p>
            {hasFilters && (
              <button type="button" onClick={clearFilters} className={`${btn} mt-4`}>
                {t('workflows.clear_filters')}
              </button>
            )}
          </div>
        ) : (
          <table className="w-full min-w-[960px] table-fixed border-collapse text-[13px]">
            <colgroup>
              <col style={{ width: 44 }} />
              <col />
              <col style={{ width: 112 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 104 }} />
              <col style={{ width: 92 }} />
              {showOwner && <col style={{ width: 150 }} />}
              <col style={{ width: 124 }} />
            </colgroup>
            <thead>
              <tr>
                <th className={th}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={handleToggleSelectAll}
                    className="m-0 h-4 w-4 cursor-pointer accent-[var(--primary)]"
                    aria-label={t('workflows.select_all')}
                  />
                </th>
                <th className={th}>{t('workflows.col_name')}</th>
                <th className={th}>{t('workflows.col_status')}</th>
                <th className={th}>{t('workflows.col_trigger')}</th>
                <th className={th}>{t('workflows.col_last_run')}</th>
                <th className={`${th} text-right`}>{t('workflows.col_errors_7d')}</th>
                <th className={`${th} text-right`}>{t('workflows.col_runs_7d')}</th>
                {showOwner && <th className={th}>{t('workflows.col_owner')}</th>}
                <th className={th}>
                  <span className="sr-only">{t('workflows.col_actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredWorkflows.map((wf) => {
                const isSelected = selectedIds.has(wf.id);
                const rowStats = stats[wf.id];
                const rate = errorRate(wf);
                const lastAt = lastRunOf(wf);
                const lastMark = rowStats?.lastStatus
                  ? rowStats.lastStatus === 'SUCCESS'
                    ? { mark: '✓', cls: 'text-ok' }
                    : rowStats.lastStatus === 'FAILED'
                      ? { mark: '✕', cls: 'text-err' }
                      : rowStats.lastStatus === 'RUNNING' || rowStats.lastStatus === 'QUEUED'
                        ? { mark: '●', cls: 'text-run' }
                        : { mark: '–', cls: 'text-muted-foreground' }
                  : { mark: '–', cls: 'text-muted-foreground' };

                return (
                  <tr
                    key={wf.id}
                    data-testid="workflow-row"
                    data-status={wf.status}
                    className={`transition-colors ${isSelected ? 'bg-accent' : 'hover:bg-subtle'}`}
                  >
                    <td className={td}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelectRow(wf.id)}
                        className="m-0 h-4 w-4 cursor-pointer accent-[var(--primary)]"
                        aria-label={`${t('workflows.select')} ${wf.name}`}
                      />
                    </td>
                    <td className={td} title={wf.name}>
                      <Link
                        to={`/workflows/${wf.id}/builder`}
                        className="font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {wf.name}
                      </Link>
                    </td>
                    <td className={td}>{statusBadge(wf)}</td>
                    <td className={`${td} text-text-2`} title={triggerLabel(triggerOf(wf))}>
                      <span className="inline-flex items-center gap-2">
                        <WorkflowGlyph triggerType={triggerOf(wf)} status={wf.status === 'PUBLISHED' ? 'SUCCESS' : wf.status} />
                        {triggerLabel(triggerOf(wf))}
                      </span>
                    </td>
                    <td className={td} title={exactTime(lastAt)}>
                      <span className={lastMark.cls} aria-hidden="true">
                        {lastMark.mark}
                      </span>{' '}
                      <span className="tabular-nums text-text-2">{relativeTime(lastAt)}</span>
                    </td>
                    <td
                      className={`${td} text-right tabular-nums ${rate === null ? 'text-muted-foreground' : rate >= 0.1 ? 'text-err' : rate >= 0.02 ? 'text-warn' : 'text-text-2'}`}
                    >
                      {rate === null ? '—' : `${(rate * 100).toFixed(1).replace('.', language === 'VI' ? ',' : '.')}%`}
                    </td>
                    <td className={`${td} text-right tabular-nums text-text-2`}>
                      {rowStats ? rowStats.runs7d.toLocaleString(locale) : '—'}
                    </td>
                    {showOwner && <td className={`${td} text-text-2`}>{wf.ownerName || '—'}</td>}
                    {/* No overflow-hidden here: it would clip the row menu below. */}
                    <td className="relative h-10 whitespace-nowrap border-b border-border px-3">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => void handleRun(wf.id)}
                          disabled={wf.status !== 'PUBLISHED'}
                          className={iconBtn}
                          title={wf.status === 'PUBLISHED' ? t('workflows.trigger_execution') : t('workflows.btn_publish')}
                          aria-label={`${t('workflows.trigger_execution')}: ${wf.name}`}
                        >
                          <Play size={14} />
                        </button>
                        <Link
                          to={`/workflows/${wf.id}/builder`}
                          className={iconBtn}
                          title={t('workflows.edit_studio')}
                          aria-label={`${t('workflows.edit_studio')}: ${wf.name}`}
                        >
                          <Edit3 size={14} />
                        </Link>
                        <button
                          type="button"
                          ref={(element) => {
                            menuButtonRefs.current[wf.id] = element;
                          }}
                          onClick={() => setActiveMenuId(activeMenuId === wf.id ? null : wf.id)}
                          className={`${iconBtn} ${activeMenuId === wf.id ? 'bg-muted text-foreground' : ''}`}
                          title={t('workflows.more_actions')}
                          aria-label={`${t('workflows.more_actions')}: ${wf.name}`}
                          aria-haspopup="menu"
                          aria-expanded={activeMenuId === wf.id}
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </div>

                      <AnimatePresence>
                        {activeMenuId === wf.id && (
                          <motion.div
                            role="menu"
                            aria-label={`${t('workflows.more_actions')}: ${wf.name}`}
                            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={prefersReducedMotion ? REDUCED_MOTION_TRANSITION : { duration: 0.12 }}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') closeMenu(wf.id);
                            }}
                            className="absolute right-3 top-9 z-30 flex w-48 flex-col rounded-lg border border-border bg-popover p-1 text-left text-[13px] text-popover-foreground shadow-pop"
                          >
                            <Link
                              role="menuitem"
                              to={`/workflows/${encodeURIComponent(wf.id)}/executions`}
                              className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <History size={14} className="text-muted-foreground" />
                              <span>{t('nav.executions')}</span>
                            </Link>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => void handleDuplicate(wf.id)}
                              className="flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Copy size={14} className="text-muted-foreground" />
                              <span>{t('workflows.btn_duplicate')}</span>
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => void handleTogglePause(wf)}
                              disabled={wf.status === 'DRAFT'}
                              title={wf.status === 'DRAFT' ? t('workflows.publish_before_pause') : undefined}
                              className="flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {wf.status === 'PAUSED' ? (
                                <>
                                  <Play size={14} className="text-ok" />
                                  <span>{t('workflows.btn_resume')}</span>
                                </>
                              ) : (
                                <>
                                  <Pause size={14} className="text-warn" />
                                  <span>{t('workflows.btn_pause')}</span>
                                </>
                              )}
                            </button>
                            <>
                            <div className="my-1 h-px bg-border" />
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                closeMenu(wf.id);
                                setDeleteIds([wf.id]);
                              }}
                              className="flex h-8 items-center gap-2 rounded-md px-2 text-left font-medium text-err hover:bg-err-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Trash2 size={14} />
                              <span>{t('workflows.btn_delete')}…</span>
                            </button>
                              </>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={columnCount} className="h-11 px-5 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {t('workflows.showing')} {filteredWorkflows.length} / {workflowsList.length}
                  </span>
                  {hasStats && (
                    <span className="ml-4 inline-flex items-center gap-1">
                      {t('workflows.error_badge_hint')}
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <TypedConfirmDialog
        isOpen={deleteIds !== null}
        onClose={() => setDeleteIds(null)}
        onConfirm={handleConfirmDelete}
        title={deleteCount > 1 ? t('workflows.bulk_delete_title') : t('workflows.delete_one_title')}
        consequences={[
          <>
            <strong className="font-semibold text-err">
              {deleteTargets.filter((w) => w.status === 'PUBLISHED').length} {t('workflows.delete_active_stop')}
            </strong>{' '}
            {t('workflows.delete_active_detail')}
          </>,
          t('workflows.delete_history'),
          t('workflows.delete_connections_kept'),
        ]}
        phrase={deletePhrase}
        phraseLabel={
          <>
            {t('workflows.delete_type_prefix')} <span className="font-mono text-foreground">{deletePhrase}</span>{' '}
            {t('workflows.delete_type_suffix')}
          </>
        }
        confirmText={t('workflows.bulk_delete_confirm')}
        cancelText={t('workflows.bulk_delete_cancel')}
        closeLabel={t('workflows.delete_close')}
        loading={deleteLoading}
      />
    </div>
  );
}
