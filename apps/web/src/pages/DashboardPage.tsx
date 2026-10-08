import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Plus, Play, RotateCw, Sparkles, ArrowRight, Activity, ShoppingCart, ArrowLeftRight, Headphones, Cloud } from 'lucide-react';
import type { WorkflowDefinition } from '../types/workflow.types';
import { isWorkflowMockMode, workflowApi } from '../api/workflow.api';
import { WorkflowActivityChart } from '../components/dashboard/WorkflowActivityChart';
import { LiveExecutionPanel } from '../components/dashboard/LiveExecutionPanel';
import { useI18nStore } from '../store/useI18nStore';
import { tr } from '../lib/i18n/tr';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWorkflowList } from '../lib/queries/workflows';
import { monitoringApi } from '../api/monitoring.api';
import { runTone } from '../lib/monitoring/format';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { statusBadgeClass } from '../components/common/statusBadgeClass';
import { formatRelativeTime } from '../lib/relativeTime';
import { FirstWorkspaceCard } from '../components/onboarding/FirstWorkspaceCard';
import { useWorkspaceListContext } from '../hooks/useWorkspace';

interface HttpDashboardContentProps {
  workflows: WorkflowDefinition[];
  isLoading: boolean;
  error: string | null;
  actionError: string | null;
  onRetry: () => void;
  onRunWorkflow: (id: string) => void;
}

interface DashboardQuickActionsProps {
  prefersReducedMotion: boolean | null;
}

function DashboardQuickActions({ prefersReducedMotion }: DashboardQuickActionsProps) {
  const { t } = useI18nStore();

  return (
    <motion.section
      data-testid="dashboard-quick-actions"
      aria-labelledby="dashboard-quick-actions-title"
      initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden rounded-lg border border-border bg-card shadow-2xs"
    >
      <div className="flex flex-col gap-1 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="dashboard-quick-actions-title" className="text-sm font-bold tracking-tight text-foreground">
            {t('dashboard.quick_actions')}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('dashboard.quick_actions_hint')}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{t('dashboard.workflow_operations')}</span>
      </div>

      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        <Link
          to="/workflows/new"
          className="group flex items-start gap-3 p-4 text-left transition-colors hover:bg-run-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-run/30"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white transition-transform duration-200 group-hover:-translate-y-0.5">
            <Plus size={17} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              {t('dashboard.new_workflow')}
              <ArrowRight size={12} className="text-run transition-transform duration-200 group-hover:translate-x-0.5" />
            </span>
            <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{t('dashboard.create_blank_desc')}</span>
          </span>
        </Link>

        <Link
          to="/ai/workflow-generator"
          className="group flex items-start gap-3 p-4 text-left transition-colors hover:bg-run-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-run/30"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-run-bg text-run transition-transform duration-200 group-hover:-translate-y-0.5">
            <Sparkles size={17} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              {t('dashboard.generate_ai')}
              <ArrowRight size={12} className="text-run transition-transform duration-200 group-hover:translate-x-0.5" />
            </span>
            <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{t('dashboard.create_ai_desc')}</span>
          </span>
        </Link>

        <Link
          to={isWorkflowMockMode ? '/workflows/wf-prod-8492/builder' : '/workflows'}
          className="group flex items-start gap-3 p-4 text-left transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-run/30"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-text-2 transition-transform duration-200 group-hover:-translate-y-0.5">
            <Play size={17} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              {t('dashboard.run_test')}
              <ArrowRight size={12} className="text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
            </span>
            <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{t('dashboard.run_test_desc')}</span>
          </span>
        </Link>

        <Link
          to="/executions"
          className="group flex items-start gap-3 p-4 text-left transition-colors hover:bg-ok-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-run/30"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ok-bg text-ok transition-transform duration-200 group-hover:-translate-y-0.5">
            <Activity size={17} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              {t('dashboard.view_executions')}
              <ArrowRight size={12} className="text-ok transition-transform duration-200 group-hover:translate-x-0.5" />
            </span>
            <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{t('dashboard.view_executions_desc')}</span>
          </span>
        </Link>
      </div>
    </motion.section>
  );
}

function HttpDashboardContent({ workflows, isLoading, error, actionError, onRetry, onRunWorkflow }: HttpDashboardContentProps) {
  const { language, t } = useI18nStore();
  const locale = language === 'VI' ? 'vi-VN' : 'en-US';
  const publishedCount = workflows.filter((workflow) => workflow.status === 'PUBLISHED').length;

  // Run numbers come from the workspace monitoring endpoints (one summary + one short recent-runs page), not from a
  // per-workflow fan-out.
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId) ?? 'active';
  const summaryQuery = useQuery({
    queryKey: ['monitoring', 'summary', workspaceId, 7],
    enabled: !isLoading && !error,
    staleTime: 30_000,
    retry: false,
    queryFn: () => monitoringApi.getSummary(7),
  });
  const recentQuery = useQuery({
    queryKey: ['monitoring', 'runs', workspaceId, 'dashboard'],
    enabled: !isLoading && !error,
    staleTime: 30_000,
    retry: false,
    queryFn: () => monitoringApi.listRuns({ page: 0, size: 6 }),
  });
  const runs7d = summaryQuery.data?.runs.total ?? 0;
  const failed7d = summaryQuery.data?.runs.failed ?? 0;
  const finished7d = (summaryQuery.data?.runs.success ?? 0) + failed7d;
  const recentRuns = recentQuery.data?.items ?? [];
  const statValue = (value: string) => (summaryQuery.isLoading ? '…' : summaryQuery.isError ? '—' : value);
  const failureRate = finished7d
    ? `${((failed7d / finished7d) * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`
    : '—';

  if (isLoading) {
    return (
      <section data-testid="dashboard-real-data" className="space-y-6">
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="dashboard-workflows-loading">
          {t('dashboard.real_data_loading')}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section data-testid="dashboard-real-data" className="space-y-6">
        <div role="alert" data-testid="dashboard-workflows-error" className="rounded-lg border border-err-border bg-err-bg p-6 text-sm text-err">
          <p>{t('dashboard.real_data_error')}</p>
          <button type="button" onClick={onRetry} className="mt-3 rounded-md border border-err-border px-3 py-1.5 text-xs font-semibold">
            {t('dashboard.real_data_retry')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="dashboard-real-data" className="space-y-6">
      {actionError && (
        <div role="alert" data-testid="dashboard-workflow-action-error" className="rounded-lg border border-warn/30 bg-warn-bg p-4 text-sm text-warn">
          {t('dashboard.run_error')}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('dashboard.total_workflows')}</span>
          <strong data-testid="dashboard-total-workflows" className="mt-2 block font-mono text-2xl text-foreground">{workflows.length}</strong>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('dashboard.published_workflows')}</span>
          <strong data-testid="dashboard-published-workflows" className="mt-2 block font-mono text-2xl text-foreground">{publishedCount}</strong>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('dashboard.runs_7d')}</span>
          <strong data-testid="dashboard-runs-7d" className="mt-2 block font-mono text-2xl text-foreground">
            {statValue(runs7d.toLocaleString(locale))}
          </strong>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('dashboard.failure_rate_7d')}</span>
          <strong data-testid="dashboard-failure-rate-7d" className={`mt-2 block font-mono text-2xl ${failed7d > 0 ? 'text-err' : 'text-foreground'}`}>
            {statValue(failureRate)}
          </strong>
        </div>
      </div>

      {workflows.length === 0 ? (
        <div data-testid="dashboard-workflows-empty" className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {t('dashboard.real_data_empty')}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-2xs">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-bold text-foreground">{t('dashboard.recent_workflows')}</h2>
            <Link to="/workflows" className="text-xs font-semibold text-run">{t('dashboard.view_all_workflows')}</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">{t('dashboard.table_name')}</th>
                  <th className="px-3 py-2.5">{t('dashboard.table_status')}</th>
                  <th className="px-4 py-2.5 text-right">{t('dashboard.table_actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {workflows.map((workflow) => {
                  const statusKey = workflow.status === 'PUBLISHED'
                    ? 'workflows.status_published'
                    : workflow.status === 'PAUSED'
                      ? 'workflows.status_paused'
                      : 'workflows.status_draft';
                  return (
                    <tr key={workflow.id} data-testid="dashboard-workflow-row">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-foreground">{workflow.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{workflow.id}</div>
                      </td>
                      <td className="px-3 py-3 text-text-2">{t(statusKey)}</td>
                      <td className="px-4 py-3 text-right">
                        {workflow.status === 'PUBLISHED' && (
                          <button type="button" onClick={() => onRunWorkflow(workflow.id)} title={t('dashboard.trigger_manual')} className="rounded-md p-1.5 text-muted-foreground hover:bg-subtle" aria-label={t('dashboard.trigger_manual')}>
                            <Play size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div data-testid="dashboard-recent-runs" className="overflow-hidden rounded-lg border border-border bg-card shadow-2xs">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold text-foreground">{t('dashboard.recent_runs')}</h2>
          <Link to="/executions" className="text-xs font-semibold text-run">{t('dashboard.monitoring_link')}</Link>
        </div>
        {recentQuery.isError ? (
          <p className="p-6 text-sm text-muted-foreground">{t('dashboard.execution_data_unavailable')}</p>
        ) : recentQuery.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">{t('dashboard.real_data_loading')}</p>
        ) : recentRuns.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{t('dashboard.no_runs_yet')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {recentRuns.map((run) => (
              <li key={run.executionId}>
                <Link
                  to={`/workflows/${encodeURIComponent(run.workflowId)}/executions?run=${encodeURIComponent(run.executionId)}`}
                  aria-label={`${t('dashboard.view_run')}: ${run.workflowName}`}
                  className="flex items-center gap-3 px-4 py-2.5 text-xs transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className={`${statusBadgeClass(runTone(run.status))} shrink-0`}>{t(`monitoring.status.${run.status.toLowerCase()}`)}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{run.workflowName}</span>
                  <time dateTime={run.startedAt ?? run.createdAt} title={new Date(run.startedAt ?? run.createdAt).toLocaleString(locale)} className="shrink-0 tabular-nums text-muted-foreground">
                    {formatRelativeTime(run.startedAt ?? run.createdAt, locale)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const { t } = useI18nStore();

  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { userId, workspacesQuery } = useWorkspaceListContext();
  // First run: a signed-in user with no workspace yet gets a create card instead of a failed data load.
  const hasNoWorkspace = !isWorkflowMockMode && workspacesQuery.isSuccess && workspacesQuery.data.items.length === 0;
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setApiError(null);
    try {
      const wfList = await fetchWorkflowList(queryClient);
      setWorkflows(wfList);
    } catch (e) {
      setWorkflows([]);
      setApiError(e instanceof Error ? e.message : tr('msg.workflow_data_could_not_be_loaded'));
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const handleRunWorkflow = async (id: string) => {
    setActionError(null);
    try {
      await workflowApi.runWorkflow(id);
      await loadData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : tr('msg.workflow_could_not_be_started'));
    }
  };

  if (hasNoWorkspace) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 pb-12">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('dashboard.title')}</h1>
        <FirstWorkspaceCard userId={userId} onCreated={() => void loadData()} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 select-none">
      
      {/* 1. WORKSPACE OVERVIEW HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
            {t('dashboard.title')}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {t('dashboard.subtitle')}
          </p>
        </div>

        {/* Top-Right Controls */}
        <div className="flex items-center gap-3 shrink-0">
          {isWorkflowMockMode && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-subtle text-text-2 font-mono text-[11px] font-medium border border-border">
              <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
              <span>{t('dashboard.status_online')}</span>
            </div>
          )}

          <button
            onClick={() => navigate('/workflows/new')}
            className="px-4 py-2 bg-primary hover:bg-primary text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Plus size={15} />
            <span>{t('dashboard.new_workflow')}</span>
          </button>
        </div>
      </div>

      {/* 2. QUICK ACTIONS */}
      <DashboardQuickActions prefersReducedMotion={prefersReducedMotion} />

      {/* 3. UNIFIED METRICS BAND */}
      {isWorkflowMockMode ? (
        <>
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-card border border-border rounded-lg divide-y lg:divide-y-0 lg:divide-x divide-border shadow-2xs overflow-hidden">
        {/* Metric 1 */}
        <div className="p-4 flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('dashboard.metric_active')}
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-foreground tracking-tight font-mono">
              09
            </span>
            <span className="text-xs text-muted-foreground">/ 12 {t('dashboard.metric_total')}</span>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="p-4 flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('dashboard.metric_executions')}
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-foreground tracking-tight font-mono">
              128
            </span>
            <span className="text-xs font-semibold text-ok">
              ↑ 14.2%
            </span>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="p-4 flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('dashboard.metric_success')}
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-foreground tracking-tight font-mono">
              97.8%
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-ok-bg text-ok font-semibold text-[10px]">
              +1.2%
            </span>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('dashboard.metric_running')}
            </span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-run tracking-tight font-mono">
              03
            </span>
            <span className="text-xs text-muted-foreground font-medium">
              {t('dashboard.metric_workers')}
            </span>
          </div>
        </div>
      </div>

      {/* 4. WORKFLOW ACTIVITY CHART & LIVE EXECUTION PANEL */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7">
          <WorkflowActivityChart />
        </div>
        <div className="lg:col-span-5">
          <LiveExecutionPanel />
        </div>
      </div>

      {/* 5. RECENT WORKFLOWS TABLE */}
      <div className="bg-card border border-border rounded-lg shadow-2xs overflow-hidden">
        {/* Table Header Bar */}
        <div className="px-4 py-3 flex items-center justify-between border-b border-border">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-bold text-foreground tracking-tight">
              {t('dashboard.recent_workflows')}
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-subtle text-text-2 font-mono text-[11px]">
              5 {t('dashboard.active_count')}
            </span>
          </div>
          <Link
            to="/workflows"
            className="text-xs text-run hover:text-run font-semibold flex items-center gap-1 transition-colors"
          >
            <span>{t('dashboard.view_all_workflows')}</span>
            <ArrowRight size={13} />
          </Link>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-subtle text-muted-foreground font-semibold uppercase tracking-wider text-[10px] border-b border-border">
              <tr>
                <th className="py-2.5 px-4">{t('dashboard.table_name')}</th>
                <th className="py-2.5 px-3">{t('dashboard.table_status')}</th>
                <th className="py-2.5 px-3 text-right">{t('dashboard.table_executions')}</th>
                <th className="py-2.5 px-3">{t('dashboard.table_success')}</th>
                <th className="py-2.5 px-3">{t('dashboard.table_last_run')}</th>
                <th className="py-2.5 px-4 text-right">{t('dashboard.table_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-text-2">
              {/* Row 1 */}
              <tr className="hover:bg-subtle transition-colors group cursor-pointer">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-md bg-run-bg text-run flex items-center justify-center font-bold text-xs shrink-0">
                      <ShoppingCart size={14} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-foreground truncate">
                        Order processing & notification
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">wf-prod-8492</span>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-3">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-run-bg text-run font-semibold text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                    {t('status.running')}
                  </span>
                </td>
                <td className="py-3 px-3 text-right font-mono text-xs text-text-2">
                  48
                </td>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-subtle overflow-hidden">
                      <div className="h-full bg-ok rounded-full" style={{ width: '98.4%' }} />
                    </div>
                    <span className="font-mono text-[11px] text-text-2">98.4%</span>
                  </div>
                </td>
                <td className="py-3 px-3 text-muted-foreground text-[11px]">{t('relative.min_2')}</td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => handleRunWorkflow('wf-prod-8492')}
                    className="p-1 rounded text-muted-foreground hover:text-text-2 hover:bg-subtle transition-colors"
                    title={t('dashboard.trigger_manual')}
                  >
                    <Play size={15} />
                  </button>
                </td>
              </tr>

              {/* Row 2 */}
              <tr className="hover:bg-subtle transition-colors group cursor-pointer">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-md bg-subtle text-text-2 flex items-center justify-center font-bold text-xs shrink-0">
                      <ArrowLeftRight size={14} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-foreground truncate">
                        PostgreSQL to BigQuery ETL Sync
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">wf-prod-3310</span>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-3">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-ok-bg text-ok font-semibold text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-ok" />
                    {t('status.success')}
                  </span>
                </td>
                <td className="py-3 px-3 text-right font-mono text-xs text-text-2">
                  32
                </td>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-subtle overflow-hidden">
                      <div className="h-full bg-ok rounded-full" style={{ width: '100%' }} />
                    </div>
                    <span className="font-mono text-[11px] text-text-2">100%</span>
                  </div>
                </td>
                <td className="py-3 px-3 text-muted-foreground text-[11px]">{t('relative.min_18')}</td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => handleRunWorkflow('wf-prod-3310')}
                    className="p-1 rounded text-muted-foreground hover:text-text-2 hover:bg-subtle transition-colors"
                    title={t('dashboard.trigger_manual')}
                  >
                    <Play size={15} />
                  </button>
                </td>
              </tr>

              {/* Row 3 */}
              <tr className="hover:bg-subtle transition-colors group cursor-pointer">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-md bg-subtle text-text-2 flex items-center justify-center font-bold text-xs shrink-0">
                      <Headphones size={14} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-foreground truncate">
                        Zendesk Priority Triage & Vectorization
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">wf-prod-6211</span>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-3">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-ok-bg text-ok font-semibold text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-ok" />
                    {t('status.success')}
                  </span>
                </td>
                <td className="py-3 px-3 text-right font-mono text-xs text-text-2">
                  24
                </td>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-subtle overflow-hidden">
                      <div className="h-full bg-ok rounded-full" style={{ width: '97.2%' }} />
                    </div>
                    <span className="font-mono text-[11px] text-text-2">97.2%</span>
                  </div>
                </td>
                <td className="py-3 px-3 text-muted-foreground text-[11px]">{t('relative.hour_1')}</td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => handleRunWorkflow('wf-prod-6211')}
                    className="p-1 rounded text-muted-foreground hover:text-text-2 hover:bg-subtle transition-colors"
                    title={t('dashboard.trigger_manual')}
                  >
                    <Play size={15} />
                  </button>
                </td>
              </tr>

              {/* Row 4 */}
              <tr className="hover:bg-subtle transition-colors group cursor-pointer">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-md bg-err-bg text-err flex items-center justify-center font-bold text-xs shrink-0">
                      <Cloud size={14} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-foreground truncate">
                        Daily S3 Backup & Checksum Audit
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">wf-prod-1094</span>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-3">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-err-bg text-err font-semibold text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-err" />
                    {t('status.failed')}
                  </span>
                </td>
                <td className="py-3 px-3 text-right font-mono text-xs text-text-2">
                  11
                </td>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-subtle overflow-hidden">
                      <div className="h-full bg-err rounded-full" style={{ width: '89.1%' }} />
                    </div>
                    <span className="font-mono text-[11px] text-text-2">89.1%</span>
                  </div>
                </td>
                <td className="py-3 px-3 text-muted-foreground text-[11px]">{t('relative.hour_2')}</td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => handleRunWorkflow('wf-prod-1094')}
                    className="p-1 rounded text-muted-foreground hover:text-text-2 hover:bg-subtle transition-colors"
                    title={t('dashboard.rerun_failed')}
                  >
                    <RotateCw size={15} />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
        </>
      ) : (
        <HttpDashboardContent
          workflows={workflows}
          isLoading={isLoading}
          error={apiError}
          actionError={actionError}
          onRetry={() => void loadData()}
          onRunWorkflow={(id) => void handleRunWorkflow(id)}
        />
      )}

    </div>
  );
}
