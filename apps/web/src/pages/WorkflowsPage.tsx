import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { primaryTrigger, triggerTypeLabel } from '../lib/executions/runView';
import { Copy, Edit3, History, MoreHorizontal, Pause, Play, Plus, Search, Trash2, X } from 'lucide-react';
import type { ExecutionDetail, WorkflowDefinition } from '../types/workflow.types';
import { isWorkflowMockMode, workflowApi } from '../api/workflow.api';
import { getActiveWorkflowWorkspaceId, workflowRequest, workflowV1Api } from '../api/workflow-v1.api';
import { WORKFLOW_FILE_MAX_BYTES, buildDraftBody, importedWorkflowName, parseWorkflowFile } from '../lib/workflowTransfer';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRecentExecutions, fetchWorkflowList, invalidateWorkflowQueries, workflowRunStatsKey } from '../lib/queries/workflows';
import { statusBadgeClass } from '../components/common/statusBadgeClass';
import { TypedConfirmDialog } from '../components/common/TypedConfirmDialog';
import { NoWorkspaceNotice } from '../components/common/NoWorkspaceNotice';
import { isNoWorkspaceError } from '../api/workflow-v1.api';
import { REDUCED_MOTION_TRANSITION } from '../lib/motion';
import { useI18nStore } from '../store/useI18nStore';
import { useUIStore } from '../store/useUIStore';
import { captureNotificationSession, isCurrentNotificationSession } from '../lib/notifications/session';
import { showSuccessToast } from '../lib/feedback/toast';
import { useNotificationMilestoneRefresh } from '../hooks/useNotificationMilestoneRefresh';
import { tr } from '../lib/i18n/tr';
import { formatRelativeTime } from '../lib/relativeTime';
import { runTone } from '../lib/monitoring/format';
import { nodeLabel } from '../lib/nodeLabels';
import { describeWorkflow, orderedStepTypes } from '../lib/workflowSummary';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { BTN_PRIMARY, BTN_SECONDARY, CARD, FOCUS_RING, ICON_BTN } from '../lib/uiClasses';

type WorkflowStatus = 'PUBLISHED' | 'PAUSED' | 'DRAFT';
type StatusTab = 'ALL' | 'ACTIVE' | 'PAUSED' | 'DRAFT';
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
  'h-9 rounded-md border border-border-strong bg-card px-2.5 text-[13px] text-foreground outline-none transition-colors hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

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
  const openAiGenerator = useUIStore((state) => state.openAiGenerator);
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const locale = language === 'VI' ? 'vi-VN' : 'en-US';

  const [workflowsList, setWorkflowsList] = useState<WorkflowItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [noWorkspace, setNoWorkspace] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<StatusTab>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('LAST_RUN');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  // The table card scrolls horizontally (overflow clips vertically too), so the row menu is fixed-positioned from its trigger.
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [switching, setSwitching] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!activeMenuId) return;
    const dismiss = () => setActiveMenuId(null);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [activeMenuId]);

  const closeMenu = (id: string) => {
    setActiveMenuId(null);
    requestAnimationFrame(() => menuButtonRefs.current[id]?.focus());
  };

  const queryClient = useQueryClient();

  const loadWorkflows = useCallback(async (force = false) => {
    try {
      const data = await fetchWorkflowList(queryClient, { force });
      setLoadError(null);
      setNoWorkspace(false);
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
      if (isNoWorkspaceError(error)) setNoWorkspace(true);
      else setLoadError(error instanceof Error ? error.message : t('workflows.load_error_fallback'));
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

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importBusyRef = useRef(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const picked = input.files?.[0];
    input.value = ''; // lets the same file be chosen again
    if (!picked || importBusyRef.current) return;
    importBusyRef.current = true;
    setIsImporting(true);
    setApiError(null);
    let workspaceId: string | null = null;
    let createdId: string | null = null;
    const mutationSession = captureNotificationSession();
    try {
      if (isWorkflowMockMode) {
        setApiError(t('workflows.transfer.unavailable'));
        return;
      }
      if (picked.size > WORKFLOW_FILE_MAX_BYTES) {
        setApiError(t('workflows.transfer.err.too_large'));
        return;
      }
      let text: string;
      try {
        text = await picked.text();
      } catch {
        setApiError(t('workflows.transfer.err.unreadable'));
        return;
      }
      const parsed = parseWorkflowFile(text, picked.size);
      if (!parsed.ok) {
        setApiError(t(parsed.error));
        return;
      }
      const { file } = parsed;
      const description = file.description ?? undefined;
      // One workspace for create, draft save and cleanup, even if the user switches workspace meanwhile.
      workspaceId = await getActiveWorkflowWorkspaceId();
      const created = await workflowV1Api.createWorkflow(
        { name: importedWorkflowName(file.name, t('workflows.transfer.suffix')), ...(description ? { description } : {}) },
        workspaceId,
      );
      createdId = created.id;
      await workflowRequest(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/workflows/${encodeURIComponent(created.id)}/draft`, {
        method: 'PUT',
        body: JSON.stringify(buildDraftBody(created.name, file)),
      });
      if (!isCurrentNotificationSession(mutationSession)) return;
      void invalidateWorkflowQueries(queryClient);
      showSuccessToast('workflows.transfer.done', mutationSession);
      navigate(`/workflows/${created.id}/builder`);
    } catch (error) {
      if (isNoWorkspaceError(error)) {
        // Nothing was created yet: the workspace lookup is the first remote call.
        setNoWorkspace(true);
        return;
      }
      let message = error instanceof Error ? error.message : t('workflows.transfer.failed');
      if (createdId && workspaceId) {
        // No junk drafts: the draft was rejected, so remove the empty workflow created for it.
        try {
          await workflowV1Api.deleteWorkflow(createdId, workspaceId);
        } catch {
          message = `${message} ${t('workflows.transfer.cleanup_failed')}`;
        }
        void invalidateWorkflowQueries(queryClient);
      }
      if (isCurrentNotificationSession(mutationSession)) setApiError(message);
    } finally {
      importBusyRef.current = false;
      setIsImporting(false);
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

  /** The on/off switch of a row: published <-> paused (drafts have no switch). */
  const handleSwitch = async (workflow: WorkflowItem) => {
    if (switching.has(workflow.id)) return;
    setSwitching((current) => new Set(current).add(workflow.id));
    try {
      await handleTogglePause(workflow);
    } finally {
      setSwitching((current) => {
        const next = new Set(current);
        next.delete(workflow.id);
        return next;
      });
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
      PAUSED: workflowsList.filter((w) => w.status === 'PAUSED').length,
      DRAFT: workflowsList.filter((w) => w.status === 'DRAFT').length,
    }),
    [workflowsList],
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
      if (activeTab === 'ACTIVE') return wf.status === 'PUBLISHED';
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
  }, [workflowsList, search, activeTab, sortKey, locale, errorRate, lastRunOf, triggerLabel, triggerOf]);

  // Each row's "what it does" sentence needs the steps, which the list API does not return: load the detail of the first
  // rows (cached 60s, bounded) and fall back to the trigger line alone for the rest.
  const workspaceKey = useWorkspaceStore((state) => state.activeWorkspaceId) ?? 'active';
  const stepIds = useMemo(() => filteredWorkflows.slice(0, 20).map((wf) => wf.id), [filteredWorkflows]);
  const updatedById = useMemo(() => new Map(workflowsList.map((wf) => [wf.id, wf.updatedAt])), [workflowsList]);
  const stepResults = useQueries({
    queries: stepIds.map((id) => ({
      queryKey: ['workflows', 'steps', workspaceKey, id, updatedById.get(id) ?? ''],
      queryFn: () => workflowApi.getWorkflow(id),
      staleTime: 60_000,
      retry: false,
      select: (workflow: WorkflowDefinition | null) => (workflow ? orderedStepTypes(workflow.nodes, workflow.edges) : []),
    })),
  });
  const stepsById: Record<string, string[]> = {};
  stepIds.forEach((id, index) => {
    const data = stepResults[index]?.data;
    if (data) stepsById[id] = data;
  });
  const labelOf = (type: string) => nodeLabel(type, t);

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

  const tabs: Array<{ key: StatusTab; label: string; count: number }> = [
    { key: 'ALL', label: t('workflows.tab_all'), count: counts.ALL },
    { key: 'ACTIVE', label: t('workflows.status_on'), count: counts.ACTIVE },
    { key: 'PAUSED', label: t('workflows.tab_paused'), count: counts.PAUSED },
    { key: 'DRAFT', label: t('workflows.tab_draft'), count: counts.DRAFT },
  ];

  const hasFilters = search.trim() !== '' || activeTab !== 'ALL';
  const clearFilters = () => {
    setSearch('');
    setActiveTab('ALL');
  };

  const deleteTargets = workflowsList.filter((w) => deleteIds?.includes(w.id));
  const deleteCount = deleteIds?.length ?? 0;
  const deletePhrase = `${t('workflows.delete_word')} ${deleteCount}`;
  const showToolbar = !loadError && (isLoading || workflowsList.length > 0);
  const th = 'px-3 py-3 text-left text-xs font-medium text-muted-foreground';

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground">{t('nav.workflows')}</h1>
          <p className="text-text-2">{t('wfl.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/workflows/new#templates-list" className={BTN_SECONDARY}>{t('wfl.use_template')}</Link>
          <button type="button" onClick={() => openAiGenerator()} className={BTN_SECONDARY}>
            <span className="rounded bg-t-ai-bg px-1.5 py-px font-mono text-[11px] text-t-ai">AI</span>
            {t('home.ai_describe')}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            data-testid="workflow-import-input"
            className="hidden"
            tabIndex={-1}
            onChange={(event) => void handleImportFile(event)}
          />
          <button type="button" className={BTN_SECONDARY} disabled={isImporting} onClick={() => importInputRef.current?.click()}>
            {isImporting ? t('workflows.transfer.importing') : t('workflows.import')}
          </button>
          <span role="status" aria-live="polite" className="sr-only">{isImporting ? t('workflows.transfer.importing') : ''}</span>
          <button type="button" onClick={() => navigate('/workflows/new')} className={BTN_PRIMARY}>
            <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
            {t('home.create')}
          </button>
        </div>
      </header>

      {apiError && (
        <div role="alert" data-testid="workflow-api-error" className="rounded-xl border border-err-border bg-err-bg px-4 py-2.5 text-[13px] text-err">
          {apiError}
        </div>
      )}

      {showToolbar && (
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label={t('workflows.filter_status')} className="flex flex-wrap gap-1 rounded-lg bg-subtle p-[3px]">
            {tabs.map((tab) => {
              const on = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  data-testid={`workflow-stat-${tab.key.toLowerCase()}`}
                  aria-pressed={on}
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex h-[30px] items-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors ${FOCUS_RING} ${
                    on ? 'bg-card text-foreground shadow-[0_0_0_1px_var(--border-strong)]' : 'text-text-2 hover:text-foreground'
                  }`}
                >
                  {tab.label}
                  <span className="font-mono text-xs text-muted-foreground">{tab.count}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1" />

          <label className="relative flex h-9 w-full items-center sm:w-[300px]">
            <span className="sr-only">{t('workflows.search_placeholder')}</span>
            <Search size={16} strokeWidth={1.75} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-muted-foreground" />
            <input
              type="text"
              data-testid="workflow-search"
              placeholder={t('wfl.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${field} w-full pl-8 pr-8`}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label={t('workflows.bulk_clear')}
                className={`absolute right-1.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground ${FOCUS_RING}`}
              >
                <X size={13} />
              </button>
            )}
          </label>

          <label className="flex items-center gap-2 text-[13px] text-text-2">
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
            className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-border bg-run-bg px-4 py-1.5"
            aria-live="polite"
          >
            <span className="font-medium tabular-nums text-foreground">
              {selectedIds.size} {t('workflows.bulk_selected')}
            </span>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className={`inline-flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium text-text-2 transition-colors hover:bg-subtle hover:text-foreground ${FOCUS_RING}`}
            >
              {t('workflows.bulk_clear')}
            </button>
            <span aria-hidden="true" className="mx-1 h-[18px] w-px bg-border-strong" />
            <button
              type="button"
              aria-label={t('workflows.bulk_delete')}
              onClick={() => setDeleteIds(Array.from(selectedIds))}
              className={`inline-flex h-7 items-center gap-1 rounded-md border border-err-border bg-card px-2.5 text-[13px] font-medium text-err transition-colors hover:bg-err-bg disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
            >
              <Trash2 size={13} aria-hidden="true" />
              {t('workflows.btn_delete')}…
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {noWorkspace ? (
        <div className="mx-auto w-full max-w-[560px] py-12">
          <NoWorkspaceNotice />
        </div>
      ) : loadError ? (
        <div role="alert" data-testid="workflow-load-error" className="py-12">
          <div className="mx-auto max-w-[560px] rounded-xl border border-err-border bg-err-bg p-4">
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
                className={BTN_SECONDARY}
              >
                {t('topbar.retry')}
              </button>
            </div>
          </div>
        </div>
      ) : isLoading ? (
        <div role="status" aria-label={t('workflows.loading')} className={`${CARD} overflow-hidden`}>
          {[62, 48, 70, 55, 40, 66].map((width, row) => (
            <div key={row} className="flex h-[72px] items-center gap-6 border-b border-border px-5 last:border-b-0">
              <span className="h-5 w-9 animate-pulse rounded-full bg-muted" />
              <span className="h-2.5 animate-pulse rounded bg-muted" style={{ width: `${width}%` }} />
              <span className="ml-auto h-4 w-14 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : workflowsList.length === 0 ? (
        <div className={`${CARD} px-5 py-12`}>
          <div className="mx-auto max-w-[640px]">
            <h2 className="text-xl font-semibold text-foreground">{t('workflows.empty_title')}</h2>
            <p className="mt-2 text-sm text-text-2">{t('workflows.empty_description')}</p>
            <ol className="mt-5 list-none rounded-xl border border-border p-0">
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
              <button type="button" onClick={() => navigate('/workflows/new')} className={BTN_PRIMARY}>
                {t('home.create')}
              </button>
              <button type="button" onClick={() => openAiGenerator()} className={BTN_SECONDARY}>
                <span className="rounded bg-t-ai-bg px-1.5 py-px font-mono text-[11px] text-t-ai">AI</span>
                {t('home.ai_describe')}
              </button>
            </div>
          </div>
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <div className={`${CARD} px-5 py-12 text-center`}>
          <h3 className="text-sm font-semibold text-foreground">{t('workflows.no_results')}</h3>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-text-2">{t('wfl.empty_filter')}</p>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className={`${BTN_SECONDARY} mt-4`}>
              {t('workflows.clear_filters')}
            </button>
          )}
        </div>
      ) : (
        <section aria-label={t('wfl.list_label')} className={`${CARD} overflow-x-auto`}>
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr>
                <th className={`${th} w-11 pl-5`}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={handleToggleSelectAll}
                    className="m-0 h-4 w-4 cursor-pointer accent-[var(--primary)]"
                    aria-label={t('workflows.select_all')}
                  />
                </th>
                <th className={`${th} w-16`}>{t('wfl.col_on')}</th>
                <th className={th}>{t('wfl.col_name')}</th>
                <th className={th}>{t('wfl.col_what')}</th>
                <th className={th}>{t('wfl.col_last')}</th>
                <th className={`${th} text-right`}>{t('wfl.col_runs')}</th>
                <th className={`${th} w-28 pr-5`}>
                  <span className="sr-only">{t('workflows.col_actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredWorkflows.map((wf) => {
                const isSelected = selectedIds.has(wf.id);
                const rowStats = stats[wf.id];
                const lastAt = lastRunOf(wf);
                const summary = describeWorkflow(triggerOf(wf), stepsById[wf.id], t, labelOf);
                const stepsLoading = stepIds.includes(wf.id) && !(wf.id in stepsById);
                const isOn = wf.status === 'PUBLISHED';
                const lastPill = wf.status === 'DRAFT'
                  ? <span className={statusBadgeClass('pause')}>{t('workflows.tab_draft')}</span>
                  : rowStats?.lastStatus
                    ? <span className={statusBadgeClass(runTone(rowStats.lastStatus))}>{t(`monitoring.status.${rowStats.lastStatus.toLowerCase()}`)}</span>
                    : <span className={statusBadgeClass('pause')}>{t('relative.never')}</span>;

                return (
                  <tr
                    key={wf.id}
                    data-testid="workflow-row"
                    data-status={wf.status}
                    className={`border-t border-border transition-colors ${isSelected ? 'bg-run-bg' : 'hover:bg-subtle'}`}
                  >
                    <td className="py-3.5 pl-5 pr-3 align-top">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelectRow(wf.id)}
                        className="m-0 mt-[3px] h-4 w-4 cursor-pointer accent-[var(--primary)]"
                        aria-label={`${t('workflows.select')} ${wf.name}`}
                      />
                    </td>
                    <td className="px-3 py-3.5 align-top">
                      {wf.status === 'DRAFT' ? (
                        <span title={t('wfl.draft_no_switch')} aria-label={t('wfl.draft_no_switch')} className="inline-flex h-[22px] items-center text-muted-foreground">—</span>
                      ) : (
                        <button
                          type="button"
                          role="switch"
                          data-testid="workflow-switch"
                          aria-checked={isOn}
                          disabled={switching.has(wf.id)}
                          aria-label={t(isOn ? 'wfl.switch_off' : 'wfl.switch_on').replace('{name}', wf.name)}
                          onClick={() => void handleSwitch(wf)}
                          className={`inline-flex h-[22px] w-9 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50 ${FOCUS_RING} ${isOn ? 'justify-end bg-ok' : 'justify-start bg-border-strong'}`}
                        >
                          <span aria-hidden="true" className="h-[18px] w-[18px] rounded-full bg-white" />
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-3.5 align-top">
                      <Link to={`/workflows/${wf.id}/builder`} className={`rounded-sm font-medium text-foreground hover:underline ${FOCUS_RING}`}>
                        {wf.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {[wf.ownerName, t('wfl.edited').replace('{when}', relativeTime(wf.updatedAt))].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="max-w-[360px] px-3 py-3.5 align-top">
                      <div data-testid="workflow-summary" className="flex flex-col gap-0.5">
                        <span><span className="text-muted-foreground">{t('wfl.run_prefix')} </span>{summary.when}</span>
                        {summary.then ? (
                          <span className="text-[13px] text-text-2"><span className="text-muted-foreground">{t('wfl.then_prefix')} </span>{summary.then}</span>
                        ) : stepsLoading ? (
                          <span className="text-[13px] text-muted-foreground">…</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 align-top" title={exactTime(lastAt)}>
                      <div className="flex flex-col items-start gap-0.5">
                        {lastPill}
                        {lastAt && <span className="font-mono text-xs text-muted-foreground">{relativeTime(lastAt)}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-right align-top font-mono text-xs text-text-2">
                      {rowStats ? rowStats.runs7d.toLocaleString(locale) : wf.status === 'DRAFT' ? '—' : '…'}
                    </td>
                    {/* The row menu is position: fixed, so the scrolling card cannot clip it. */}
                    <td className="relative whitespace-nowrap py-2.5 pl-3 pr-5 align-top">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => void handleRun(wf.id)}
                          disabled={wf.status !== 'PUBLISHED'}
                          className={`${ICON_BTN} h-8 w-8 disabled:opacity-40 disabled:hover:bg-transparent`}
                          title={wf.status === 'PUBLISHED' ? t('workflows.trigger_execution') : t('workflows.btn_publish')}
                          aria-label={`${t('workflows.trigger_execution')}: ${wf.name}`}
                        >
                          <Play size={16} strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          ref={(element) => {
                            menuButtonRefs.current[wf.id] = element;
                          }}
                          onClick={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                            setActiveMenuId(activeMenuId === wf.id ? null : wf.id);
                          }}
                          className={`${ICON_BTN} h-8 w-8 ${activeMenuId === wf.id ? 'bg-muted text-foreground' : ''}`}
                          title={t('workflows.more_actions')}
                          aria-label={`${t('workflows.more_actions')}: ${wf.name}`}
                          aria-haspopup="menu"
                          aria-expanded={activeMenuId === wf.id}
                        >
                          <MoreHorizontal size={18} strokeWidth={1.75} />
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
                            style={menuPos ?? undefined}
                            className="fixed z-30 flex w-48 flex-col rounded-xl border border-border bg-popover p-1 text-left text-[13px] text-popover-foreground shadow-pop"
                          >
                            <Link
                              role="menuitem"
                              to={`/workflows/${encodeURIComponent(wf.id)}/executions`}
                              className={`flex h-8 items-center gap-2 rounded-md px-2 hover:bg-subtle ${FOCUS_RING}`}
                            >
                              <History size={14} strokeWidth={1.75} className="text-muted-foreground" />
                              <span>{t('nav.executions')}</span>
                            </Link>
                            <Link
                              role="menuitem"
                              to={`/workflows/${encodeURIComponent(wf.id)}/builder`}
                              className={`flex h-8 items-center gap-2 rounded-md px-2 hover:bg-subtle ${FOCUS_RING}`}
                            >
                              <Edit3 size={14} strokeWidth={1.75} className="text-muted-foreground" />
                              <span>{t('workflows.edit_studio')}</span>
                            </Link>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => void handleDuplicate(wf.id)}
                              className={`flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-subtle ${FOCUS_RING}`}
                            >
                              <Copy size={14} strokeWidth={1.75} className="text-muted-foreground" />
                              <span>{t('workflows.btn_duplicate')}</span>
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => void handleTogglePause(wf)}
                              disabled={wf.status === 'DRAFT'}
                              title={wf.status === 'DRAFT' ? t('workflows.publish_before_pause') : undefined}
                              className={`flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                            >
                              {wf.status === 'PAUSED' ? (
                                <>
                                  <Play size={14} strokeWidth={1.75} className="text-ok" />
                                  <span>{t('workflows.btn_resume')}</span>
                                </>
                              ) : (
                                <>
                                  <Pause size={14} strokeWidth={1.75} className="text-warn" />
                                  <span>{t('workflows.btn_pause')}</span>
                                </>
                              )}
                            </button>
                            <div className="my-1 h-px bg-border" />
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                closeMenu(wf.id);
                                setDeleteIds([wf.id]);
                              }}
                              className={`flex h-8 items-center gap-2 rounded-md px-2 text-left font-medium text-err hover:bg-err-bg disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                            >
                              <Trash2 size={14} strokeWidth={1.75} />
                              <span>{t('workflows.btn_delete')}…</span>
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {t('workflows.showing')} {filteredWorkflows.length} / {workflowsList.length}
            </span>
          </div>
        </section>
      )}

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
