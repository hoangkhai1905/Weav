import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  Database,
  MessageSquare,
  Sparkles,
  Cloud,
  Webhook as WebhookIcon,
  Code2,
  Layers,
  FileCheck,
  Download,
  Key,
  Zap,
  Activity,
  ArrowUp,
  ArrowDown,
  X,
  Globe,
} from 'lucide-react';

export interface ConnectionRecord {
  id: string;
  name: string;
  service: 'PostgreSQL' | 'Slack' | 'OpenAI' | 'Google BigQuery' | 'Webhook' | 'GitHub' | 'Redis Cache' | 'AWS S3';
  driverInfo: string;
  status: 'connected' | 'checking' | 'degraded' | 'failed';
  statusDetail?: string;
  workflowsCount: number;
  lastTested: string;
  latencyMs: number | string;
  environment: 'Production' | 'Staging' | 'Preview Dev';
  category: 'Databases & Caches' | 'AI & Inference' | 'Messaging & Events' | 'Code & CI/CD' | 'Object Storage';
}

const INITIAL_CONNECTIONS_LIST: ConnectionRecord[] = [
  {
    id: 'conn-pg-primary',
    name: 'Production Database',
    service: 'PostgreSQL',
    driverInfo: 'v15.4 • TLS v1.3',
    status: 'connected',
    workflowsCount: 8,
    lastTested: '2 min ago',
    latencyMs: 18,
    environment: 'Production',
    category: 'Databases & Caches',
  },
  {
    id: 'conn-slack-ops',
    name: 'Workspace Notifications',
    service: 'Slack',
    driverInfo: 'Bot Token API',
    status: 'connected',
    workflowsCount: 12,
    lastTested: '18 min ago',
    latencyMs: 65,
    environment: 'Production',
    category: 'Messaging & Events',
  },
  {
    id: 'conn-oai-prod',
    name: 'AI Processing Engine',
    service: 'OpenAI',
    driverInfo: 'GPT-4o & Embeddings',
    status: 'connected',
    workflowsCount: 15,
    lastTested: '5 min ago',
    latencyMs: 180,
    environment: 'Production',
    category: 'AI & Inference',
  },
  {
    id: 'conn-bq-dw',
    name: 'Analytics Warehouse',
    service: 'Google BigQuery',
    driverInfo: 'GCP Service Account',
    status: 'connected',
    workflowsCount: 4,
    lastTested: '1 hour ago',
    latencyMs: 110,
    environment: 'Production',
    category: 'Databases & Caches',
  },
  {
    id: 'conn-wh-stripe',
    name: 'Stripe Ingestion Endpoint',
    service: 'Webhook',
    driverInfo: 'HMAC-SHA256 Signed',
    status: 'connected',
    workflowsCount: 6,
    lastTested: 'Today',
    latencyMs: 12,
    environment: 'Production',
    category: 'Messaging & Events',
  },
  {
    id: 'conn-gh-actions',
    name: 'CI/CD Integration & PR Hooks',
    service: 'GitHub',
    driverInfo: 'GitHub App ID #9204',
    status: 'degraded',
    statusDetail: 'OAuth token refresh needed',
    workflowsCount: 3,
    lastTested: '24 min ago',
    latencyMs: 'Auth Fail',
    environment: 'Production',
    category: 'Code & CI/CD',
  },
  {
    id: 'conn-redis-cluster',
    name: 'Real-time State & Rate Limiter',
    service: 'Redis Cache',
    driverInfo: 'Cluster v7.2',
    status: 'connected',
    workflowsCount: 9,
    lastTested: '4 min ago',
    latencyMs: 2,
    environment: 'Production',
    category: 'Databases & Caches',
  },
  {
    id: 'conn-s3-artifacts',
    name: 'Data Backup & Artifact Store',
    service: 'AWS S3',
    driverInfo: 'IAM Role ARN',
    status: 'degraded',
    statusDetail: 'Latency spike 840ms',
    workflowsCount: 5,
    lastTested: '12 min ago',
    latencyMs: 840,
    environment: 'Production',
    category: 'Object Storage',
  },
];

export function ConnectionsPage() {
  const [connections, setConnections] = useState<ConnectionRecord[]>(INITIAL_CONNECTIONS_LIST);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'HEALTHY' | 'DEGRADED' | 'FAILED'>('ALL');
  const [serviceCategoryFilter, setServiceCategoryFilter] = useState('ALL');
  const [envFilter, setEnvFilter] = useState('Production');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [testingRowId, setTestingRowId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // New Connection Form state
  const [newConnName, setNewConnName] = useState('');
  const [newConnService, setNewConnService] = useState<ConnectionRecord['service']>('PostgreSQL');
  const [newConnSecret, setNewConnSecret] = useState('');

  // Toast feedback helper
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // In-place row test connection animation
  const handleTestSingleRow = (id: string) => {
    setTestingRowId(id);
    setTimeout(() => {
      setConnections((prev) =>
        prev.map((item) => {
          if (item.id === id) {
            return {
              ...item,
              status: item.status === 'failed' ? 'connected' : item.status,
              statusDetail: item.status === 'degraded' ? undefined : item.statusDetail,
              lastTested: 'Just now',
              latencyMs: typeof item.latencyMs === 'number' ? Math.max(8, Math.round(item.latencyMs * 0.9)) : 42,
            };
          }
          return item;
        })
      );
      setTestingRowId(null);
      triggerToast(`Connection ${id} test passed (HTTP 200 OK)`);
    }, 220);
  };

  // Test all connections sequentially
  const handleTestAll = () => {
    triggerToast('Initiating health audit across all service connections...');
    setConnections((prev) =>
      prev.map((conn) => ({ ...conn, status: 'checking' }))
    );

    setTimeout(() => {
      setConnections((prev) =>
        prev.map((conn) => ({
          ...conn,
          status: conn.id === 'conn-gh-actions' ? 'degraded' : 'connected',
          lastTested: 'Just now',
        }))
      );
      triggerToast('All 18 service connections verified.');
    }, 600);
  };

  // Sync cluster gateway
  const handleSyncCluster = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      triggerToast('Cluster gateway synced with production endpoints.');
    }, 800);
  };

  // Add new connection
  const handleCreateConnection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConnName.trim()) return;

    const newId = `conn-${newConnService.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}`;
    const categoryMap: Record<ConnectionRecord['service'], ConnectionRecord['category']> = {
      PostgreSQL: 'Databases & Caches',
      Slack: 'Messaging & Events',
      OpenAI: 'AI & Inference',
      'Google BigQuery': 'Databases & Caches',
      Webhook: 'Messaging & Events',
      GitHub: 'Code & CI/CD',
      'Redis Cache': 'Databases & Caches',
      'AWS S3': 'Object Storage',
    };

    const newConn: ConnectionRecord = {
      id: newId,
      name: newConnName,
      service: newConnService,
      driverInfo: `${newConnService} API Key • Verified`,
      status: 'connected',
      workflowsCount: 0,
      lastTested: 'Just now',
      latencyMs: 38,
      environment: 'Production',
      category: categoryMap[newConnService] || 'Databases & Caches',
    };

    setConnections((prev) => [newConn, ...prev]);
    setIsAddModalOpen(false);
    setNewConnName('');
    setNewConnSecret('');
    triggerToast(`Added new connection: ${newConnName}`);
  };

  // Delete connection
  const handleDeleteRow = (id: string) => {
    setConnections((prev) => prev.filter((item) => item.id !== id));
    triggerToast(`Deleted connection ${id}`);
  };

  // Service brand icon helper
  const renderServiceIcon = (service: ConnectionRecord['service']) => {
    switch (service) {
      case 'PostgreSQL':
        return <Database className="text-blue-500" size={18} />;
      case 'Slack':
        return <MessageSquare className="text-amber-500" size={18} />;
      case 'OpenAI':
        return <Sparkles className="text-[#2563EB]" size={18} />;
      case 'Google BigQuery':
        return <Globe className="text-[#2563EB]" size={18} />;
      case 'Webhook':
        return <WebhookIcon className="text-emerald-500" size={18} />;
      case 'GitHub':
        return <Code2 className="text-slate-900 dark:text-slate-100" size={18} />;
      case 'Redis Cache':
        return <Activity className="text-rose-500" size={18} />;
      case 'AWS S3':
        return <Cloud className="text-amber-500" size={18} />;
    }
  };

  // Filtering
  const filteredConnections = useMemo(() => {
    return connections.filter((item) => {
      // Status filter
      if (statusFilter === 'HEALTHY' && item.status !== 'connected') return false;
      if (statusFilter === 'DEGRADED' && item.status !== 'degraded') return false;
      if (statusFilter === 'FAILED' && item.status !== 'failed') return false;

      // Category filter
      if (serviceCategoryFilter !== 'ALL' && item.category !== serviceCategoryFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesId = item.id.toLowerCase().includes(q);
        const matchesService = item.service.toLowerCase().includes(q);
        if (!matchesName && !matchesId && !matchesService) return false;
      }

      return true;
    });
  }, [connections, statusFilter, serviceCategoryFilter, searchQuery]);

  // Status counts
  const counts = useMemo(() => {
    return {
      ALL: connections.length,
      HEALTHY: connections.filter((c) => c.status === 'connected').length,
      DEGRADED: connections.filter((c) => c.status === 'degraded').length,
      FAILED: connections.filter((c) => c.status === 'failed').length,
    };
  }, [connections]);

  const isAllSelected = filteredConnections.length > 0 && selectedIds.size === filteredConnections.length;
  const toggleSelectAll = () => {
    if (isAllSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredConnections.map((c) => c.id)));
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto pb-12 select-none">
      {/* Toast Notification */}
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

      {/* Sub-Header Telemetry Strip */}
      <div className="px-4 py-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <span>Workspace</span>
          <span className="text-slate-300 dark:text-slate-700">/</span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">Connections</span>
          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
            us-east-1 / Production
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-[11px]">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>Gateway operational</span>
            <span className="text-slate-300 dark:text-slate-700">•</span>
            <span className="font-mono text-slate-400">Auto-sync: 30s</span>
          </div>

          <button
            onClick={handleSyncCluster}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-medium text-[11px] transition-colors"
          >
            <RefreshCw size={12} className={isSyncing ? 'animate-spin text-[#2563EB]' : 'text-slate-400'} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Main Header & Primary Action Buttons */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Connections</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Manage services, credentials, and API endpoints bound to active workflow graphs.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          <button
            onClick={handleTestAll}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-xs font-semibold shadow-xs"
          >
            <FileCheck size={14} className="text-slate-400" />
            <span>Test all connections</span>
          </button>

          <button
            onClick={() => triggerToast('Status report exported to JSON')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-xs font-semibold shadow-xs"
          >
            <Download size={14} className="text-slate-400" />
            <span>Export status</span>
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#2563EB] hover:bg-violet-600 text-white transition-colors text-xs font-bold shadow-xs cursor-pointer"
          >
            <Plus size={15} />
            <span>Add connection</span>
          </button>
        </div>
      </div>

      {/* 4 Telemetry Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Connections */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Connections
            </span>
            <Layers size={16} className="text-slate-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 tracking-tight">18</span>
            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono text-[10px]">
              8 types active
            </span>
          </div>
          <div className="mt-2 text-slate-500 text-xs truncate">Bound to 57 active workflows</div>
        </div>

        {/* Cluster Health */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Cluster Health
            </span>
            <CheckCircle2 size={16} className="text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 tracking-tight">16</span>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Healthy</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            <span className="font-medium text-slate-700 dark:text-slate-300">2 require attention</span>
          </div>
        </div>

        {/* Ingress / Calls (24h) */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Ingress / Calls (24h)
            </span>
            <Activity size={16} className="text-[#2563EB]" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 tracking-tight">34,820</span>
            <div className="flex items-center gap-0.5 font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
              <ArrowUp size={12} />
              <span>+8.4%</span>
            </div>
          </div>
          <div className="mt-2 text-slate-500 text-xs">99.98% execution success rate</div>
        </div>

        {/* Avg Response Latency */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Avg Response Latency
            </span>
            <Zap size={16} className="text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 tracking-tight">68ms</span>
            <div className="flex items-center gap-0.5 font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
              <ArrowDown size={12} />
              <span>-4ms</span>
            </div>
          </div>
          <div className="mt-2 text-slate-500 font-mono text-[10px]">P95: 142ms • P99: 380ms</div>
        </div>
      </div>

      {/* Filter & Controls Toolbar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
        {/* Status Filter Segmented Controls */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg gap-1 overflow-x-auto">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all ${
              statusFilter === 'ALL'
                ? 'bg-white dark:bg-slate-900 text-[#2563EB] dark:text-violet-300 font-bold shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            All ({counts.ALL})
          </button>
          <button
            onClick={() => setStatusFilter('HEALTHY')}
            className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === 'HEALTHY'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 font-bold shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>Healthy ({counts.HEALTHY})</span>
          </button>
          <button
            onClick={() => setStatusFilter('DEGRADED')}
            className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === 'DEGRADED'
                ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 font-bold shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            <span>Needs attention ({counts.DEGRADED})</span>
          </button>
        </div>

        {/* Search & Select Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Input */}
          <div className="flex items-center bg-slate-50 dark:bg-slate-800/60 rounded-lg px-3 py-1.5 border border-slate-200/80 dark:border-slate-700/60 w-64">
            <Search size={15} className="text-slate-400 mr-2 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search connections..."
              className="w-full bg-transparent text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
            />
            {searchQuery ? (
              <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            ) : (
              <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                ⌘K
              </kbd>
            )}
          </div>

          {/* Service Category Dropdown */}
          <select
            value={serviceCategoryFilter}
            onChange={(e) => setServiceCategoryFilter(e.target.value)}
            className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Services</option>
            <option value="Databases & Caches">Databases & Caches</option>
            <option value="AI & Inference">AI & Inference</option>
            <option value="Messaging & Events">Messaging & Events</option>
            <option value="Code & CI/CD">Code & CI/CD</option>
            <option value="Object Storage">Object Storage</option>
          </select>

          {/* Environment Dropdown */}
          <select
            value={envFilter}
            onChange={(e) => setEnvFilter(e.target.value as ConnectionRecord['environment'] | 'ALL')}
            className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="Production">Production (18)</option>
            <option value="Staging">Staging (11)</option>
            <option value="Preview Dev">Preview Dev</option>
          </select>
        </div>
      </div>

      {/* High-Density Connections Data Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
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
                <th className="py-2.5 px-3 font-semibold">Service / Driver</th>
                <th className="py-2.5 px-3 font-semibold">Connection & Identifier</th>
                <th className="py-2.5 px-3 font-semibold">Operational Status</th>
                <th className="py-2.5 px-3 font-semibold">Workflows</th>
                <th className="py-2.5 px-3 font-semibold">Last Tested</th>
                <th className="py-2.5 px-3 text-right font-semibold pr-6">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs text-slate-800 dark:text-slate-200">
              {filteredConnections.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Layers size={24} className="text-slate-300 dark:text-slate-600" />
                      <p className="font-medium text-xs">No service connections match your search or filters.</p>
                      <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="mt-1 px-3 py-1.5 bg-[#2563EB] text-white text-xs font-bold rounded-lg hover:bg-violet-600 transition-colors"
                      >
                        + Add new connection
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredConnections.map((conn) => {
                  const isSelected = selectedIds.has(conn.id);
                  const isTesting = testingRowId === conn.id;

                  return (
                    <tr
                      key={conn.id}
                      className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                        isSelected ? 'bg-indigo-50/30 dark:bg-violet-950/20' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(conn.id)}
                          className="w-3.5 h-3.5 rounded border-slate-300 text-[#2563EB] focus:ring-0 cursor-pointer"
                        />
                      </td>

                      {/* Service / Driver */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 border border-slate-200/60 dark:border-slate-700/60">
                            {renderServiceIcon(conn.service)}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-900 dark:text-slate-100 text-xs">{conn.service}</span>
                            <span className="text-[10px] text-slate-400 font-mono">{conn.driverInfo}</span>
                          </div>
                        </div>
                      </td>

                      {/* Connection & Identifier */}
                      <td className="py-2.5 px-3">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{conn.name}</span>
                          <span className="font-mono text-[10px] text-slate-400">{conn.id}</span>
                        </div>
                      </td>

                      {/* Operational Status */}
                      <td className="py-2.5 px-3">
                        {isTesting ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 font-mono text-[11px] font-medium border border-amber-500/20">
                            <RefreshCw size={11} className="animate-spin text-amber-500" />
                            Checking...
                          </span>
                        ) : conn.status === 'connected' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            Healthy
                          </span>
                        ) : conn.status === 'degraded' ? (
                          <div className="flex flex-col items-start gap-0.5">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 font-semibold text-[11px]">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                              Needs attention
                            </span>
                            {conn.statusDetail && (
                              <span className="text-[10px] text-rose-500 font-mono">{conn.statusDetail}</span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 font-semibold text-[11px]">
                            <XCircle size={12} />
                            Disconnected
                          </span>
                        )}
                      </td>

                      {/* Workflows Using It */}
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium text-[11px]">
                          <Layers size={12} className="text-[#2563EB]" />
                          <span>{conn.workflowsCount} workflows</span>
                        </span>
                      </td>

                      {/* Last Tested */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="text-slate-500">{conn.lastTested}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              typeof conn.latencyMs === 'number' && conn.latencyMs > 300
                                ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                                : 'bg-slate-100 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {typeof conn.latencyMs === 'number' ? `${conn.latencyMs}ms` : conn.latencyMs}
                          </span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 text-right pr-6">
                        <div className="inline-flex items-center gap-1.5">
                          {conn.status === 'degraded' && conn.service === 'GitHub' ? (
                            <button
                              onClick={() => handleTestSingleRow(conn.id)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-50 dark:bg-violet-950/60 text-[#2563EB] dark:text-violet-300 hover:bg-[#2563EB] hover:text-white font-medium text-[11px] transition-colors"
                            >
                              <Key size={12} />
                              <span>Re-authenticate</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleTestSingleRow(conn.id)}
                              disabled={isTesting}
                              className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium text-[11px] transition-colors"
                            >
                              <RefreshCw size={12} className={isTesting ? 'animate-spin text-[#2563EB]' : 'text-slate-400'} />
                              <span>Test</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleDeleteRow(conn.id)}
                            className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/60 text-slate-400 hover:text-rose-600 transition-colors"
                            title="Delete connection"
                          >
                            <Trash2 size={14} />
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
              Showing <span className="font-semibold text-slate-900 dark:text-slate-100 font-mono">1–{filteredConnections.length}</span> of{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100 font-mono">18</span> connections
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Rows:</span>
              <select className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded px-2 py-0.5 focus:outline-none cursor-pointer">
                <option>8 per page</option>
                <option>25 per page</option>
                <option>50 per page</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button disabled className="px-2.5 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-400 text-xs disabled:opacity-50">
              Previous
            </button>
            <button className="px-2.5 py-1 rounded bg-[#2563EB] text-white font-bold text-xs">1</button>
            <button className="px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs transition-colors">
              2
            </button>
            <button className="px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs transition-colors">
              3
            </button>
            <button className="px-2.5 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Add Connection Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Plus size={18} className="text-[#2563EB]" />
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">Add New Service Connection</h3>
                </div>
                <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleCreateConnection} className="p-5 space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Connection Identifier Name</label>
                  <input
                    type="text"
                    required
                    value={newConnName}
                    onChange={(e) => setNewConnName(e.target.value)}
                    placeholder="e.g. Finance Production Database"
                    className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-[#2563EB]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Service Type Driver</label>
                  <select
                    value={newConnService}
                    onChange={(e) => setNewConnService(e.target.value as ConnectionRecord['service'])}
                    className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="PostgreSQL">PostgreSQL Database</option>
                    <option value="Slack">Slack Bot API</option>
                    <option value="OpenAI">OpenAI API Key</option>
                    <option value="Google BigQuery">Google BigQuery GCP</option>
                    <option value="Webhook">Webhook HMAC Endpoint</option>
                    <option value="GitHub">GitHub App Integration</option>
                    <option value="Redis Cache">Redis Cache Cluster</option>
                    <option value="AWS S3">AWS S3 Storage Bucket</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">API Key / DSN Connection String</label>
                  <input
                    type="password"
                    required
                    value={newConnSecret}
                    onChange={(e) => setNewConnSecret(e.target.value)}
                    placeholder="e.g. postgresql://user:pass@host:5432/dbname or sk-proj-..."
                    className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-[#2563EB]"
                  />
                </div>

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-3.5 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-[#2563EB] text-white hover:bg-violet-600 transition-colors font-bold shadow-xs"
                  >
                    Save & Test Connection
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
