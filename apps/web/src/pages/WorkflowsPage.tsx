import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Plus,
  Upload,
  Search,
  ChevronDown,
  Play,
  Edit3,
  MoreHorizontal,
  LayoutList,
  LayoutGrid,
  FilterX,
  History,
  Copy,
  PauseCircle,
  PlayCircle,
  Trash2,
  Inbox,
  Sparkles,
  X,
  GitFork,
  Layers,
  Activity,
  PenLine,
} from 'lucide-react';
import type { WorkflowDefinition } from '../types/workflow.types';
import { workflowApi, isWorkflowMockMode } from '../api/workflow.api';
import { WorkflowGlyph } from '../components/workflows/WorkflowGlyph';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { MOTION_DURATION, MOTION_EASE, REDUCED_MOTION_TRANSITION } from '../lib/motion';
import { useI18nStore } from '../store/useI18nStore';
import { captureNotificationSession, isCurrentNotificationSession } from '../lib/notifications/session';
import { showSuccessToast } from '../lib/feedback/toast';
import { useNotificationMilestoneRefresh } from '../hooks/useNotificationMilestoneRefresh';

interface WorkflowItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  status: 'PUBLISHED' | 'PAUSED' | 'DRAFT';
  executions: number | null;
  successRate: string;
  lastRun: string;
  updated: string;
  triggerType: string;
}

export function WorkflowsPage() {
  const refreshNotifications = useNotificationMilestoneRefresh();
  const { language, t } = useI18nStore();
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [workflowsList, setWorkflowsList] = useState<WorkflowItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'EMPTY'>('ALL');

  // Filters
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [ownerFilter] = useState('ALL');

  // View & Pagination
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Action Menu state
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  const closeMenu = (id: string) => {
    setActiveMenuId(null);
    requestAnimationFrame(() => menuButtonRefs.current[id]?.focus());
  };

  const loadWorkflows = useCallback(async () => {
    setIsLoading(true);
    setApiError(null);
    try {
      const data = await workflowApi.getWorkflows();
      const mapped: WorkflowItem[] = data.map((wf: WorkflowDefinition) => ({
        id: wf.id,
        code: wf.id.slice(0, 8),
        name: wf.name,
        description: wf.description,
        status: wf.status,
        executions: null,
        successRate: '—',
        lastRun: '—',
        updated: wf.updatedAt
          ? new Date(wf.updatedAt).toLocaleString(language === 'VI' ? 'vi-VN' : 'en-US')
          : '—',
        triggerType: wf.triggerType,
      }));
      setWorkflowsList(mapped);
    } catch (error) {
      setWorkflowsList([]);
      setApiError(error instanceof Error ? error.message : 'Workflows could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [language]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const handleCreate = async () => {
    setApiError(null);
    const mutationSession = captureNotificationSession();
    try {
      const newWf = await workflowApi.createWorkflow({ name: 'New AI Workflow' });
      if (!isCurrentNotificationSession(mutationSession)) return;
      showSuccessToast('toast.workflow.created', mutationSession);
      refreshNotifications(mutationSession);
      navigate(`/workflows/${newWf.id}/builder`);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) {
        setApiError(error instanceof Error ? error.message : 'Workflow could not be created.');
      }
    }
  };

  const handleRun = async (id: string) => {
    setApiError(null);
    const mutationSession = captureNotificationSession();
    try {
      const accepted = await workflowApi.runWorkflow(id);
      if (!isCurrentNotificationSession(mutationSession)) return;
      showSuccessToast('toast.workflow.run_accepted', mutationSession);
      navigate(`/executions?workflowId=${encodeURIComponent(id)}&executionId=${encodeURIComponent(accepted.executionId)}`);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) {
        setApiError(error instanceof Error ? error.message : 'Workflow could not be started.');
      }
    }
  };

  const handleTogglePause = async (workflow: WorkflowItem) => {
    setApiError(null);
    const mutationSession = captureNotificationSession();
    try {
      if (workflow.status === 'PAUSED') await workflowApi.resumeWorkflow(workflow.id);
      else if (workflow.status === 'PUBLISHED') await workflowApi.pauseWorkflow(workflow.id);
      else throw new Error('Only published workflows can be paused.');
      if (!isCurrentNotificationSession(mutationSession)) return;
      showSuccessToast(workflow.status === 'PAUSED' ? 'toast.workflow.resumed' : 'toast.workflow.paused', mutationSession);
      refreshNotifications(mutationSession);
      await loadWorkflows();
      setActiveMenuId(null);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) {
        setApiError(error instanceof Error ? error.message : 'Workflow status could not be changed.');
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!isWorkflowMockMode) return;
    try {
      await workflowApi.deleteWorkflow(id);
      setWorkflowsList((current) => current.filter((workflow) => workflow.id !== id));
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Workflow could not be deleted.');
    }
  };

  const handleDuplicate = async (id: string) => {
    setApiError(null);
    try {
      const duplicate = await workflowApi.duplicateWorkflow(id);
      navigate(`/workflows/${duplicate.id}/builder`);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Workflow could not be duplicated.');
    }
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredWorkflows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredWorkflows.map((w) => w.id)));
    }
  };

  const handleToggleSelectRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (!isWorkflowMockMode) return;
    const idsToDelete = Array.from(selectedIds);
    setBulkDeleteLoading(true);

    try {
      for (const id of idsToDelete) {
        await workflowApi.deleteWorkflow(id);
      }
      setWorkflowsList((current) => current.filter((workflow) => !idsToDelete.includes(workflow.id)));
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
    } catch (error) {
      console.error(error);
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  // Filter calculations
  const totalCount = workflowsList.length;
  const activeCount = workflowsList.filter((w) => w.status === 'PUBLISHED').length;
  const pausedCount = workflowsList.filter((w) => w.status === 'PAUSED').length;
  const draftCount = workflowsList.filter((w) => w.status === 'DRAFT').length;

  const filteredWorkflows = workflowsList.filter((wf) => {
    if (activeTab === 'EMPTY') return false;

    const matchesSearch =
      wf.name.toLowerCase().includes(search.toLowerCase()) ||
      wf.code.toLowerCase().includes(search.toLowerCase());

    let matchesTab = true;
    if (activeTab === 'ACTIVE') matchesTab = wf.status === 'PUBLISHED';
    if (activeTab === 'PAUSED') matchesTab = wf.status === 'PAUSED';
    if (activeTab === 'DRAFT') matchesTab = wf.status === 'DRAFT';

    let matchesStatusDropdown = true;
    if (statusFilter !== 'ALL') matchesStatusDropdown = wf.status === statusFilter;

    return matchesSearch && matchesTab && matchesStatusDropdown;
  });

  const pageSize = 6;
  const paginatedWorkflows = filteredWorkflows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const localizedRelativeTime = (value: string) => {
    const keys: Record<string, string> = {
      '1 min ago': 'relative.min_1',
      '2 min ago': 'relative.min_2',
      '3 min ago': 'relative.min_3',
      '5 min ago': 'relative.min_5',
      '18 min ago': 'relative.min_18',
      '1 hour ago': 'relative.hour_1',
      '2 hours ago': 'relative.hour_2',
      Yesterday: 'relative.yesterday',
      '3 days ago': 'relative.days_3',
      '5 days ago': 'relative.days_5',
      Never: 'relative.never',
    };
    return keys[value] ? t(keys[value]) : value;
  };

  const localizedUpdatedTime = (value: string) => {
    if (language === 'EN') return value;

    const dateTime = value.match(/^(Today|Yesterday), (\d{1,2}):(\d{2}) (AM|PM)$/);
    if (dateTime) {
      const dayKey = dateTime[1] === 'Today' ? 'relative.today' : 'relative.yesterday';
      const hour24 = (Number(dateTime[2]) % 12) + (dateTime[4] === 'PM' ? 12 : 0);
      return `${t(dayKey)}, ${String(hour24).padStart(2, '0')}:${dateTime[3]}`;
    }

    if (value === 'Today') return t('relative.today');
    if (value === 'Yesterday') return t('relative.yesterday');
    if (value === 'Never') return t('relative.never');

    const daysAgo = value.match(/^(\d+) days ago$/);
    if (daysAgo) return t('relative.days_count').replace('{count}', daysAgo[1]);
    if (value === '1 week ago') return t('relative.week_1');
    return value;
  };

  const renderStatusBadge = (status: WorkflowItem['status']) => {
    const tone =
      status === 'PUBLISHED'
        ? { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20', dot: 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]', label: t('workflows.tab_active') }
        : status === 'PAUSED'
          ? { pill: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20', dot: 'bg-amber-500', label: t('workflows.tab_paused') }
          : { pill: 'bg-slate-100 text-slate-600 ring-slate-500/15 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-400/20', dot: 'bg-slate-400', label: t('workflows.tab_draft') };
    return (
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${tone.pill}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        {tone.label}
      </span>
    );
  };

  const statCards: Array<{
    tab: 'ALL' | 'ACTIVE' | 'PAUSED' | 'DRAFT';
    label: string;
    value: number;
    icon: React.ElementType;
    tone: string;
  }> = [
    { tab: 'ALL', label: t('workflows.stat_total'), value: totalCount, icon: Layers, tone: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' },
    { tab: 'ACTIVE', label: t('workflows.tab_active'), value: activeCount, icon: Activity, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' },
    { tab: 'PAUSED', label: t('workflows.tab_paused'), value: pausedCount, icon: PauseCircle, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300' },
    { tab: 'DRAFT', label: t('workflows.tab_draft'), value: draftCount, icon: PenLine, tone: 'bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300' },
  ];

  const toolbarControl =
    'h-9 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground shadow-soft transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const iconAction =
    'flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground';

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-12">
      {/* 1. PAGE HEADER */}
      <section className="page-hero-glow relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-soft sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <span aria-hidden="true" className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-brand sm:flex">
              <GitFork size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[26px]">
                {t('workflows.title')}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                {t('workflows.subtitle')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
            <Link
              to="/ai/workflow-generator"
              className="group flex h-10 items-center gap-2 rounded-xl border border-primary/20 bg-accent px-4 text-sm font-semibold text-primary transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Sparkles size={15} className="transition-transform group-hover:rotate-12" />
              <span>{t('nav.ai_generator')}</span>
            </Link>

            <button
              type="button"
              className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium text-foreground shadow-soft transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Upload size={15} className="text-muted-foreground" />
              <span>{t('workflows.import')}</span>
            </button>

            <button
              onClick={handleCreate}
              type="button"
              className="flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white shadow-brand transition-[filter,transform] hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Plus size={16} />
              <span>{t('dashboard.new_workflow')}</span>
            </button>
          </div>
        </div>

        {/* Status summary doubles as the primary status filter */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statCards.map((card) => {
            const Icon = card.icon;
            const isActive = activeTab === card.tab;
            return (
              <button
                key={card.tab}
                type="button"
                data-testid={`workflow-stat-${card.tab.toLowerCase()}`}
                aria-pressed={isActive}
                onClick={() => {
                  setActiveTab(card.tab);
                  setCurrentPage(1);
                }}
                className={`group flex items-center gap-3 rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? 'border-primary/40 bg-card shadow-lift ring-1 ring-primary/15'
                    : 'border-border bg-background/60 hover:border-primary/25 hover:bg-card'
                }`}
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.tone}`}>
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-muted-foreground">{card.label}</span>
                  <span className="block text-xl font-bold tabular-nums tracking-tight text-foreground">{card.value}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {apiError && (
        <div role="alert" data-testid="workflow-api-error" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300">
          {apiError}
        </div>
      )}

      {/* 2. FILTER & TOOLBAR AREA */}
      <div className="flex flex-col items-stretch justify-between gap-2 rounded-xl border border-border bg-card p-2 shadow-soft lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <div className="relative flex h-9 w-full items-center rounded-lg border border-border bg-muted/50 px-3 transition-colors focus-within:border-primary/40 focus-within:bg-card focus-within:ring-4 focus-within:ring-primary/10 sm:max-w-sm">
            <Search size={15} className="mr-2 shrink-0 text-muted-foreground" />
            <input
              type="text"
              data-testid="workflow-search"
              placeholder={t('workflows.search_placeholder')}
              aria-label={t('workflows.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label={t('workflows.bulk_clear')}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </button>
            ) : (
              <kbd className="shrink-0 rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                ⌘ K
              </kbd>
            )}
          </div>

          <button
            type="button"
            onClick={() => setActiveTab(activeTab === 'EMPTY' ? 'ALL' : 'EMPTY')}
            aria-pressed={activeTab === 'EMPTY'}
            className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              activeTab === 'EMPTY'
                ? 'bg-accent font-semibold text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
            title={t('workflows.preview_empty')}
          >
            <FilterX size={14} />
            <span>{t('workflows.empty_view')}</span>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label={t('workflows.col_status')}
            className={`${toolbarControl} cursor-pointer pr-2`}
          >
            <option value="ALL">{t('workflows.status_prefix')} {t('workflows.all')}</option>
            <option value="PUBLISHED">{t('workflows.status_prefix')} Published</option>
            <option value="PAUSED">{t('workflows.status_prefix')} {t('workflows.tab_paused')}</option>
            <option value="DRAFT">{t('workflows.status_prefix')} {t('workflows.tab_draft')}</option>
          </select>

          <button type="button" className={`${toolbarControl} hidden items-center gap-1 xl:flex`}>
            <span className="font-normal text-muted-foreground">{t('workflows.last_run')}</span>
            <span className="font-semibold">{t('workflows.any_time')}</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </button>

          <button type="button" className={`${toolbarControl} hidden items-center gap-1 md:flex`}>
            <span className="font-normal text-muted-foreground">{t('workflows.owner')}</span>
            <span className="font-semibold">{ownerFilter === 'ALL' ? t('workflows.all') : ownerFilter}</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </button>

          <div className="mx-0.5 h-5 w-px bg-border" />

          <div className="flex items-center rounded-lg bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-pressed={viewMode === 'table'}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                viewMode === 'table' ? 'bg-card text-primary shadow-soft' : 'text-muted-foreground hover:text-foreground'
              }`}
              title={t('workflows.table_view')}
              aria-label={t('workflows.table_view')}
            >
              <LayoutList size={15} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                viewMode === 'grid' ? 'bg-card text-primary shadow-soft' : 'text-muted-foreground hover:text-foreground'
              }`}
              title={t('workflows.grid_view')}
              aria-label={t('workflows.grid_view')}
            >
              <LayoutGrid size={15} />
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {selectedIds.size > 0 && (
          <motion.div
            data-testid="workflow-bulk-actions"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={prefersReducedMotion ? REDUCED_MOTION_TRANSITION : { duration: MOTION_DURATION.feedback, ease: MOTION_EASE }}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/25 bg-accent px-3 py-2 text-xs"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 text-accent-foreground">
              <span className="flex size-6 items-center justify-center rounded-full bg-brand-gradient text-[11px] font-bold text-white">
                {selectedIds.size}
              </span>
              <span className="font-semibold">{selectedIds.size} {t('workflows.bulk_selected')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleClearSelection}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              >
                <X size={13} />
                {t('workflows.bulk_clear')}
              </button>
              <button
                type="button"
                aria-label={t('workflows.bulk_delete')}
                onClick={() => setBulkDeleteOpen(true)}
                disabled={!isWorkflowMockMode}
                title={isWorkflowMockMode ? undefined : 'Workflow Service V1 does not provide a delete endpoint'}
                className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 font-semibold text-white shadow-sm transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 size={13} />
                {t('workflows.bulk_delete')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. MAIN WORKFLOWS CONTENT (TABLE / GRID / EMPTY STATE) */}
      {isLoading ? (
        <div role="status" className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-soft">
          <span className="sr-only">Loading workflows…</span>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3 rounded-lg p-2">
              <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-1/5 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
            </div>
          ))}
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <div className="relative mb-4">
            <span aria-hidden="true" className="absolute inset-0 -z-0 rounded-2xl bg-brand-gradient opacity-25 blur-xl" />
            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-soft">
              <Inbox size={26} />
            </div>
          </div>
          <h3 className="text-base font-semibold text-foreground">
            {t('workflows.no_results')}
          </h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {t('workflows.no_results_description')}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={handleCreate}
              className="flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white shadow-brand transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus size={16} />
              <span>{t('dashboard.new_workflow')}</span>
            </button>
            <Link
              to="/ai/workflow-generator"
              className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Sparkles size={15} className="text-primary" />
              <span>{t('nav.ai_generator')}</span>
            </Link>
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {paginatedWorkflows.map((wf) => (
            <motion.article
              key={wf.id}
              layout
              data-testid="workflow-row"
              data-status={wf.status}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={prefersReducedMotion ? REDUCED_MOTION_TRANSITION : { duration: MOTION_DURATION.state, ease: MOTION_EASE }}
              className="group flex flex-col rounded-2xl border border-border bg-card p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lift"
            >
              <div className="flex items-start justify-between gap-2">
                <WorkflowGlyph triggerType={wf.triggerType} status={wf.status === 'PUBLISHED' ? 'SUCCESS' : wf.status} />
                {renderStatusBadge(wf.status)}
              </div>

              <div className="mt-3 min-w-0">
                <Link
                  to={`/workflows/${wf.id}/builder`}
                  className="block truncate text-sm font-semibold text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {wf.name}
                </Link>
                <p className="mt-1 line-clamp-2 min-h-[2.5em] text-xs leading-relaxed text-muted-foreground">
                  {wf.description || wf.code}
                </p>
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-2.5 text-center">
                <div>
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('workflows.runs')}</dt>
                  <dd className="mt-0.5 font-mono text-xs font-semibold text-foreground">{wf.executions === null ? '—' : wf.executions}</dd>
                </div>
                <div>
                  <dt className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('workflows.col_success_rate')}</dt>
                  <dd className="mt-0.5 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">{wf.successRate}</dd>
                </div>
                <div>
                  <dt className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('workflows.col_last_run')}</dt>
                  <dd className="mt-0.5 truncate font-mono text-xs font-semibold text-foreground">{localizedRelativeTime(wf.lastRun)}</dd>
                </div>
              </dl>

              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <span className="truncate text-[11px] text-muted-foreground">{localizedUpdatedTime(wf.updated)}</span>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => handleRun(wf.id)}
                    disabled={wf.status !== 'PUBLISHED'}
                    className={iconAction}
                    title={wf.status === 'PUBLISHED' ? t('workflows.trigger_execution') : t('workflows.btn_publish')}
                    aria-label={t('workflows.trigger_execution')}
                  >
                    <Play size={15} />
                  </button>
                  <Link
                    to={`/workflows/${wf.id}/builder`}
                    className={iconAction}
                    title={t('workflows.edit_studio')}
                    aria-label={t('workflows.edit_studio')}
                  >
                    <Edit3 size={15} />
                  </Link>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      ) : (
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="whitespace-nowrap border-b border-border bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === filteredWorkflows.length && filteredWorkflows.length > 0}
                      onChange={handleToggleSelectAll}
                      className="h-4 w-4 cursor-pointer rounded accent-[var(--primary)]"
                      aria-label={t('workflows.select_all')}
                    />
                  </th>
                  <th className="min-w-[280px] px-3 py-3">{t('workflows.col_name')}</th>
                  <th className="w-36 px-3 py-3">{t('workflows.col_status')}</th>
                  <th className="w-32 px-3 py-3">{t('workflows.col_executions')}</th>
                  <th className="w-36 px-3 py-3">{t('workflows.col_success_rate')}</th>
                  <th className="w-32 px-3 py-3">{t('workflows.col_last_run')}</th>
                  <th className="w-40 px-3 py-3">{t('workflows.col_updated')}</th>
                  <th className="w-28 px-4 py-3 text-right">{t('workflows.col_actions')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border text-foreground/85">
                <AnimatePresence>
                  {paginatedWorkflows.map((wf) => {
                    const isSelected = selectedIds.has(wf.id);

                    return (
                      <motion.tr
                        key={wf.id}
                        layout
                        data-testid="workflow-row"
                        data-status={wf.status}
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                        transition={prefersReducedMotion ? REDUCED_MOTION_TRANSITION : { duration: MOTION_DURATION.feedback, ease: MOTION_EASE }}
                        className={`group transition-colors hover:bg-muted/40 ${isSelected ? 'bg-accent/70' : ''}`}
                      >
                        <td className="px-4 py-3.5 align-middle">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectRow(wf.id)}
                            className="h-4 w-4 cursor-pointer rounded accent-[var(--primary)]"
                            aria-label={`${t('workflows.select')} ${wf.name}`}
                          />
                        </td>

                        <td className="px-3 py-3.5 align-middle">
                          <div className="flex items-center gap-3">
                            <WorkflowGlyph triggerType={wf.triggerType} status={wf.status === 'PUBLISHED' ? 'SUCCESS' : wf.status} />
                            <div className="flex min-w-0 flex-col">
                              <Link
                                to={`/workflows/${wf.id}/builder`}
                                className="truncate text-[13px] font-semibold text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {wf.name}
                              </Link>
                              <span className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{wf.code}</span>
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-3.5 align-middle">{renderStatusBadge(wf.status)}</td>

                        <td className="px-3 py-3.5 align-middle font-mono text-xs">
                          {wf.executions === null ? <span className="text-muted-foreground">—</span> : `${wf.executions} ${t('workflows.runs')}`}
                        </td>

                        <td className="px-3 py-3.5 align-middle">
                          {wf.successRate === '—' ? (
                            <span className="font-mono text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-emerald-500" style={{ width: wf.successRate }} />
                              </div>
                              <span className="font-mono text-[11px] font-semibold">{wf.successRate}</span>
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-3.5 align-middle text-[11px] text-muted-foreground">
                          {localizedRelativeTime(wf.lastRun)}
                        </td>

                        <td className="px-3 py-3.5 align-middle text-[11px] text-muted-foreground">
                          {localizedUpdatedTime(wf.updated)}
                        </td>

                        <td className="relative px-4 py-3.5 text-right align-middle">
                          <div className="inline-flex items-center justify-end gap-0.5">
                            <button
                              onClick={() => handleRun(wf.id)}
                              disabled={wf.status !== 'PUBLISHED'}
                              className={iconAction}
                              title={wf.status === 'PUBLISHED' ? t('workflows.trigger_execution') : t('workflows.btn_publish')}
                            >
                              <Play size={15} />
                            </button>

                            <Link
                              to={`/workflows/${wf.id}/builder`}
                              className={iconAction}
                              title={t('workflows.edit_studio')}
                            >
                              <Edit3 size={15} />
                            </Link>

                            <button
                              ref={(element) => {
                                menuButtonRefs.current[wf.id] = element;
                              }}
                              onClick={() => setActiveMenuId(activeMenuId === wf.id ? null : wf.id)}
                              className={`${iconAction} hover:text-foreground ${activeMenuId === wf.id ? 'bg-muted text-foreground' : ''}`}
                              title={t('workflows.more_actions')}
                              aria-label={t('workflows.more_actions')}
                              aria-haspopup="menu"
                              aria-expanded={activeMenuId === wf.id}
                            >
                              <MoreHorizontal size={15} />
                            </button>
                          </div>

                          <AnimatePresence>
                            {activeMenuId === wf.id && (
                            <motion.div
                              role="menu"
                              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -3 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -2 }}
                              transition={prefersReducedMotion ? REDUCED_MOTION_TRANSITION : { duration: MOTION_DURATION.feedback, ease: MOTION_EASE }}
                              className="absolute right-4 top-12 z-30 flex w-48 origin-top-right flex-col rounded-xl border border-border bg-popover p-1 text-left text-xs text-popover-foreground shadow-lift"
                            >
                              <Link
                                to={`/executions?workflowId=${wf.id}`}
                                className="flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-muted"
                              >
                                <History size={14} className="text-muted-foreground" />
                                <span>{t('nav.executions')}</span>
                              </Link>
                              <button
                                onClick={() => void handleDuplicate(wf.id)}
                                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted"
                              >
                                <Copy size={14} className="text-muted-foreground" />
                                <span>{t('workflows.btn_duplicate')}</span>
                              </button>
                              <button
                                onClick={() => void handleTogglePause(wf)}
                                disabled={wf.status === 'DRAFT'}
                                title={wf.status === 'DRAFT' ? 'Publish this workflow before pausing it' : undefined}
                                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {wf.status === 'PAUSED' ? (
                                  <>
                                    <PlayCircle size={14} className="text-emerald-500" />
                                    <span>{t('workflows.btn_resume')}</span>
                                  </>
                                ) : (
                                  <>
                                    <PauseCircle size={14} className="text-amber-500" />
                                    <span>{t('workflows.btn_pause')}</span>
                                  </>
                                )}
                              </button>
                              <div className="my-1 h-px bg-border" />
                              <button
                                onClick={() => {
                                  closeMenu(wf.id);
                                  void handleDelete(wf.id);
                                }}
                                disabled={!isWorkflowMockMode}
                                title={isWorkflowMockMode ? 'Delete workflow' : 'Workflow Service V1 does not provide a delete endpoint'}
                                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-400 dark:hover:bg-rose-950/40"
                              >
                                <Trash2 size={14} />
                                <span>{t('workflows.btn_delete')}</span>
                              </button>
                            </motion.div>
                            )}
                          </AnimatePresence>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {/* 4. PAGINATION & FOOTER */}
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground sm:flex-row">
            <div className="flex items-center gap-3">
              <span>
                {t('workflows.showing')} <strong className="font-semibold text-foreground">{paginatedWorkflows.length}</strong> {t('workflows.of')}{' '}
                <strong className="font-semibold text-foreground">{filteredWorkflows.length}</strong> {t('workflows.workflow_count')}
              </span>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span>{t('workflows.rows')}</span>
                <select className="h-7 rounded-md border border-border bg-card px-1.5 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="25">25 {t('connections.page_size')}</option>
                  <option value="50">50 {t('connections.page_size')}</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(1)}
                className="h-8 rounded-lg border border-border bg-card px-3 text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {t('workflows.previous')}
              </button>
              {[1, 2].map((pageNumber) => (
                <button
                  key={pageNumber}
                  onClick={() => setCurrentPage(pageNumber)}
                  aria-current={currentPage === pageNumber ? 'page' : undefined}
                  className={`h-8 min-w-8 rounded-lg px-2 font-semibold transition-colors ${
                    currentPage === pageNumber
                      ? 'bg-primary text-primary-foreground shadow-soft'
                      : 'border border-border bg-card text-foreground hover:bg-muted'
                  }`}
                >
                  {pageNumber}
                </button>
              ))}
              <button
                disabled={currentPage === 2}
                onClick={() => setCurrentPage(2)}
                className="h-8 rounded-lg border border-border bg-card px-3 text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {t('workflows.next')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title={t('workflows.bulk_delete_title')}
        description={`${t('workflows.bulk_delete_description')} ${selectedIds.size} ${t('workflows.bulk_selected')}.`}
        confirmText={t('workflows.bulk_delete_confirm')}
        cancelText={t('workflows.bulk_delete_cancel')}
        loading={bulkDeleteLoading}
      />
    </div>
  );
}
