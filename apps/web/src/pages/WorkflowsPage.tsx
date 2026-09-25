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
} from 'lucide-react';
import type { WorkflowDefinition } from '../types/workflow.types';
import { workflowApi, isWorkflowMockMode } from '../api/workflow.api';
import { WorkflowGlyph } from '../components/workflows/WorkflowGlyph';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { MOTION_DURATION, MOTION_EASE, REDUCED_MOTION_TRANSITION } from '../lib/motion';
import { useI18nStore } from '../store/useI18nStore';

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
    try {
      const newWf = await workflowApi.createWorkflow({ name: 'New AI Workflow' });
      navigate(`/workflows/${newWf.id}/builder`);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Workflow could not be created.');
    }
  };

  const handleRun = async (id: string) => {
    setApiError(null);
    try {
      const accepted = await workflowApi.runWorkflow(id);
      navigate(`/executions?workflowId=${encodeURIComponent(id)}&executionId=${encodeURIComponent(accepted.executionId)}`);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Workflow could not be started.');
    }
  };

  const handleTogglePause = async (workflow: WorkflowItem) => {
    setApiError(null);
    try {
      if (workflow.status === 'PAUSED') await workflowApi.resumeWorkflow(workflow.id);
      else if (workflow.status === 'PUBLISHED') await workflowApi.pauseWorkflow(workflow.id);
      else throw new Error('Only published workflows can be paused.');
      await loadWorkflows();
      setActiveMenuId(null);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Workflow status could not be changed.');
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
    if (status === 'PUBLISHED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          {t('workflows.tab_active')}
        </span>
      );
    }
    if (status === 'PAUSED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          {t('workflows.tab_paused')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-semibold text-[11px]">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
        {t('workflows.tab_draft')}
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12">
      {/* 1. TOP BREADCRUMB & PAGE HEADER */}
      <div className="flex flex-col gap-3">
        <nav className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
          <span className="hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer">{t('topbar.home')}</span>
          <span className="text-slate-300 dark:text-slate-700 font-mono text-[11px]">/</span>
          <span className="text-slate-900 dark:text-slate-100 font-semibold">{t('nav.workflows')}</span>
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t('workflows.title')}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('workflows.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              to="/ai/workflow-generator"
              className="flex h-9 items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/8 px-3.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Sparkles size={14} />
              <span>{t('nav.ai_generator')}</span>
            </Link>

            <button
              type="button"
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Upload size={14} className="text-slate-500" />
              <span>{t('workflows.import')}</span>
            </button>

            <button
              onClick={handleCreate}
              type="button"
              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Plus size={15} />
              <span>{t('dashboard.new_workflow')}</span>
            </button>
          </div>
        </div>
      </div>

      {apiError && (
        <div role="alert" data-testid="workflow-api-error" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300">
          {apiError}
        </div>
      )}

      {/* 2. FILTER & TOOLBAR AREA */}
      <div className="flex flex-col items-stretch justify-between gap-2 rounded-xl border border-border bg-card p-2 shadow-sm lg:flex-row lg:items-center">
        {/* Search & Segmented Tabs */}
        <div className="flex min-w-0 flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1">
          {/* Search Input */}
          <div className="relative flex h-9 w-full items-center rounded-lg border border-border bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring/30 sm:w-64">
            <Search size={14} className="text-slate-400 mr-2 shrink-0" />
            <input
              type="text"
              data-testid="workflow-search"
              placeholder={t('workflows.search_placeholder')}
              aria-label={t('workflows.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <kbd className="font-mono text-[10px] text-slate-400 bg-slate-200/60 dark:bg-slate-700/60 px-1.5 py-0.5 rounded shrink-0">
              ⌘ K
            </kbd>
          </div>

          {/* Segmented Status Tabs */}
          <div className="min-w-0 flex-1 flex items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab('ALL')}
              className={`px-3 py-1 rounded-md text-xs transition-all whitespace-nowrap ${
                activeTab === 'ALL'
                  ? 'bg-card text-primary font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('workflows.tab_all')} <span className="font-mono text-[10px] opacity-75 ml-1">{totalCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ACTIVE')}
              className={`px-3 py-1 rounded-md text-xs transition-all whitespace-nowrap ${
                activeTab === 'ACTIVE'
                  ? 'bg-card text-primary font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('workflows.tab_active')} <span className="font-mono text-[10px] opacity-75 ml-1">{activeCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('PAUSED')}
              className={`px-3 py-1 rounded-md text-xs transition-all whitespace-nowrap ${
                activeTab === 'PAUSED'
                  ? 'bg-card text-primary font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('workflows.tab_paused')} <span className="font-mono text-[10px] opacity-75 ml-1">{pausedCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('DRAFT')}
              className={`px-3 py-1 rounded-md text-xs transition-all whitespace-nowrap ${
                activeTab === 'DRAFT'
                  ? 'bg-card text-primary font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('workflows.tab_draft')} <span className="font-mono text-[10px] opacity-75 ml-1">{draftCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('EMPTY')}
              className={`px-2 py-1 rounded-md text-xs transition-all whitespace-nowrap flex items-center gap-1 ${
                activeTab === 'EMPTY'
                  ? 'bg-card text-primary font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title={t('workflows.preview_empty')}
            >
              <FilterX size={13} />
              <span>{t('workflows.empty_view')}</span>
            </button>
          </div>
        </div>

        {/* Secondary Dropdowns & View Switcher */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
          >
            <option value="ALL">{t('workflows.status_prefix')} {t('workflows.all')}</option>
            <option value="PUBLISHED">{t('workflows.status_prefix')} Published</option>
            <option value="PAUSED">{t('workflows.status_prefix')} {t('workflows.tab_paused')}</option>
            <option value="DRAFT">{t('workflows.status_prefix')} {t('workflows.tab_draft')}</option>
          </select>

          <button
            type="button"
            className="h-8 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <span className="text-slate-400 font-normal">{t('workflows.last_run')}</span>
            <span className="font-semibold">{t('workflows.any_time')}</span>
            <ChevronDown size={14} className="text-slate-400" />
          </button>

          <button
            type="button"
            className="h-8 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hidden md:flex items-center gap-1 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <span className="text-slate-400 font-normal">{t('workflows.owner')}</span>
            <span className="font-semibold">{ownerFilter === 'ALL' ? t('workflows.all') : ownerFilter}</span>
            <ChevronDown size={14} className="text-slate-400" />
          </button>

          <div className="w-px h-5 bg-slate-200 dark:bg-slate-800 mx-1" />

          {/* List vs Grid Switcher */}
          <div className="flex items-center bg-slate-100/80 dark:bg-slate-800/80 p-0.5 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`p-1 rounded transition-colors ${
                viewMode === 'table'
                  ? 'bg-card text-primary shadow-sm'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
              title={t('workflows.table_view')}
            >
              <LayoutList size={15} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`p-1 rounded transition-colors ${
                viewMode === 'grid'
                  ? 'bg-card text-primary shadow-sm'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
              title={t('workflows.grid_view')}
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
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50/80 px-3 py-2 text-xs dark:border-blue-900/70 dark:bg-blue-950/25"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
              <span className="flex size-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                {selectedIds.size}
              </span>
              <span className="font-semibold">{selectedIds.size} {t('workflows.bulk_selected')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleClearSelection}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
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
                className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2.5 py-1.5 font-semibold text-white shadow-sm transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50 disabled:cursor-not-allowed disabled:opacity-50"
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
        <div role="status" className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Loading workflows…
        </div>
      ) : filteredWorkflows.length === 0 ? (
        /* Empty State Layout */
        <div className="flex flex-col items-center justify-center space-y-3 rounded-xl border border-border bg-card p-12 text-center shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Inbox size={24} />
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {t('workflows.no_results')}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm">
            {t('workflows.no_results_description')}
          </p>
          <button
            onClick={handleCreate}
            className="mt-2 flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus size={15} />
            <span>{t('dashboard.new_workflow')}</span>
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        /* Grid View Layout */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
              className="flex flex-col justify-between space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <WorkflowGlyph triggerType={wf.triggerType} status={wf.status === 'PUBLISHED' ? 'SUCCESS' : wf.status} />
                  <div>
                    <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                      {wf.name}
                    </h3>
                    <span className="font-mono text-[10px] text-slate-400">{wf.code}</span>
                  </div>
                </div>
                {renderStatusBadge(wf.status)}
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 font-mono border-t border-b border-slate-100 dark:border-slate-800/80 py-2">
                <span>{wf.executions === null ? '—' : `${wf.executions} ${t('workflows.runs')}`}</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  {wf.successRate}
                </span>
                <span>{localizedRelativeTime(wf.lastRun)}</span>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-400">{localizedUpdatedTime(wf.updated)}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleRun(wf.id)}
                    disabled={wf.status !== 'PUBLISHED'}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    title={wf.status === 'PUBLISHED' ? t('workflows.trigger_execution') : t('workflows.btn_publish')}
                  >
                    <Play size={14} />
                  </button>
                  <Link
                    to={`/workflows/${wf.id}/builder`}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                    title={t('workflows.edit_studio')}
                  >
                    <Edit3 size={14} />
                  </Link>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      ) : (
        /* Dense Table View Layout */
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-400 font-semibold text-[10px] uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === filteredWorkflows.length && filteredWorkflows.length > 0}
                      onChange={handleToggleSelectAll}
                      className="h-3.5 w-3.5 cursor-pointer rounded accent-blue-600"
                      aria-label={t('workflows.select_all')}
                    />
                  </th>
                <th className="px-3 py-2.5 min-w-[260px]">{t('workflows.col_name')}</th>
                <th className="px-3 py-2.5 w-28">{t('workflows.col_status')}</th>
                <th className="px-3 py-2.5 w-32">{t('workflows.col_executions')}</th>
                <th className="px-3 py-2.5 w-36">{t('workflows.col_success_rate')}</th>
                <th className="px-3 py-2.5 w-32">{t('workflows.col_last_run')}</th>
                <th className="px-3 py-2.5 w-36">{t('workflows.col_updated')}</th>
                <th className="px-3 py-2.5 text-right w-24">{t('workflows.col_actions')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
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
                        className={`group transition-colors hover:bg-muted/55 ${
                          isSelected ? 'bg-primary/8' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="px-3 py-3 align-middle">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectRow(wf.id)}
                            className="h-3.5 w-3.5 cursor-pointer rounded accent-blue-600"
                            aria-label={`${t('workflows.select')} ${wf.name}`}
                          />
                        </td>

                        {/* Name & ID */}
                        <td className="px-3 py-3 align-middle">
                          <div className="flex items-center gap-3">
                            <WorkflowGlyph triggerType={wf.triggerType} status={wf.status === 'PUBLISHED' ? 'SUCCESS' : wf.status} />
                            <div className="flex flex-col min-w-0">
                              <Link
                                to={`/workflows/${wf.id}/builder`}
                                className="truncate font-semibold text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {wf.name}
                              </Link>
                              <span className="font-mono text-[11px] text-slate-400 truncate">{wf.code}</span>
                            </div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-3 py-3 align-middle">
                          {renderStatusBadge(wf.status)}
                        </td>

                        {/* Executions */}
                        <td className="px-3 py-3 align-middle font-mono text-xs text-slate-700 dark:text-slate-300">
                          {wf.executions === null ? '—' : `${wf.executions} ${t('workflows.runs')}`}
                        </td>

                        {/* Success Rate */}
                        <td className="px-3 py-3 align-middle">
                          {wf.successRate === '—' ? (
                            <span className="font-mono text-xs text-slate-400">—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-emerald-500"
                                  style={{
                                    width: wf.successRate,
                                  }}
                                />
                              </div>
                              <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300 font-semibold">
                                {wf.successRate}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Last Run */}
                        <td className="px-3 py-3 align-middle text-slate-500 text-[11px]">
                          {localizedRelativeTime(wf.lastRun)}
                        </td>

                        {/* Updated */}
                        <td className="px-3 py-3 align-middle text-slate-500 text-[11px]">
                          {localizedUpdatedTime(wf.updated)}
                        </td>

                        {/* Actions */}
                        <td className="px-3 py-3 align-middle text-right relative">
                          <div className="inline-flex items-center gap-1 justify-end">
                            <button
                              onClick={() => handleRun(wf.id)}
                              disabled={wf.status !== 'PUBLISHED'}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                              title={wf.status === 'PUBLISHED' ? t('workflows.trigger_execution') : t('workflows.btn_publish')}
                            >
                              <Play size={14} />
                            </button>

                            <Link
                              to={`/workflows/${wf.id}/builder`}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              title={t('workflows.edit_studio')}
                            >
                              <Edit3 size={14} />
                            </Link>

                            <button
                              ref={(element) => {
                                menuButtonRefs.current[wf.id] = element;
                              }}
                              onClick={() => setActiveMenuId(activeMenuId === wf.id ? null : wf.id)}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              title={t('workflows.more_actions')}
                              aria-label={t('workflows.more_actions')}
                              aria-haspopup="menu"
                              aria-expanded={activeMenuId === wf.id}
                            >
                              <MoreHorizontal size={14} />
                            </button>
                          </div>

                          {/* Context Dropdown Menu */}
                          <AnimatePresence>
                            {activeMenuId === wf.id && (
                            <motion.div
                              role="menu"
                              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -3 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -2 }}
                              transition={prefersReducedMotion ? REDUCED_MOTION_TRANSITION : { duration: MOTION_DURATION.feedback, ease: MOTION_EASE }}
                              className="absolute right-3 top-10 z-30 flex w-44 origin-top-right flex-col rounded-lg border border-border bg-popover py-1 text-left text-xs text-popover-foreground shadow-lg"
                            >
                              <Link
                                to={`/executions?workflowId=${wf.id}`}
                                className="px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                              >
                                <History size={14} className="text-slate-400" />
                                <span>{t('nav.executions')}</span>
                              </Link>
                              <button
                                onClick={() => void handleDuplicate(wf.id)}
                                className="px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-left"
                              >
                                <Copy size={14} className="text-slate-400" />
                                <span>{t('workflows.btn_duplicate')}</span>
                              </button>
                              <button
                                onClick={() => void handleTogglePause(wf)}
                                disabled={wf.status === 'DRAFT'}
                                title={wf.status === 'DRAFT' ? 'Publish this workflow before pausing it' : undefined}
                                className="px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-left"
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
                              <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                              <button
                                onClick={() => {
                                  closeMenu(wf.id);
                                  void handleDelete(wf.id);
                                }}
                                disabled={!isWorkflowMockMode}
                                title={isWorkflowMockMode ? 'Delete workflow' : 'Workflow Service V1 does not provide a delete endpoint'}
                                className="px-3 py-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center gap-2 text-left font-medium disabled:cursor-not-allowed disabled:opacity-40"
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
          <div className="px-4 py-2.5 bg-slate-50/60 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-3">
              <span>
                {t('workflows.showing')} <strong className="text-slate-900 dark:text-slate-100 font-semibold">{paginatedWorkflows.length}</strong> {t('workflows.of')}{' '}
                <strong className="text-slate-900 dark:text-slate-100 font-semibold">{filteredWorkflows.length}</strong> {t('workflows.workflow_count')}
              </span>
              <div className="flex items-center gap-1 text-[11px]">
                <span>{t('workflows.rows')}</span>
                <select className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded px-1.5 py-0.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none">
                  <option value="25">25 {t('connections.page_size')}</option>
                  <option value="50">50 {t('connections.page_size')}</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(1)}
                className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {t('workflows.previous')}
              </button>
              <button
                onClick={() => setCurrentPage(1)}
                className={`px-2.5 py-1 rounded-md font-semibold ${
                  currentPage === 1
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                }`}
              >
                1
              </button>
              <button
                onClick={() => setCurrentPage(2)}
                className={`px-2.5 py-1 rounded-md font-semibold ${
                  currentPage === 2
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                }`}
              >
                2
              </button>
              <button
                disabled={currentPage === 2}
                onClick={() => setCurrentPage(2)}
                className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
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
