import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Plus, Play, RotateCw, Sparkles, X, Check, ArrowRight, Activity, ShoppingCart, ArrowLeftRight, Headphones, Cloud } from 'lucide-react';
import type { WorkflowDefinition, ExecutionDetail } from '../types/workflow.types';
import { workflowApi } from '../api/workflow.api';
import { executionApi } from '../api/execution.api';
import { WorkflowActivityChart } from '../components/dashboard/WorkflowActivityChart';
import { LiveExecutionPanel } from '../components/dashboard/LiveExecutionPanel';
import { useI18nStore } from '../store/useI18nStore';

export function DashboardPage() {
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const { t } = useI18nStore();

  const [, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [, setExecutions] = useState<ExecutionDetail[]>([]);

  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedNodes, setGeneratedNodes] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [wfList, execList] = await Promise.all([
        workflowApi.getWorkflows(),
        executionApi.getExecutions(),
      ]);
      setWorkflows(wfList);
      setExecutions(execList);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const handleRunWorkflow = async (id: string) => {
    await workflowApi.runWorkflow(id);
    await loadData();
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
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            {t('dashboard.title')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t('dashboard.subtitle')}
          </p>
        </div>

        {/* Top-Right Controls */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono text-[11px] font-medium border border-slate-200/60 dark:border-slate-700/60">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{t('dashboard.status_online')}</span>
          </div>

          <button
            onClick={() => navigate('/workflows/new')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Plus size={15} />
            <span>{t('dashboard.new_workflow')}</span>
          </button>
        </div>
      </div>

      {/* 2. UNIFIED METRICS BAND */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800 shadow-2xs overflow-hidden">
        {/* Metric 1 */}
        <div className="p-4 flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {t('dashboard.metric_active')}
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight font-mono">
              09
            </span>
            <span className="text-xs text-slate-400">/ 12 {t('dashboard.metric_total')}</span>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="p-4 flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {t('dashboard.metric_executions')}
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight font-mono">
              128
            </span>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              ↑ 14.2%
            </span>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="p-4 flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {t('dashboard.metric_success')}
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight font-mono">
              97.8%
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-semibold text-[10px]">
              +1.2%
            </span>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {t('dashboard.metric_running')}
            </span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-600 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600" />
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-blue-600 dark:text-blue-400 tracking-tight font-mono">
              03
            </span>
            <span className="text-xs text-slate-500 font-medium">
              {t('dashboard.metric_workers')}
            </span>
          </div>
        </div>
      </div>

      {/* 3. QUICK ACTIONS */}
      <motion.section
        data-testid="dashboard-quick-actions"
        aria-labelledby="dashboard-quick-actions-title"
        initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="dashboard-quick-actions-title" className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {t('dashboard.quick_actions')}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t('dashboard.quick_actions_hint')}
            </p>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">{t('dashboard.workflow_operations')}</span>
        </div>

        <div className="grid grid-cols-1 divide-y divide-slate-200 dark:divide-slate-800 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          <Link
            to="/workflows/new"
            className="group flex items-start gap-3 p-4 text-left transition-colors hover:bg-blue-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 dark:hover:bg-blue-950/25"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm transition-transform duration-200 group-hover:-translate-y-0.5">
              <Plus size={17} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                {t('dashboard.new_workflow')}
                <ArrowRight size={12} className="text-blue-600 transition-transform duration-200 group-hover:translate-x-0.5 dark:text-blue-400" />
              </span>
              <span className="mt-1 block text-[11px] leading-4 text-slate-500 dark:text-slate-400">{t('dashboard.create_blank_desc')}</span>
            </span>
          </Link>

          <button
            type="button"
            onClick={() => setAiModalOpen(true)}
            className="group flex items-start gap-3 p-4 text-left transition-colors hover:bg-blue-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 dark:hover:bg-blue-950/25"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 transition-transform duration-200 group-hover:-translate-y-0.5 dark:bg-blue-950/70 dark:text-blue-300">
              <Sparkles size={17} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                {t('dashboard.generate_ai')}
                <ArrowRight size={12} className="text-blue-600 transition-transform duration-200 group-hover:translate-x-0.5 dark:text-blue-400" />
              </span>
              <span className="mt-1 block text-[11px] leading-4 text-slate-500 dark:text-slate-400">{t('dashboard.create_ai_desc')}</span>
            </span>
          </button>

          <Link
            to="/workflows/wf-prod-8492/builder"
            className="group flex items-start gap-3 p-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 dark:hover:bg-slate-800/50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 transition-transform duration-200 group-hover:-translate-y-0.5 dark:bg-slate-800 dark:text-slate-200">
              <Play size={17} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                {t('dashboard.run_test')}
                <ArrowRight size={12} className="text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5" />
              </span>
              <span className="mt-1 block text-[11px] leading-4 text-slate-500 dark:text-slate-400">{t('dashboard.run_test_desc')}</span>
            </span>
          </Link>

          <Link
            to="/executions"
            className="group flex items-start gap-3 p-4 text-left transition-colors hover:bg-emerald-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 dark:hover:bg-emerald-950/20"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 transition-transform duration-200 group-hover:-translate-y-0.5 dark:bg-emerald-950/60 dark:text-emerald-300">
              <Activity size={17} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                {t('dashboard.view_executions')}
                <ArrowRight size={12} className="text-emerald-600 transition-transform duration-200 group-hover:translate-x-0.5 dark:text-emerald-400" />
              </span>
              <span className="mt-1 block text-[11px] leading-4 text-slate-500 dark:text-slate-400">{t('dashboard.view_executions_desc')}</span>
            </span>
          </Link>
        </div>
      </motion.section>

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
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xs overflow-hidden">
        {/* Table Header Bar */}
        <div className="px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              {t('dashboard.recent_workflows')}
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
              5 {t('dashboard.active_count')}
            </span>
          </div>
          <Link
            to="/workflows"
            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-semibold flex items-center gap-1 transition-colors"
          >
            <span>{t('dashboard.view_all_workflows')}</span>
            <ArrowRight size={13} />
          </Link>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-4">{t('dashboard.table_name')}</th>
                <th className="py-2.5 px-3">{t('dashboard.table_status')}</th>
                <th className="py-2.5 px-3 text-right">{t('dashboard.table_executions')}</th>
                <th className="py-2.5 px-3">{t('dashboard.table_success')}</th>
                <th className="py-2.5 px-3">{t('dashboard.table_last_run')}</th>
                <th className="py-2.5 px-4 text-right">{t('dashboard.table_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
              {/* Row 1 */}
              <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors group cursor-pointer">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">
                      <ShoppingCart size={14} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        Order processing & notification
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">wf-prod-8492</span>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-3">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-semibold text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping" />
                    {t('status.running')}
                  </span>
                </td>
                <td className="py-3 px-3 text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                  48
                </td>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: '98.4%' }} />
                    </div>
                    <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">98.4%</span>
                  </div>
                </td>
                <td className="py-3 px-3 text-slate-500 text-[11px]">2 min ago</td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => handleRunWorkflow('wf-prod-8492')}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Trigger manual run"
                  >
                    <Play size={15} />
                  </button>
                </td>
              </tr>

              {/* Row 2 */}
              <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors group cursor-pointer">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-xs shrink-0">
                      <ArrowLeftRight size={14} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        PostgreSQL to BigQuery ETL Sync
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">wf-prod-3310</span>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-3">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {t('status.success')}
                  </span>
                </td>
                <td className="py-3 px-3 text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                  32
                </td>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: '100%' }} />
                    </div>
                    <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">100%</span>
                  </div>
                </td>
                <td className="py-3 px-3 text-slate-500 text-[11px]">18 min ago</td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => handleRunWorkflow('wf-prod-3310')}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Trigger manual run"
                  >
                    <Play size={15} />
                  </button>
                </td>
              </tr>

              {/* Row 3 */}
              <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors group cursor-pointer">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-xs shrink-0">
                      <Headphones size={14} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        Zendesk Priority Triage & Vectorization
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">wf-prod-6211</span>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-3">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {t('status.success')}
                  </span>
                </td>
                <td className="py-3 px-3 text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                  24
                </td>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: '97.2%' }} />
                    </div>
                    <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">97.2%</span>
                  </div>
                </td>
                <td className="py-3 px-3 text-slate-500 text-[11px]">1 hour ago</td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => handleRunWorkflow('wf-prod-6211')}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Trigger manual run"
                  >
                    <Play size={15} />
                  </button>
                </td>
              </tr>

              {/* Row 4 */}
              <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors group cursor-pointer">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-md bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold text-xs shrink-0">
                      <Cloud size={14} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        Daily S3 Backup & Checksum Audit
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">wf-prod-1094</span>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-3">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-semibold text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                    {t('status.failed')}
                  </span>
                </td>
                <td className="py-3 px-3 text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                  11
                </td>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full bg-rose-500 rounded-full" style={{ width: '89.1%' }} />
                    </div>
                    <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">89.1%</span>
                  </div>
                </td>
                <td className="py-3 px-3 text-slate-500 text-[11px]">2 hours ago</td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => handleRunWorkflow('wf-prod-1094')}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Re-run failed workflow"
                  >
                    <RotateCw size={15} />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 6. CREATE WITH AI MODAL */}
      <AnimatePresence>
        {aiModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAiModalOpen(false)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-6 shadow-xl space-y-4 z-10"
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-blue-600 dark:text-blue-400" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {t('dashboard.ai_modal_title')}
                  </h3>
                </div>
                <button
                  onClick={() => setAiModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="text-xs text-slate-500">
                {t('dashboard.ai_modal_subtitle')}
              </p>

              <form onSubmit={handleAiGenerateSubmit} className="space-y-4">
                <textarea
                  rows={3}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder={t('dashboard.ai_prompt_placeholder')}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600 transition-colors resize-none"
                />

                {generatedNodes.length > 0 && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded border border-slate-200 dark:border-slate-700/60 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-500">{t('dashboard.generated_flow')}</div>
                    <div className="flex items-center gap-2 font-mono text-xs text-blue-600 dark:text-blue-400 flex-wrap">
                      {generatedNodes.map((node, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/60 rounded">
                            {node}
                          </span>
                          {idx < generatedNodes.length - 1 && <span>→</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setAiModalOpen(false)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                  >
                    {t('dashboard.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isGenerating || !aiPrompt.trim()}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
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
