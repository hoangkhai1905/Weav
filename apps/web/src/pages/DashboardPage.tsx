import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Plus, Play, RotateCw, Sparkles, X, Check, ArrowRight, Activity, ShoppingCart, ArrowLeftRight, Headphones, Cloud } from 'lucide-react';
import type { WorkflowDefinition } from '../types/workflow.types';
import { isWorkflowMockMode, workflowApi } from '../api/workflow.api';
import { WorkflowActivityChart } from '../components/dashboard/WorkflowActivityChart';
import { LiveExecutionPanel } from '../components/dashboard/LiveExecutionPanel';
import { useI18nStore } from '../store/useI18nStore';
import { tr } from '../lib/i18n/tr';

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
  onOpenAi: () => void;
}

function DashboardQuickActions({ prefersReducedMotion, onOpenAi }: DashboardQuickActionsProps) {
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

        {isWorkflowMockMode ? (
          <button
            type="button"
            onClick={onOpenAi}
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
          </button>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            title={t('dashboard.ai_unavailable')}
            className="group flex cursor-not-allowed items-start gap-3 p-4 text-left opacity-60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-muted-foreground">
              <Sparkles size={17} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                {t('dashboard.generate_ai')}
              </span>
              <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{t('dashboard.ai_unavailable')}</span>
            </span>
          </button>
        )}

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
  const { t } = useI18nStore();
  const publishedCount = workflows.filter((workflow) => workflow.status === 'PUBLISHED').length;

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
        <div className="rounded-lg border border-dashed border-border-strong bg-subtle p-4 text-sm text-muted-foreground">
          {t('dashboard.execution_data_unavailable')}
        </div>
        <div className="rounded-lg border border-dashed border-border-strong bg-subtle p-4 text-sm text-muted-foreground">
          {t('dashboard.activity_data_unavailable')}
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div data-testid="dashboard-activity-unavailable" className="rounded-lg border border-dashed border-border-strong bg-subtle p-6 text-sm text-muted-foreground">
          {t('dashboard.activity_data_unavailable')}
        </div>
        <div data-testid="dashboard-live-unavailable" className="rounded-lg border border-dashed border-border-strong bg-subtle p-6 text-sm text-muted-foreground">
          {t('dashboard.execution_data_unavailable')}
        </div>
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

  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedNodes, setGeneratedNodes] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setApiError(null);
    try {
      const wfList = await workflowApi.getWorkflows();
      setWorkflows(wfList);
    } catch (e) {
      setWorkflows([]);
      setApiError(e instanceof Error ? e.message : tr('msg.workflow_data_could_not_be_loaded'));
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  const handleAiGenerateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;

    setIsGenerating(true);
    setGeneratedNodes([]);

    setTimeout(() => {
      setGeneratedNodes(['Webhook Trigger']);
    }, 400);

    setTimeout(() => {
      setGeneratedNodes(['Webhook Trigger', 'AI Data Extraction']);
    }, 900);

    setTimeout(() => {
      setGeneratedNodes(['Webhook Trigger', 'AI Data Extraction', 'Google Sheets Action']);
      setIsGenerating(false);
    }, 1500);
  };

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
      <DashboardQuickActions
        prefersReducedMotion={prefersReducedMotion}
        onOpenAi={() => setAiModalOpen(true)}
      />

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

      {/* 6. CREATE WITH AI MODAL */}
      <AnimatePresence>
        {aiModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAiModalOpen(false)}
              className="absolute inset-0 bg-foreground/30"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              className="relative w-full max-w-lg bg-card border border-border rounded-md p-6 shadow-pop space-y-4 z-10"
            >
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-run" />
                  <h3 className="text-sm font-bold text-foreground">
                    {t('dashboard.ai_modal_title')}
                  </h3>
                </div>
                <button
                  onClick={() => setAiModalOpen(false)}
                  className="text-muted-foreground hover:text-text-2 p-1"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                {t('dashboard.ai_modal_subtitle')}
              </p>

              <form onSubmit={handleAiGenerateSubmit} className="space-y-4">
                <textarea
                  rows={3}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder={t('dashboard.ai_prompt_placeholder')}
                  className="w-full p-3 bg-subtle border border-border rounded-md text-xs text-foreground focus:outline-none focus:border-run/30 transition-colors resize-none"
                />

                {generatedNodes.length > 0 && (
                  <div className="p-3 bg-subtle rounded border border-border space-y-2">
                    <div className="text-[11px] font-semibold text-muted-foreground">{t('dashboard.generated_flow')}</div>
                    <div className="flex items-center gap-2 font-mono text-xs text-run flex-wrap">
                      {generatedNodes.map((node, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-run-bg border border-run/30 rounded">
                            {node}
                          </span>
                          {idx < generatedNodes.length - 1 && <span>→</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setAiModalOpen(false)}
                    className="px-3 py-1.5 text-xs font-medium text-text-2 hover:bg-subtle rounded transition-colors"
                  >
                    {t('dashboard.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isGenerating || !aiPrompt.trim()}
                    className="px-4 py-1.5 bg-primary hover:bg-primary text-white rounded text-xs font-semibold transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {isGenerating ? (
                      <span>{t('dashboard.generating')}</span>
                    ) : generatedNodes.length > 0 ? (
                      <>
                        <Check size={14} />
                        <span>{t('dashboard.done')}</span>
                      </>
                    ) : (
                      <>
                        <span>{t('dashboard.generate_workflow')}</span>
                        <ArrowRight size={14} />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
