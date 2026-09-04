import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  RefreshCw,
  RotateCcw,
  Download,
  Cloud,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Zap,
  Play,
  StopCircle,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  X,
  Terminal,
  Activity,
} from 'lucide-react';

export interface ExecutionItem {
  id: string;
  workflowId: string;
  workflowName: string;
  version: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  startedTime: string;
  startedRelative: string;
  startedTimestamp: number;
  durationMs: number;
  stepsCompleted: number;
  stepsTotal: number;
  triggerType: 'Webhook' | 'Schedule' | 'Manual' | 'Event';
  triggerDetail: string;
  error?: string;
}

const INITIAL_EXECUTION_LIST: ExecutionItem[] = [
  {
    id: '#EX-8492',
    workflowId: 'wf-prod-8492',
    workflowName: 'Order processing & notification',
    version: 'v1.4',
    status: 'RUNNING',
    startedTime: '10:42:15',
    startedRelative: '14s ago',
    startedTimestamp: Date.now() - 14200,
    durationMs: 14200,
    stepsCompleted: 3,
    stepsTotal: 4,
    triggerType: 'Webhook',
    triggerDetail: 'Webhook (POST /stripe)',
  },
  {
    id: '#EX-8491',
    workflowId: 'wf-prod-8491',
    workflowName: 'Customer onboarding & enrichment',
    version: 'v2.1',
    status: 'SUCCESS',
    startedTime: '10:35:02',
    startedRelative: '7m ago',
    startedTimestamp: Date.now() - 7 * 60 * 1000,
    durationMs: 4200,
    stepsCompleted: 5,
    stepsTotal: 5,
    triggerType: 'Schedule',
    triggerDetail: 'Schedule (Daily)',
  },
  {
    id: '#EX-8490',
    workflowId: 'wf-prod-8490',
    workflowName: 'Daily S3 Backup & Checksum Audit',
    version: 'v3.0',
    status: 'FAILED',
    startedTime: '09:30:00',
    startedRelative: '1h ago',
    startedTimestamp: Date.now() - 60 * 60 * 1000,
    durationMs: 8100,
    stepsCompleted: 3,
    stepsTotal: 6,
    triggerType: 'Schedule',
    triggerDetail: 'Schedule (Cron)',
    error: 'S3 ETIMEDOUT (host unreachable)',
  },
  {
    id: '#EX-8489',
    workflowId: 'wf-prod-8489',
    workflowName: 'PostgreSQL to BigQuery ETL Sync',
    version: 'v1.2',
    status: 'SUCCESS',
    startedTime: '09:15:22',
    startedRelative: '1h ago',
    startedTimestamp: Date.now() - 75 * 60 * 1000,
    durationMs: 1800,
    stepsCompleted: 4,
    stepsTotal: 4,
    triggerType: 'Schedule',
    triggerDetail: 'Schedule (Hourly)',
  },
  {
    id: '#EX-8488',
    workflowId: 'wf-prod-8488',
    workflowName: 'Zendesk Priority Triage & Vectors',
    version: 'v0.9',
    status: 'SUCCESS',
    startedTime: '08:44:10',
    startedRelative: '2h ago',
    startedTimestamp: Date.now() - 2 * 3600 * 1000,
    durationMs: 580,
    stepsCompleted: 3,
    stepsTotal: 3,
    triggerType: 'Webhook',
    triggerDetail: 'Webhook (Zendesk)',
  },
  {
    id: '#EX-8487',
    workflowId: 'wf-prod-8487',
    workflowName: 'Invoice PDF OCR & Slack Dispatcher',
    version: 'v1.0',
    status: 'CANCELLED',
    startedTime: '08:12:05',
    startedRelative: '2h ago',
    startedTimestamp: Date.now() - 2.5 * 3600 * 1000,
    durationMs: 2100,
    stepsCompleted: 1,
    stepsTotal: 4,
    triggerType: 'Manual',
    triggerDetail: 'Manual (Admin)',
    error: 'User stopped execution',
  },
  {
    id: '#EX-8486',
    workflowId: 'wf-prod-8486',
    workflowName: 'Order processing & notification',
    version: 'v1.4',
    status: 'SUCCESS',
    startedTime: '07:55:18',
    startedRelative: '3h ago',
    startedTimestamp: Date.now() - 3 * 3600 * 1000,
    durationMs: 1400,
    stepsCompleted: 4,
    stepsTotal: 4,
    triggerType: 'Webhook',
    triggerDetail: 'Webhook (POST /stripe)',
  },
  {
    id: '#EX-8485',
    workflowId: 'wf-prod-8485',
    workflowName: 'Lead Scoring & CRM Enrichment',
    version: 'v2.0',
    status: 'SUCCESS',
    startedTime: '07:30:00',
    startedRelative: '3h ago',
    startedTimestamp: Date.now() - 3.5 * 3600 * 1000,
    durationMs: 3600,
    stepsCompleted: 4,
    stepsTotal: 4,
    triggerType: 'Event',
    triggerDetail: 'Event (HubSpot)',
  },
];

export function ExecutionsPage() {
  const navigate = useNavigate();
  const [executions, setExecutions] = useState<ExecutionItem[]>(INITIAL_EXECUTION_LIST);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED'>('ALL');
  const [workflowFilter, setWorkflowFilter] = useState('ALL');
  const [triggerFilter, setTriggerFilter] = useState('ALL');
  const [timeRangeFilter, setTimeRangeFilter] = useState('24h');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeLogModal, setActiveLogModal] = useState<ExecutionItem | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Live timer tick for running executions duration & auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const timer = setInterval(() => {
      setExecutions((prev) =>
        prev.map((item) => {
          if (item.status === 'RUNNING') {
            const newDuration = item.durationMs + 100;
            const secsAgo = Math.floor(newDuration / 1000);
            return {
              ...item,
              durationMs: newDuration,
              startedRelative: `${secsAgo}s ago`,
            };
          }
          return item;
        })
      );
    }, 100);

    return () => clearInterval(timer);
  }, [autoRefresh]);

  // Show temporary toast message helper
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Re-run execution
  const handleReRun = (execution: ExecutionItem) => {
    const newId = `#EX-${Math.floor(8493 + Math.random() * 100)}`;
    const newExec: ExecutionItem = {
      ...execution,
      id: newId,
      status: 'RUNNING',
      startedTime: new Date().toLocaleTimeString('en-US', { hour12: false }),
      startedRelative: '0s ago',
      startedTimestamp: Date.now(),
      durationMs: 200,
      stepsCompleted: 1,
      error: undefined,
    };

    setExecutions((prev) => [newExec, ...prev]);
    triggerToast(`Re-running execution ${execution.id} as ${newId}`);
  };

  // Stop running execution
  const handleStopExecution = (id: string) => {
    setExecutions((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'CANCELLED',
              error: 'User cancelled execution',
            }
          : item
      )
    );
    triggerToast(`Execution ${id} was cancelled.`);
  };

  // CSV Export
  const handleExportCSV = () => {
    const headers = ['Execution ID', 'Workflow', 'Version', 'Status', 'Started', 'Duration (ms)', 'Steps', 'Trigger', 'Error'];
    const rows = filteredExecutions.map((e) => [
      e.id,
      `"${e.workflowName}"`,
      e.version,
      e.status,
      e.startedTime,
      e.durationMs,
      `"${e.stepsCompleted}/${e.stepsTotal}"`,
      `"${e.triggerDetail}"`,
      `"${e.error || ''}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.setAttribute('download', `weav-executions-${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    triggerToast('Executions exported to CSV');
  };

  // Unique workflow names for dropdown filter
  const workflowNames = useMemo(() => {
    const set = new Set(executions.map((e) => e.workflowName));
    return Array.from(set);
  }, [executions]);

  // Filtering
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const filteredExecutions = useMemo(() => {
    return executions.filter((item) => {
      // Status tab
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;

      // Workflow dropdown
      if (workflowFilter !== 'ALL' && item.workflowName !== workflowFilter) return false;

      // Trigger dropdown
      if (triggerFilter !== 'ALL' && item.triggerType !== triggerFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = item.id.toLowerCase().includes(q);
        const matchesName = item.workflowName.toLowerCase().includes(q);
        const matchesError = item.error ? item.error.toLowerCase().includes(q) : false;
        const matchesTrigger = item.triggerDetail.toLowerCase().includes(q);
        if (!matchesId && !matchesName && !matchesError && !matchesTrigger) return false;
      }

      return true;
    });
  }, [executions, statusFilter, workflowFilter, triggerFilter, searchQuery]);

  // Counts for status tabs
  const counts = useMemo(() => {
    return {
      ALL: executions.length,
      RUNNING: executions.filter((e) => e.status === 'RUNNING').length,
      SUCCESS: executions.filter((e) => e.status === 'SUCCESS').length,
      FAILED: executions.filter((e) => e.status === 'FAILED').length,
      CANCELLED: executions.filter((e) => e.status === 'CANCELLED').length,
    };
  }, [executions]);

  // Select all checkbox
  const isAllSelected = filteredExecutions.length > 0 && selectedIds.size === filteredExecutions.length;
  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredExecutions.map((e) => e.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Running active execution for top live panel
  const activeRunning = useMemo(() => {
    return executions.find((e) => e.status === 'RUNNING') || executions[0];
  }, [executions]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto pb-12">
      {/* Toast Banner */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-16 right-8 z-50 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-xl shadow-xl border border-slate-800 flex items-center gap-2"
          >
            <Activity size={14} className="text-[#2563EB] animate-pulse" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header & Main Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Executions</h1>
            <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-blue-950/60 text-[#2563EB] dark:text-blue-300 font-mono text-[11px] font-semibold border border-indigo-100 dark:border-blue-900/50">
              v2.4-stream
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Monitor workflow runs, live throughput, and execution telemetry in real-time.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              autoRefresh
                ? 'bg-indigo-50/60 dark:bg-blue-950/40 text-[#2563EB] dark:text-blue-300 border-indigo-200 dark:border-blue-800'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <span className="relative flex h-2 w-2">
              {autoRefresh && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2563EB] opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${autoRefresh ? 'bg-[#2563EB]' : 'bg-slate-400'}`}></span>
            </span>
            <span>Auto-refresh ({autoRefresh ? '5s' : 'Off'})</span>
            <RefreshCw size={13} className={autoRefresh ? 'animate-spin text-[#2563EB]' : 'text-slate-400'} />
          </button>

          {/* Re-run Last Failed */}
          <button
            onClick={() => {
              const failed = executions.find((e) => e.status === 'FAILED');
              if (failed) handleReRun(failed);
              else triggerToast('No failed executions to re-run');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-xs font-medium shadow-sm"
          >
            <RotateCcw size={13} className="text-slate-400" />
            <span>Re-run last failed</span>
          </button>

          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-xs font-medium shadow-sm"
          >
            <Download size={13} className="text-slate-400" />
            <span>Export CSV</span>
          </button>

          {/* Environment Pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-xs text-[11px]">
            <Cloud size={13} className="text-[#2563EB]" />
            <span className="font-mono font-medium">us-east-1</span>
            <span className="text-slate-400">/</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">Production</span>
          </div>
        </div>
      </div>

      {/* Operational Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Total Runs */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Runs (24h)
            </span>
            <Clock size={16} className="text-slate-400" />
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 tracking-tight">1,482</span>
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold">
              <TrendingUp size={12} />
              <span>+12.4%</span>
            </div>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-[#2563EB] h-full rounded-full" style={{ width: '78%' }}></div>
          </div>
        </div>

        {/* Card 2: Active Executions */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active Executions
            </span>
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2563EB] opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#2563EB]"></span>
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 tracking-tight">
                {counts.RUNNING}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">running now</span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-blue-950/60 text-[#2563EB] dark:text-blue-300 text-[11px] font-semibold">
              12 queued
            </span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-[#2563EB] h-full rounded-full animate-pulse" style={{ width: '25%' }}></div>
          </div>
        </div>

        {/* Card 3: Success Rate */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Success Rate
            </span>
            <CheckCircle2 size={16} className="text-emerald-500" />
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 tracking-tight">98.6%</span>
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">38 failed (2.4%)</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden flex">
            <div className="bg-emerald-500 h-full" style={{ width: '98.6%' }}></div>
            <div className="bg-rose-500 h-full" style={{ width: '1.4%' }}></div>
          </div>
        </div>

        {/* Card 4: Avg Execution Time */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Avg Execution Time
            </span>
            <Zap size={16} className="text-amber-500" />
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 tracking-tight">420ms</span>
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold">
              <TrendingDown size={12} />
              <span>-18ms</span>
            </div>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-amber-500 h-full rounded-full" style={{ width: '62%' }}></div>
          </div>
        </div>
      </div>

      {/* Live Run in Progress Panel */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 pb-1 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2563EB] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2563EB]"></span>
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-[#2563EB]">Live Run in Progress</span>
            <span className="text-slate-300 dark:text-slate-700">•</span>
            <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">{activeRunning.id}</span>
            <span className="text-slate-300 dark:text-slate-700">—</span>
            <span className="text-xs font-medium text-slate-800 dark:text-slate-200">{activeRunning.workflowName}</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono text-[10px]">
              {activeRunning.version}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 font-mono text-slate-500 dark:text-slate-400">
              <Clock size={13} className="text-slate-400" />
              <span>
                Started {activeRunning.startedTime} (
                <span className="text-[#2563EB] font-medium">{activeRunning.startedRelative}</span>)
              </span>
            </div>
            <span className="text-slate-200 dark:text-slate-800">|</span>
            <button
              onClick={() => navigate(`/executions/${activeRunning.id.replace('#', '')}`)}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-50 dark:bg-blue-950/60 text-[#2563EB] dark:text-blue-300 text-[11px] font-semibold hover:bg-[#2563EB] hover:text-white transition-colors"
            >
              <Activity size={13} />
              <span>View live trace</span>
            </button>
            <button
              onClick={() => handleStopExecution(activeRunning.id)}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 text-[11px] font-medium hover:bg-rose-600 hover:text-white transition-colors"
            >
              <StopCircle size={13} />
              <span>Cancel</span>
            </button>
          </div>
        </div>

        {/* Step Diagram Pipeline */}
        <div className="bg-slate-50 dark:bg-slate-950/60 rounded-lg p-3 flex flex-col md:flex-row items-center justify-between gap-4 overflow-x-auto">
          <div className="flex items-center gap-2 w-full min-w-[620px]">
            {/* Step 1 */}
            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-3 py-2 rounded-lg border border-slate-200/80 dark:border-slate-800 shadow-sm shrink-0">
              <CheckCircle2 size={16} className="text-emerald-500" />
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">1. Webhook</span>
                <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">120ms • HTTP 200</span>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-center relative min-w-[30px]">
              <div className="w-full border-t-2 border-dashed border-emerald-500/40"></div>
              <ChevronRight size={12} className="text-emerald-500 absolute right-0" />
            </div>

            {/* Step 2 */}
            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-3 py-2 rounded-lg border border-slate-200/80 dark:border-slate-800 shadow-sm shrink-0">
              <CheckCircle2 size={16} className="text-emerald-500" />
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">2. PostgreSQL</span>
                <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">45ms • Rows parsed</span>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-center relative min-w-[30px]">
              <div className="w-full border-t-2 border-indigo-400 dark:border-blue-600"></div>
              <ChevronRight size={12} className="text-[#2563EB] absolute right-0" />
            </div>

            {/* Step 3 */}
            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-3 py-2 rounded-lg border border-[#2563EB]/40 shadow-sm shrink-0">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2563EB] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#2563EB]"></span>
              </span>
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold text-[#2563EB]">3. AI Extract</span>
                <span className="font-mono text-[10px] text-slate-500 animate-pulse">processing chunk 2...</span>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-center relative min-w-[30px]">
              <div className="w-full border-t-2 border-dashed border-slate-300 dark:border-slate-700"></div>
              <ChevronRight size={12} className="text-slate-400 absolute right-0" />
            </div>

            {/* Step 4 */}
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/50 px-3 py-2 rounded-lg opacity-70 shrink-0">
              <div className="w-3.5 h-3.5 rounded-full border border-slate-400"></div>
              <div className="flex flex-col">
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">4. Slack Notify</span>
                <span className="font-mono text-[10px] text-slate-400">pending input</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pl-4 shrink-0 border-l border-slate-200 dark:border-slate-800">
            <div className="flex flex-col items-end">
              <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">3 / 4 completed</span>
              <span className="font-mono text-[10px] text-slate-400">75% elapsed</span>
            </div>
            <div className="w-16 bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
              <div className="bg-[#2563EB] h-full rounded-full" style={{ width: '75%' }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          {/* Search Bar */}
          <div className="flex items-center flex-1 max-w-lg bg-slate-50 dark:bg-slate-800/60 rounded-lg px-3 py-1.5 border border-slate-200/80 dark:border-slate-700/60">
            <Search size={15} className="text-slate-400 mr-2 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search executions by ID, payload, or error..."
              className="w-full bg-transparent text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
            />
            {searchQuery ? (
              <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            ) : (
              <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                ⌘ K
              </kbd>
            )}
          </div>

          <div className="flex items-center flex-wrap gap-2">
            {/* Status Tabs */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
              {(['ALL', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const).map((tab) => {
                const isActive = statusFilter === tab;
                const label =
                  tab === 'ALL'
                    ? `All (${counts.ALL})`
                    : tab === 'RUNNING'
                    ? `Running (${counts.RUNNING})`
                    : tab === 'SUCCESS'
                    ? `Success (${counts.SUCCESS})`
                    : tab === 'FAILED'
                    ? `Failed (${counts.FAILED})`
                    : `Cancelled (${counts.CANCELLED})`;

                return (
                  <button
                    key={tab}
                    onClick={() => setStatusFilter(tab)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                      isActive
                        ? 'bg-white dark:bg-slate-900 text-[#2563EB] dark:text-blue-300 shadow-sm font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Dropdown Filters */}
            <div className="flex items-center gap-2">
              {/* Workflow Filter */}
              <select
                value={workflowFilter}
                onChange={(e) => setWorkflowFilter(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 focus:outline-none cursor-pointer max-w-[160px] truncate"
              >
                <option value="ALL">All Workflows</option>
                {workflowNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>

              {/* Trigger Filter */}
              <select
                value={triggerFilter}
                onChange={(e) => setTriggerFilter(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Triggers</option>
                <option value="Webhook">Webhook</option>
                <option value="Schedule">Schedule</option>
                <option value="Manual">Manual</option>
                <option value="Event">Event</option>
              </select>

              {/* Time Range Filter */}
              <select
                value={timeRangeFilter}
                onChange={(e) => setTimeRangeFilter(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="24h">Last 24 hours</option>
                <option value="1h">Last 1 hour</option>
                <option value="7d">Last 7 days</option>
                <option value="custom">Custom range</option>
              </select>

              {/* Clear Filters */}
              {(statusFilter !== 'ALL' || workflowFilter !== 'ALL' || triggerFilter !== 'ALL' || searchQuery) && (
                <button
                  onClick={() => {
                    setStatusFilter('ALL');
                    setWorkflowFilter('ALL');
                    setTriggerFilter('ALL');
                    setSearchQuery('');
                  }}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Clear filters"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Execution Table */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-[10px] uppercase font-semibold tracking-wider border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2.5 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleSelectAll}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-[#2563EB] focus:ring-0 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3 font-semibold">Execution ID</th>
                  <th className="py-2.5 px-3 font-semibold">Workflow Name</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold">Started</th>
                  <th className="py-2.5 px-3 font-semibold">Duration</th>
                  <th className="py-2.5 px-3 font-semibold">Steps / Progress</th>
                  <th className="py-2.5 px-3 font-semibold">Triggered By</th>
                  <th className="py-2.5 px-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs text-slate-800 dark:text-slate-200">
                {filteredExecutions.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-500 dark:text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Terminal size={24} className="text-slate-300 dark:text-slate-600" />
                        <p className="font-medium text-xs">No executions match your search or filter criteria.</p>
                        <button
                          onClick={() => {
                            setStatusFilter('ALL');
                            setWorkflowFilter('ALL');
                            setTriggerFilter('ALL');
                            setSearchQuery('');
                          }}
                          className="mt-1 text-xs text-[#2563EB] hover:underline font-medium"
                        >
                          Clear filters
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredExecutions.map((exec) => {
                    const isSelected = selectedIds.has(exec.id);

                    return (
                      <tr
                        key={exec.id}
                        className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                          isSelected ? 'bg-indigo-50/30 dark:bg-blue-950/20' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(exec.id)}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-[#2563EB] focus:ring-0 cursor-pointer"
                          />
                        </td>

                        {/* Execution ID */}
                        <td
                          onClick={() => navigate(`/executions/${exec.id.replace('#', '')}`)}
                          className="py-2.5 px-3 font-mono text-xs font-bold text-[#2563EB] dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          {exec.id}
                        </td>

                        {/* Workflow Name */}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900 dark:text-slate-100">{exec.workflowName}</span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono text-[10px]">
                              {exec.version}
                            </span>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-2.5 px-3">
                          {exec.status === 'RUNNING' && (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-blue-950/80 text-[#2563EB] dark:text-blue-300 font-semibold text-[11px]">
                              <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB] animate-ping"></span>
                              Running
                            </span>
                          )}
                          {exec.status === 'SUCCESS' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
                              <CheckCircle2 size={12} />
                              Success
                            </span>
                          )}
                          {exec.status === 'FAILED' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 font-semibold text-[11px]">
                              <AlertTriangle size={12} />
                              Failed
                            </span>
                          )}
                          {exec.status === 'CANCELLED' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium text-[11px]">
                              <XCircle size={12} />
                              Cancelled
                            </span>
                          )}
                        </td>

                        {/* Started */}
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col">
                            <span className="font-mono text-[11px] text-slate-900 dark:text-slate-100">{exec.startedTime}</span>
                            <span className="text-[10px] text-slate-400">{exec.startedRelative}</span>
                          </div>
                        </td>

                        {/* Duration */}
                        <td className="py-2.5 px-3 font-mono text-[11px] font-medium text-slate-700 dark:text-slate-300">
                          {formatDuration(exec.durationMs)}
                        </td>

                        {/* Steps / Progress */}
                        <td className="py-2.5 px-3">
                          {exec.status === 'FAILED' ? (
                            <div className="flex flex-col gap-0.5 min-w-[140px]">
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                  <div
                                    className="bg-rose-500 h-full rounded-full"
                                    style={{ width: `${(exec.stepsCompleted / exec.stepsTotal) * 100}%` }}
                                  ></div>
                                </div>
                                <span className="font-mono text-[11px] text-rose-600 font-semibold">
                                  {exec.stepsCompleted} / {exec.stepsTotal}
                                </span>
                              </div>
                              <span className="font-mono text-[10px] text-rose-500 truncate max-w-[180px]">{exec.error}</span>
                            </div>
                          ) : exec.status === 'CANCELLED' ? (
                            <div className="flex flex-col gap-0.5 min-w-[140px]">
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                  <div
                                    className="bg-slate-400 h-full rounded-full"
                                    style={{ width: `${(exec.stepsCompleted / exec.stepsTotal) * 100}%` }}
                                  ></div>
                                </div>
                                <span className="font-mono text-[11px] text-slate-400">
                                  {exec.stepsCompleted} / {exec.stepsTotal}
                                </span>
                              </div>
                              <span className="font-mono text-[10px] text-slate-400 truncate max-w-[180px]">
                                {exec.error || 'User stopped execution'}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 min-w-[140px]">
                              <div className="w-16 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className={`${exec.status === 'RUNNING' ? 'bg-[#2563EB]' : 'bg-emerald-500'} h-full rounded-full`}
                                  style={{ width: `${(exec.stepsCompleted / exec.stepsTotal) * 100}%` }}
                                ></div>
                              </div>
                              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                                {exec.stepsCompleted} / {exec.stepsTotal} (
                                {Math.round((exec.stepsCompleted / exec.stepsTotal) * 100)}%)
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Triggered By */}
                        <td className="py-2.5 px-3">
                          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px]">
                            {exec.triggerType === 'Webhook' && <Zap size={12} className="text-[#2563EB]" />}
                            {exec.triggerType === 'Schedule' && <Clock size={12} className="text-amber-500" />}
                            {exec.triggerType === 'Manual' && <Play size={12} className="text-emerald-500" />}
                            {exec.triggerType === 'Event' && <Activity size={12} className="text-blue-500" />}
                            <span className="truncate max-w-[140px]">{exec.triggerDetail}</span>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => navigate(`/executions/${exec.id.replace('#', '')}`)}
                              className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 text-[11px] font-medium transition-colors"
                            >
                              View trace
                            </button>

                            {exec.status === 'RUNNING' && (
                              <button
                                onClick={() => handleStopExecution(exec.id)}
                                className="px-2.5 py-1 rounded bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-600 hover:text-white text-rose-600 dark:text-rose-400 text-[11px] font-medium transition-colors"
                              >
                                Stop
                              </button>
                            )}

                            {exec.status === 'FAILED' && (
                              <button
                                onClick={() => setActiveLogModal(exec)}
                                className="px-2.5 py-1 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 hover:bg-rose-600 hover:text-white text-[11px] font-semibold transition-colors"
                              >
                                Debug log
                              </button>
                            )}

                            {(exec.status === 'SUCCESS' || exec.status === 'CANCELLED') && (
                              <button
                                onClick={() => handleReRun(exec)}
                                className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 text-[11px] transition-colors"
                              >
                                Re-run
                              </button>
                            )}

                            <button
                              onClick={() => setActiveLogModal(exec)}
                              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600"
                              title="Logs"
                            >
                              <Terminal size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer / Pagination */}
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-slate-500 dark:text-slate-400 text-xs">
            <div className="flex items-center gap-4">
              <span>
                Showing <span className="font-semibold font-mono text-slate-900 dark:text-slate-100">1–{filteredExecutions.length}</span> of{' '}
                <span className="font-semibold font-mono text-slate-900 dark:text-slate-100">1,482</span> executions
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Rows:</span>
                <select className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded px-2 py-0.5 focus:outline-none cursor-pointer">
                  <option>25 per page</option>
                  <option>50 per page</option>
                  <option>100 per page</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                disabled
                className="px-2.5 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-400 text-xs disabled:opacity-50"
              >
                Previous
              </button>
              <button className="px-2.5 py-1 rounded bg-[#2563EB] text-white font-bold text-xs">1</button>
              <button className="px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs transition-colors">
                2
              </button>
              <button className="px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs transition-colors">
                3
              </button>
              <span className="px-1 text-slate-400">…</span>
              <button className="px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs transition-colors">
                59
              </button>
              <button className="px-2.5 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Debug Log Modal */}
      <AnimatePresence>
        {activeLogModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 text-slate-100 rounded-xl border border-slate-800 w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col"
            >
              {/* Modal Header */}
              <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal size={16} className="text-[#2563EB]" />
                  <span className="font-mono font-bold text-xs text-white">{activeLogModal.id} Telemetry & Debug Logs</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      activeLogModal.status === 'FAILED'
                        ? 'bg-rose-950 text-rose-400'
                        : activeLogModal.status === 'SUCCESS'
                        ? 'bg-emerald-950 text-emerald-400'
                        : 'bg-indigo-950 text-blue-300'
                    }`}
                  >
                    {activeLogModal.status}
                  </span>
                </div>
                <button
                  onClick={() => setActiveLogModal(null)}
                  className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-4 space-y-3 font-mono text-xs max-h-[420px] overflow-y-auto">
                <div className="p-3 rounded bg-slate-950 border border-slate-800 space-y-1 text-slate-300">
                  <div>
                    <span className="text-slate-500">Workflow:</span> {activeLogModal.workflowName} ({activeLogModal.version})
                  </div>
                  <div>
                    <span className="text-slate-500">Trigger:</span> {activeLogModal.triggerDetail}
                  </div>
                  <div>
                    <span className="text-slate-500">Duration:</span> {activeLogModal.durationMs}ms
                  </div>
                  {activeLogModal.error && (
                    <div className="text-rose-400 font-semibold pt-1 border-t border-slate-800/80">
                      Error: {activeLogModal.error}
                    </div>
                  )}
                </div>

                <div className="space-y-2 pt-2">
                  <div className="text-[11px] font-sans font-semibold text-slate-400 uppercase tracking-wider">Trace Events</div>

                  <div className="space-y-1.5 text-[11px]">
                    <div className="p-2 rounded bg-slate-950/80 border border-slate-800/60 flex items-start gap-2">
                      <span className="text-slate-500 shrink-0">10:42:15.001</span>
                      <span className="text-blue-400 font-semibold shrink-0">[INFO]</span>
                      <span className="text-slate-200">Trigger received. Ingestion pipeline initiated.</span>
                    </div>

                    <div className="p-2 rounded bg-slate-950/80 border border-slate-800/60 flex items-start gap-2">
                      <span className="text-slate-500 shrink-0">10:42:15.120</span>
                      <span className="text-emerald-400 font-semibold shrink-0">[SUCCESS]</span>
                      <span className="text-slate-200">Step 1 (Webhook) completed with status 200 OK.</span>
                    </div>

                    <div className="p-2 rounded bg-slate-950/80 border border-slate-800/60 flex items-start gap-2">
                      <span className="text-slate-500 shrink-0">10:42:15.165</span>
                      <span className="text-emerald-400 font-semibold shrink-0">[SUCCESS]</span>
                      <span className="text-slate-200">Step 2 (PostgreSQL) retrieved 14 rows in 45ms.</span>
                    </div>

                    {activeLogModal.status === 'FAILED' ? (
                      <div className="p-2 rounded bg-rose-950/40 border border-rose-900/60 flex items-start gap-2 text-rose-300">
                        <span className="text-slate-500 shrink-0">10:42:18.100</span>
                        <span className="text-rose-400 font-semibold shrink-0">[ERROR]</span>
                        <span>Step 3 failed: {activeLogModal.error}. Stack trace at S3Client.connect (node:net:312).</span>
                      </div>
                    ) : (
                      <div className="p-2 rounded bg-slate-950/80 border border-slate-800/60 flex items-start gap-2">
                        <span className="text-slate-500 shrink-0">10:42:16.400</span>
                        <span className="text-emerald-400 font-semibold shrink-0">[SUCCESS]</span>
                        <span className="text-slate-200">Step 3 (AI Extract) structured payload successfully.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-4 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
                <button
                  onClick={() => {
                    setActiveLogModal(null);
                    navigate(`/executions/${activeLogModal.id.replace('#', '')}`);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#2563EB] text-white font-sans text-xs font-semibold hover:bg-blue-600 transition-colors"
                >
                  <span>Open Full Execution Detail</span>
                  <ExternalLink size={13} />
                </button>
                <button
                  onClick={() => setActiveLogModal(null)}
                  className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 font-sans text-xs hover:bg-slate-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
