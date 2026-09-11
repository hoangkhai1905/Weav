import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Zap,
  RotateCcw,
  Copy,
  Check,
  Terminal,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Sparkles,
  Search,
} from 'lucide-react';

import type { ExecutionDetail, WorkflowDefinition, NodeExecutionResult } from '../types/workflow.types';
import { CustomWorkflowNode } from '../components/builder/CustomWorkflowNode';
import { useUIStore } from '../store/useUIStore';

// Rich Mock Executions Store for realistic debugging
const MOCK_EXECUTION_DATA: Record<string, { execution: ExecutionDetail; workflow: WorkflowDefinition }> = {
  'EX-8492': {
    execution: {
      id: '#EX-8492',
      workflowId: 'wf-prod-8492',
      workflowName: 'Order processing & notification',
      triggerType: 'Webhook (POST /stripe)',
      status: 'RUNNING',
      startedAt: new Date(Date.now() - 14200).toISOString(),
      durationMs: 14200,
      nodeResults: {
        'node-1': {
          nodeId: 'node-1',
          nodeName: 'Stripe Order Webhook',
          status: 'SUCCESS',
          startedAt: '10:42:15 font-mono',
          completedAt: '10:42:15.120',
          durationMs: 120,
          retryCount: 0,
          input: { event: 'charge.succeeded', amount: 14900, currency: 'usd', customer: 'cus_N7x9a102' },
          output: { statusCode: 200, parsedOrder: { id: 'ord_99812', total: 149.0, items: 2 } },
        },
        'node-2': {
          nodeId: 'node-2',
          nodeName: 'PostgreSQL Store Order',
          status: 'SUCCESS',
          startedAt: '10:42:15.125',
          completedAt: '10:42:15.170',
          durationMs: 45,
          retryCount: 0,
          input: { orderId: 'ord_99812', table: 'customer_orders', status: 'PAID' },
          output: { insertedId: 'db_rec_884912', rowsAffected: 1 },
        },
        'node-3': {
          nodeId: 'node-3',
          nodeName: 'AI Extract & Profile Customer',
          status: 'RUNNING',
          startedAt: '10:42:15.175',
          durationMs: 14000,
          retryCount: 0,
          input: { text: 'Customer requested fast delivery and invoice copy for corporate tax filing.' },
          output: { progress: 'processing chunk 2 of 3...', sentiment: 'Positive' },
        },
        'node-4': {
          nodeId: 'node-4',
          nodeName: 'Slack Team Notification',
          status: 'PENDING',
          startedAt: '10:42:29',
          durationMs: 0,
          retryCount: 0,
          input: { channel: '#orders-feed', template: 'new_order_alert' },
          output: null,
        },
      },
      logs: [
        { id: 'l1', timestamp: '10:42:15.001', level: 'INFO', message: 'Webhook endpoint POST /stripe called by Stripe IP 54.187.205.1' },
        { id: 'l2', timestamp: '10:42:15.120', level: 'SUCCESS', message: 'Step 1 (Stripe Order Webhook) validated signature & parsed payload.' },
        { id: 'l3', timestamp: '10:42:15.170', level: 'SUCCESS', message: 'Step 2 (PostgreSQL Store Order) inserted record db_rec_884912.' },
        { id: 'l4', timestamp: '10:42:15.175', level: 'INFO', message: 'Step 3 (AI Extract & Profile Customer) calling OpenAI gpt-4o API...' },
        { id: 'l5', timestamp: '10:42:25.400', level: 'INFO', message: 'Step 3 streaming response chunk 2/3 (elapsed 10.2s).' },
      ],
    },
    workflow: {
      id: 'wf-prod-8492',
      name: 'Order processing & notification',
      status: 'PUBLISHED',
      version: 1,
      triggerType: 'trigger.webhook',
      createdAt: '2026-08-20T00:00:00Z',
      updatedAt: '2026-08-27T00:00:00Z',
      ownerName: 'Nguyễn Anh Xuân Trường',
      workspaceId: 'ws-main',
      nodes: [
        { id: 'node-1', type: 'trigger.webhook', name: 'Stripe Order Webhook', config: { method: 'POST', path: '/stripe' }, position: { x: 50, y: 180 } },
        { id: 'node-2', type: 'sheets.append', name: 'PostgreSQL Store Order', config: { table: 'orders' }, position: { x: 380, y: 180 } },
        { id: 'node-3', type: 'ai.extract', name: 'AI Extract & Profile Customer', config: { model: 'gpt-4o' }, position: { x: 710, y: 180 } },
        { id: 'node-4', type: 'email.send', name: 'Slack Team Notification', config: { channel: '#orders-feed' }, position: { x: 1040, y: 180 } },
      ],
      edges: [
        { id: 'e1-2', source: 'node-1', target: 'node-2' },
        { id: 'e2-3', source: 'node-2', target: 'node-3' },
        { id: 'e3-4', source: 'node-3', target: 'node-4' },
      ],
    },
  },
  'EX-8490': {
    execution: {
      id: '#EX-8490',
      workflowId: 'wf-prod-8490',
      workflowName: 'Daily S3 Backup & Checksum Audit',
      triggerType: 'Schedule (Cron 0 9 * * *)',
      status: 'FAILED',
      startedAt: '2026-09-04T09:30:00Z',
      completedAt: '2026-09-04T09:30:08.100Z',
      durationMs: 8100,
      nodeResults: {
        'n-1': {
          nodeId: 'n-1',
          nodeName: 'Cron 9 AM Trigger',
          status: 'SUCCESS',
          startedAt: '09:30:00.000',
          completedAt: '09:30:00.100',
          durationMs: 100,
          retryCount: 0,
          input: { schedule: '0 9 * * *', timezone: 'UTC' },
          output: { triggered: true, timestamp: '2026-09-04T09:30:00Z' },
        },
        'n-2': {
          nodeId: 'n-2',
          nodeName: 'Fetch Production PostgreSQL Export',
          status: 'SUCCESS',
          startedAt: '09:30:00.110',
          completedAt: '09:30:03.200',
          durationMs: 3090,
          retryCount: 0,
          input: { dbHost: 'prod-db.weav.internal', dbName: 'weav_prod_db' },
          output: { archivePath: '/tmp/db_dump_20260904.sql.gz', sizeBytes: 14829100 },
        },
        'n-3': {
          nodeId: 'n-3',
          nodeName: 'AWS S3 Bucket Dump Upload',
          status: 'FAILED',
          startedAt: '09:30:03.210',
          completedAt: '09:30:08.100',
          durationMs: 4890,
          retryCount: 3,
          input: { bucket: 'weav-backups-prod', key: 'daily/20260904.sql.gz', region: 'us-east-1' },
          output: null,
          error: 'S3 ETIMEDOUT (host s3.us-east-1.amazonaws.com unreachable after 3 retries)',
        },
        'n-4': {
          nodeId: 'n-4',
          nodeName: 'SHA-256 Checksum Audit',
          status: 'PENDING',
          startedAt: '09:30:08',
          durationMs: 0,
          retryCount: 0,
          input: {},
          output: null,
        },
        'n-5': {
          nodeId: 'n-5',
          nodeName: 'Slack DevOps Alert',
          status: 'PENDING',
          startedAt: '09:30:08',
          durationMs: 0,
          retryCount: 0,
          input: {},
          output: null,
        },
      },
      logs: [
        { id: 'l101', timestamp: '09:30:00.000', level: 'INFO', message: 'Cron trigger fired on schedule 0 9 * * *.' },
        { id: 'l102', timestamp: '09:30:03.200', level: 'SUCCESS', message: 'Database dump generated successfully (14.1 MB).' },
        { id: 'l103', timestamp: '09:30:04.800', level: 'WARN', message: 'S3 upload attempt 1 failed: Connection timeout. Retrying in 1s...' },
        { id: 'l104', timestamp: '09:30:06.400', level: 'WARN', message: 'S3 upload attempt 2 failed: Connection timeout. Retrying in 2s...' },
        { id: 'l105', timestamp: '09:30:08.100', level: 'ERROR', message: 'S3 upload attempt 3 failed: ETIMEDOUT (host s3.us-east-1.amazonaws.com unreachable). Execution halted.' },
      ],
    },
    workflow: {
      id: 'wf-prod-8490',
      name: 'Daily S3 Backup & Checksum Audit',
      status: 'PUBLISHED',
      version: 3,
      triggerType: 'trigger.schedule',
      createdAt: '2026-08-15T00:00:00Z',
      updatedAt: '2026-08-30T00:00:00Z',
      ownerName: 'Nguyễn Anh Xuân Trường',
      workspaceId: 'ws-main',
      nodes: [
        { id: 'n-1', type: 'trigger.schedule', name: 'Cron 9 AM Trigger', config: { cron: '0 9 * * *' }, position: { x: 50, y: 180 } },
        { id: 'n-2', type: 'http.request', name: 'Fetch PostgreSQL Dump', config: { host: 'prod-db' }, position: { x: 380, y: 180 } },
        { id: 'n-3', type: 'sheets.append', name: 'AWS S3 Bucket Dump Upload', config: { bucket: 'weav-backups' }, position: { x: 710, y: 180 } },
        { id: 'n-4', type: 'ai.classify', name: 'SHA-256 Checksum Audit', config: { algo: 'sha256' }, position: { x: 1040, y: 120 } },
        { id: 'n-5', type: 'email.send', name: 'Slack DevOps Alert', config: { channel: '#devops' }, position: { x: 1040, y: 260 } },
      ],
      edges: [
        { id: 'e1-2', source: 'n-1', target: 'n-2' },
        { id: 'e2-3', source: 'n-2', target: 'n-3' },
        { id: 'e3-4', source: 'n-3', target: 'n-4' },
        { id: 'e3-5', source: 'n-3', target: 'n-5' },
      ],
    },
  },
  'EX-8491': {
    execution: {
      id: '#EX-8491',
      workflowId: 'wf-prod-8491',
      workflowName: 'Customer onboarding & enrichment',
      triggerType: 'Schedule (Daily)',
      status: 'SUCCESS',
      startedAt: new Date(Date.now() - 420000).toISOString(),
      completedAt: new Date(Date.now() - 415800).toISOString(),
      durationMs: 4200,
      nodeResults: {
        'n1': { nodeId: 'n1', nodeName: 'Daily Customer Sync Trigger', status: 'SUCCESS', startedAt: '10:35:02', durationMs: 80, retryCount: 0, input: {}, output: { totalNewUsers: 14 } },
        'n2': { nodeId: 'n2', nodeName: 'Clearbit CRM Enrichment', status: 'SUCCESS', startedAt: '10:35:02.100', durationMs: 1400, retryCount: 0, input: { batchSize: 14 }, output: { enrichedCount: 14, matchRate: '100%' } },
        'n3': { nodeId: 'n3', nodeName: 'AI Lead Scoring Engine', status: 'SUCCESS', startedAt: '10:35:03.500', durationMs: 1800, retryCount: 0, input: { model: 'lead-scorer-v2' }, output: { avgScore: 84.2, highValueLeads: 3 } },
        'n4': { nodeId: 'n4', nodeName: 'PostgreSQL User Record Update', status: 'SUCCESS', startedAt: '10:35:05.300', durationMs: 520, retryCount: 0, input: { table: 'users' }, output: { updatedRows: 14 } },
        'n5': { nodeId: 'n5', nodeName: 'HubSpot Sync Dispatcher', status: 'SUCCESS', startedAt: '10:35:05.820', durationMs: 400, retryCount: 0, input: { crm: 'HubSpot' }, output: { syncedLeads: 3 } },
      },
      logs: [
        { id: 'l1', timestamp: '10:35:02.000', level: 'INFO', message: 'Daily customer onboarding batch starting.' },
        { id: 'l2', timestamp: '10:35:03.500', level: 'SUCCESS', message: 'Clearbit API enriched 14 customer profiles.' },
        { id: 'l3', timestamp: '10:35:05.300', level: 'SUCCESS', message: 'AI Lead Scoring identified 3 high-value enterprise prospects.' },
        { id: 'l4', timestamp: '10:35:06.200', level: 'SUCCESS', message: 'Execution EX-8491 completed in 4.2s.' },
      ],
    },
    workflow: {
      id: 'wf-prod-8491',
      name: 'Customer onboarding & enrichment',
      status: 'PUBLISHED',
      version: 2,
      triggerType: 'trigger.schedule',
      createdAt: '2026-08-10T00:00:00Z',
      updatedAt: '2026-08-25T00:00:00Z',
      ownerName: 'Nguyễn Anh Xuân Trường',
      workspaceId: 'ws-main',
      nodes: [
        { id: 'n1', type: 'trigger.schedule', name: 'Daily Customer Sync Trigger', config: {}, position: { x: 50, y: 180 } },
        { id: 'n2', type: 'http.request', name: 'Clearbit CRM Enrichment', config: {}, position: { x: 380, y: 180 } },
        { id: 'n3', type: 'ai.classify', name: 'AI Lead Scoring Engine', config: {}, position: { x: 710, y: 180 } },
        { id: 'n4', type: 'sheets.append', name: 'PostgreSQL User Record Update', config: {}, position: { x: 1040, y: 120 } },
        { id: 'n5', type: 'email.send', name: 'HubSpot Sync Dispatcher', config: {}, position: { x: 1040, y: 260 } },
      ],
      edges: [
        { id: 'e1-2', source: 'n1', target: 'n2' },
        { id: 'e2-3', source: 'n2', target: 'n3' },
        { id: 'e3-4', source: 'n3', target: 'n4' },
        { id: 'e3-5', source: 'n3', target: 'n5' },
      ],
    },
  },
};

export function ExecutionDetailPage() {
  const { executionId } = useParams<{ executionId: string }>();
  const navigate = useNavigate();
  const { theme } = useUIStore();

  const [execution, setExecution] = useState<ExecutionDetail | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'DETAILS' | 'LOGS' | 'PAYLOAD'>('DETAILS');
  const [isConsoleOpen, setIsConsoleOpen] = useState(true);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  // Signature packet animation state
  const [packetProgress, setPacketProgress] = useState(0);
  const [isPlayingAnimation, setIsPlayingAnimation] = useState(false);

  const nodeTypes = useMemo(() => ({ customNode: CustomWorkflowNode }), []);

  // Load execution details
  useEffect(() => {
    queueMicrotask(() => {
      const cleanId = executionId ? executionId.replace(/^#?/, '') : 'EX-8492';
      const formattedId = `#${cleanId}`;

      if (MOCK_EXECUTION_DATA[cleanId]) {
        setExecution(MOCK_EXECUTION_DATA[cleanId].execution);
        setWorkflow(MOCK_EXECUTION_DATA[cleanId].workflow);
      } else if (MOCK_EXECUTION_DATA['EX-8492']) {
        // Fallback synthesizer for any random ID
        const fallback = MOCK_EXECUTION_DATA['EX-8492'];
        setExecution({ ...fallback.execution, id: formattedId });
        setWorkflow(fallback.workflow);
      }
    });
  }, [executionId]);

  // Auto-select failed node or active running node when execution is loaded
  useEffect(() => {
    if (!execution) return;
    queueMicrotask(() => {
      const failedEntry = Object.entries(execution.nodeResults).find(([, res]) => res.status === 'FAILED');
      if (failedEntry) {
        setSelectedNodeId(failedEntry[0]);
        return;
      }
      const runningEntry = Object.entries(execution.nodeResults).find(([, res]) => res.status === 'RUNNING');
      if (runningEntry) {
        setSelectedNodeId(runningEntry[0]);
        return;
      }
      // Default to first node
      const firstNode = Object.keys(execution.nodeResults)[0];
      if (firstNode) setSelectedNodeId(firstNode);
    });
  }, [execution]);

  // Toast feedback helper
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopySuccess(label);
    triggerToast(`Copied ${label} to clipboard`);
    setTimeout(() => setCopySuccess(null), 2000);
  };

  // ReactFlow Nodes & Edges Mapper with execution status badges & packet animation
  const { nodes, edges } = useMemo(() => {
    if (!workflow || !execution) return { nodes: [], edges: [] };

    const rfNodes = workflow.nodes.map((node) => {
      const result = execution.nodeResults[node.id];
      const status = result
        ? result.status === 'SUCCESS'
          ? 'success'
          : result.status === 'FAILED'
          ? 'error'
          : result.status === 'RUNNING'
          ? 'processing'
          : 'idle'
        : 'idle';

      const executionTime = result ? (result.durationMs ? `${result.durationMs}ms` : result.status) : '';

      return {
        id: node.id,
        type: 'customNode',
        position: node.position || { x: 100, y: 180 },
        data: {
          id: node.id,
          name: node.name,
          nodeType: node.type,
          config: node.config,
          status,
          executionTime,
          selected: selectedNodeId === node.id,
        },
      };
    });

    const rfEdges = workflow.edges.map((edge) => {
      const sourceResult = execution.nodeResults[edge.source];
      const targetResult = execution.nodeResults[edge.target];

      const isExecutedEdge =
        sourceResult &&
        (sourceResult.status === 'SUCCESS' || sourceResult.status === 'RUNNING') &&
        targetResult &&
        targetResult.status !== 'PENDING';

      const isFailedEdge = sourceResult?.status === 'SUCCESS' && targetResult?.status === 'FAILED';

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: isExecutedEdge && !isFailedEdge,
        style: {
          stroke: isFailedEdge
            ? '#f43f5e'
            : isExecutedEdge
            ? '#2563EB'
            : theme === 'dark'
            ? '#475569'
            : '#cbd5e1',
          strokeWidth: isExecutedEdge || isFailedEdge ? 2.5 : 1.5,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isFailedEdge
            ? '#f43f5e'
            : isExecutedEdge
            ? '#2563EB'
            : theme === 'dark'
            ? '#475569'
            : '#cbd5e1',
        },
      };
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [workflow, execution, selectedNodeId, theme]);

  // Trigger Signature Data Flow Packet Animation
  const startPacketAnimation = useCallback(() => {
    // Check prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPacketProgress(100);
      setIsPlayingAnimation(false);
      return;
    }

    setIsPlayingAnimation(true);
    setPacketProgress(0);

    const interval = setInterval(() => {
      setPacketProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsPlayingAnimation(false);
          return 100;
        }
        return prev + 5;
      });
    }, 40);
  }, []);

  // Run signature packet animation ONCE on page mount
  useEffect(() => {
    if (execution) {
      queueMicrotask(() => {
        startPacketAnimation();
      });
    }
  }, [execution, startPacketAnimation]);

  if (!execution || !workflow) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-3 text-slate-500">
        <RefreshCw size={24} className="animate-spin text-[#2563EB]" />
        <span className="font-mono text-xs">Loading execution telemetry & graph AST...</span>
      </div>
    );
  }

  const selectedNodeResult: NodeExecutionResult | null = selectedNodeId
    ? execution.nodeResults[selectedNodeId] || null
    : null;

  const selectedNodeDef = selectedNodeId
    ? workflow.nodes.find((n) => n.id === selectedNodeId) || null
    : null;

  const filteredLogs = execution.logs.filter((log) => {
    if (!logSearchQuery.trim()) return true;
    const q = logSearchQuery.toLowerCase();
    return (
      log.message.toLowerCase().includes(q) ||
      log.timestamp.toLowerCase().includes(q) ||
      log.level.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] -m-6 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden select-none">
      {/* Toast Notification Banner */}
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

      {/* Top Header & Execution Telemetry Ribbon */}
      <div className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between shrink-0 z-20 shadow-xs">
        {/* Left Title & Breadcrumb */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/executions')}
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Back to Executions"
          >
            <ArrowLeft size={18} />
          </button>

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">Workspace / Executions</span>
              <span className="text-slate-300 dark:text-slate-700">/</span>
              <span className="font-mono text-xs font-bold text-[#2563EB] dark:text-blue-400">{execution.id}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-bold text-slate-900 dark:text-slate-100 text-sm tracking-tight">{execution.workflowName}</h1>
              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono text-[10px]">
                v1.4
              </span>
            </div>
          </div>
        </div>

        {/* Center Execution Metrics Pill */}
        <div className="hidden lg:flex items-center gap-4 px-4 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
          {/* Status Badge */}
          <div className="flex items-center gap-1.5">
            {execution.status === 'RUNNING' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-blue-950 text-[#2563EB] dark:text-blue-300 font-semibold text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB] animate-ping"></span>
                Running
              </span>
            )}
            {execution.status === 'SUCCESS' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
                <CheckCircle2 size={13} />
                Success
              </span>
            )}
            {execution.status === 'FAILED' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400 font-semibold text-[11px]">
                <AlertTriangle size={13} />
                Failed
              </span>
            )}
          </div>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800"></div>

          {/* Started */}
          <div className="flex items-center gap-1 text-slate-500 font-mono text-[11px]">
            <Clock size={13} className="text-slate-400" />
            <span>Started {new Date(execution.startedAt).toLocaleTimeString()}</span>
          </div>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800"></div>

          {/* Duration */}
          <div className="flex items-center gap-1 font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200">
            <Zap size={13} className="text-amber-500" />
            <span>{execution.durationMs}ms</span>
          </div>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800"></div>

          {/* Trigger */}
          <div className="text-[11px] font-mono text-slate-500 truncate max-w-[180px]">{execution.triggerType}</div>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-2">
          {/* Replay Data Flow Animation */}
          <button
            onClick={startPacketAnimation}
            disabled={isPlayingAnimation}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-blue-950/60 text-[#2563EB] dark:text-blue-300 hover:bg-[#2563EB] hover:text-white transition-all text-xs font-medium border border-indigo-200 dark:border-blue-800/60 shadow-xs"
          >
            <Sparkles size={13} className={isPlayingAnimation ? 'animate-spin' : ''} />
            <span>{isPlayingAnimation ? 'Simulating flow...' : 'Replay Data Flow'}</span>
          </button>

          {/* Copy Execution ID */}
          <button
            onClick={() => copyToClipboard(execution.id, 'Execution ID')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-xs font-medium"
          >
            {copySuccess === 'Execution ID' ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
            <span>Copy ID</span>
          </button>

          {/* Re-run / Retry Button */}
          <button
            onClick={() => triggerToast(`Re-running execution ${execution.id}...`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563EB] hover:bg-blue-600 text-white transition-colors text-xs font-semibold shadow-xs"
          >
            <RotateCcw size={13} />
            <span>Re-run</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Left Graph Canvas + Right Step Inspector Drawer */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Canvas Pane */}
        <div className="flex-1 h-full bg-slate-100 dark:bg-slate-950 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            nodeTypes={nodeTypes}
            fitView
            colorMode={theme}
            nodesDraggable={false}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color={theme === 'dark' ? '#334155' : '#cbd5e1'} />
            <Controls className="!bg-white dark:!bg-slate-900 !border-slate-200 dark:!border-slate-800 !text-slate-700 dark:!text-slate-300" />
          </ReactFlow>

          {/* Signature Data Flow Packet Particle Overlay */}
          {isPlayingAnimation && (
            <div className="absolute top-4 left-6 z-10 bg-slate-900/90 text-white text-[11px] px-3 py-1.5 rounded-full border border-slate-800 flex items-center gap-2 backdrop-blur-md shadow-lg">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2563EB] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2563EB]"></span>
              </span>
              <span className="font-mono">Tracing executed data path: {packetProgress}%</span>
            </div>
          )}

          {/* Floating Canvas Legend */}
          <div className="absolute bottom-4 left-4 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4 text-[11px] font-medium text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span>Completed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB] animate-pulse"></span>
              <span>Processing</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
              <span>Failed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
              <span>Skipped</span>
            </div>
          </div>
        </div>

        {/* Right Inspector Drawer (Width ~380px) */}
        <div className="w-[380px] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col z-10 shadow-lg">
          {/* Inspector Segmented Tabs */}
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center gap-1">
            <button
              onClick={() => setInspectorTab('DETAILS')}
              className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${
                inspectorTab === 'DETAILS'
                  ? 'bg-white dark:bg-slate-900 text-[#2563EB] dark:text-blue-300 shadow-xs border border-slate-200 dark:border-slate-800'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Step Inspector
            </button>
            <button
              onClick={() => setInspectorTab('LOGS')}
              className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${
                inspectorTab === 'LOGS'
                  ? 'bg-white dark:bg-slate-900 text-[#2563EB] dark:text-blue-300 shadow-xs border border-slate-200 dark:border-slate-800'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Logs ({execution.logs.length})
            </button>
            <button
              onClick={() => setInspectorTab('PAYLOAD')}
              className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${
                inspectorTab === 'PAYLOAD'
                  ? 'bg-white dark:bg-slate-900 text-[#2563EB] dark:text-blue-300 shadow-xs border border-slate-200 dark:border-slate-800'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Raw Payload
            </button>
          </div>

          {/* Inspector Content Body */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {inspectorTab === 'DETAILS' && (
              <>
                {selectedNodeResult && selectedNodeDef ? (
                  <div className="space-y-4">
                    {/* Node Overview Card */}
                    <div className="p-3.5 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs text-slate-900 dark:text-slate-100">{selectedNodeResult.nodeName}</span>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded-full border ${
                            selectedNodeResult.status === 'SUCCESS'
                              ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                              : selectedNodeResult.status === 'FAILED'
                              ? 'bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400 border-rose-500/20'
                              : selectedNodeResult.status === 'RUNNING'
                              ? 'bg-indigo-50 dark:bg-blue-950 text-[#2563EB] dark:text-blue-300 border-indigo-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}
                        >
                          {selectedNodeResult.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800 text-[11px] font-mono">
                        <div>
                          <span className="text-slate-400 text-[10px]">Step ID:</span>
                          <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedNodeResult.nodeId}</div>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px]">Duration:</span>
                          <div className="font-semibold text-[#2563EB] dark:text-blue-400">
                            {selectedNodeResult.durationMs ? `${selectedNodeResult.durationMs}ms` : '—'}
                          </div>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px]">Started At:</span>
                          <div className="text-slate-700 dark:text-slate-300">{selectedNodeResult.startedAt || '10:42:15'}</div>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px]">Retry Count:</span>
                          <div className="text-slate-700 dark:text-slate-300">{selectedNodeResult.retryCount || 0} of 3</div>
                        </div>
                      </div>
                    </div>

                    {/* Error Highlight Box if FAILED */}
                    {selectedNodeResult.error && (
                      <div className="p-3.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/60 rounded-xl space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-400">
                          <AlertTriangle size={14} />
                          <span>Step Execution Failure Trace</span>
                        </div>
                        <p className="font-mono text-[11px] text-rose-700 dark:text-rose-300 leading-relaxed">
                          {selectedNodeResult.error}
                        </p>
                        <div className="pt-2 text-[10px] font-mono text-slate-500 border-t border-rose-200 dark:border-rose-900/40">
                          Error Code: <span className="font-bold text-rose-500">ETIMEDOUT</span> • Host: s3.us-east-1.amazonaws.com
                        </div>
                      </div>
                    )}

                    {/* Input Payload Block */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          Input Payload
                        </span>
                        <button
                          onClick={() => copyToClipboard(JSON.stringify(selectedNodeResult.input, null, 2), 'Input Payload')}
                          className="text-[10px] text-[#2563EB] hover:underline font-mono"
                        >
                          Copy Input
                        </button>
                      </div>
                      <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl text-[10px] font-mono overflow-x-auto border border-slate-800 max-h-48 leading-tight">
                        {JSON.stringify(selectedNodeResult.input || {}, null, 2)}
                      </pre>
                    </div>

                    {/* Output Payload Block */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          Output Payload
                        </span>
                        <button
                          onClick={() => copyToClipboard(JSON.stringify(selectedNodeResult.output, null, 2), 'Output Payload')}
                          className="text-[10px] text-[#2563EB] hover:underline font-mono"
                        >
                          Copy Output
                        </button>
                      </div>
                      <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl text-[10px] font-mono overflow-x-auto border border-slate-800 max-h-48 leading-tight">
                        {JSON.stringify(selectedNodeResult.output || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-400 text-xs italic">
                    Click any node on the workflow graph canvas to inspect its step input, output, duration, and error trace.
                  </div>
                )}
              </>
            )}

            {inspectorTab === 'LOGS' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                    Execution Telemetry Logs
                  </span>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        execution.logs.map((l) => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n'),
                        'All Logs'
                      )
                    }
                    className="text-[10px] text-[#2563EB] hover:underline font-mono"
                  >
                    Copy All Logs
                  </button>
                </div>

                <div className="space-y-2 font-mono text-[11px]">
                  {execution.logs.map((log) => (
                    <div
                      key={log.id}
                      className="p-2.5 bg-slate-900 text-slate-100 rounded-xl border border-slate-800 space-y-1"
                    >
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500">[{log.timestamp}]</span>
                        <span
                          className={
                            log.level === 'SUCCESS'
                              ? 'text-emerald-400 font-bold'
                              : log.level === 'ERROR'
                              ? 'text-rose-400 font-bold'
                              : 'text-indigo-400'
                          }
                        >
                          {log.level}
                        </span>
                      </div>
                      <div className="text-slate-200 leading-snug">{log.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {inspectorTab === 'PAYLOAD' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                    Trigger Payload (Raw JSON)
                  </span>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(execution.nodeResults['node-1']?.input || {}, null, 2), 'Trigger JSON')}
                    className="text-[10px] text-[#2563EB] hover:underline font-mono"
                  >
                    Copy Raw JSON
                  </button>
                </div>

                <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl text-[10px] font-mono overflow-x-auto border border-slate-800 leading-tight min-h-[240px]">
                  {JSON.stringify(execution.nodeResults['node-1']?.input || { source: 'webhook', body: { event: 'trigger' } }, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Collapsible Telemetry Console Bar */}
      <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 z-20">
        <div
          onClick={() => setIsConsoleOpen(!isConsoleOpen)}
          className="px-6 py-2 bg-slate-50 dark:bg-slate-950 flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
            <Terminal size={14} className="text-[#2563EB]" />
            <span>Execution Telemetry Console</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono text-[10px]">
              {filteredLogs.length} events
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-2 py-0.5"
            >
              <Search size={12} className="text-slate-400" />
              <input
                type="text"
                value={logSearchQuery}
                onChange={(e) => setLogSearchQuery(e.target.value)}
                placeholder="Filter logs..."
                className="bg-transparent text-[11px] font-mono text-slate-800 dark:text-slate-200 focus:outline-none w-28"
              />
            </div>
            <span className="text-[10px] font-mono text-slate-400">Click to {isConsoleOpen ? 'collapse' : 'expand'}</span>
            {isConsoleOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronUp size={14} className="text-slate-400" />}
          </div>
        </div>

        {isConsoleOpen && (
          <div className="h-36 bg-slate-950 p-4 font-mono text-[11px] overflow-y-auto space-y-1.5 border-t border-slate-800">
            {filteredLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-3 hover:bg-slate-900/60 p-0.5 rounded transition-colors">
                <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
                <span
                  className={
                    log.level === 'SUCCESS'
                      ? 'text-emerald-400 font-bold shrink-0'
                      : log.level === 'ERROR'
                      ? 'text-rose-400 font-bold shrink-0'
                      : 'text-indigo-400 shrink-0'
                  }
                >
                  [{log.level}]
                </span>
                <span className="text-slate-300">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
