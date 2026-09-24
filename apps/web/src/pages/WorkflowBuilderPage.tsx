import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  ArrowLeft,
  Save,
  Play,
  Clock,
  Webhook,
  Send,
  Sparkles,
  Tags,
  Search,
  Grid,
  Map,
  Terminal,
  Loader2,
  Globe,
  GitBranch,
  Mail,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Scan,
  Upload,
  X,
  Copy,
} from 'lucide-react';
import { CustomWorkflowNode } from '../components/builder/CustomWorkflowNode';
import { ExecutionEdge } from '../components/builder/ExecutionEdge';
import { useUIStore } from '../store/useUIStore';
import { useI18nStore } from '../store/useI18nStore';
import { ocrApi, OcrApiError, type OcrExtractionResult } from '../api/ocr.api';
import { NODE_CATALOG } from '../lib/constants/nodeCatalog';
import { getNodeReadinessBadge } from '../lib/nodeReadiness';
import { workflowApi, isWorkflowMockMode } from '../api/workflow.api';
import { getActiveWorkflowWorkspaceId, type WebhookProvisioning } from '../api/workflow-v1.api';
import { workflowToReactFlow, reactFlowToWorkflow } from '../lib/mappers/workflowMapper';
import type { WorkflowDefinition } from '../types/workflow.types';

const SUPPORTED_NODE_TYPES = new Set(NODE_CATALOG.map((item) => item.type));

const PALETTE_PRESENTATION: Record<
  string,
  { nameKey?: string; descKey?: string; icon: React.ElementType }
> = {
  'trigger.manual': { nameKey: 'builder.node.manual', descKey: 'builder.node.manual_desc', icon: Play },
  'trigger.schedule': { nameKey: 'builder.node.schedule', descKey: 'builder.node.schedule_desc', icon: Clock },
  'trigger.webhook': { nameKey: 'builder.node.webhook', descKey: 'builder.node.webhook_desc', icon: Webhook },
  'trigger.telegram': { icon: Send },
  'http.request': { nameKey: 'builder.node.http', descKey: 'builder.node.http_desc', icon: Globe },
  'email.send': { nameKey: 'builder.node.email', descKey: 'builder.node.email_desc', icon: Mail },
  'google.sheets': { nameKey: 'builder.node.google_sheets', descKey: 'builder.node.google_sheets_desc', icon: FileSpreadsheet },
  'telegram.send_message': { icon: Send },
  'logic.condition': { nameKey: 'builder.node.condition', descKey: 'builder.node.condition_desc', icon: GitBranch },
  'ai.extract': { nameKey: 'builder.node.ai_extract', descKey: 'builder.node.ai_extract_desc', icon: Sparkles },
  'ai.classify': { nameKey: 'builder.node.ai_classify', descKey: 'builder.node.ai_classify_desc', icon: Tags },
  'ai.summarize': { nameKey: 'builder.node.ai_summarize', descKey: 'builder.node.ai_summarize_desc', icon: FileText },
  'ocr.extract': { nameKey: 'builder.node.ocr', descKey: 'builder.node.ocr_desc', icon: Scan },
};

const PALETTE_CATEGORY_KEYS = {
  trigger: 'builder.category.triggers',
  action: 'builder.category.integrations',
  logic: 'builder.category.logic',
  ai: 'builder.category.ai',
  ocr: 'builder.category.documents',
} as const;

const PALETTE_CATALOG = (Object.keys(PALETTE_CATEGORY_KEYS) as Array<keyof typeof PALETTE_CATEGORY_KEYS>)
  .map((category) => ({
    categoryKey: PALETTE_CATEGORY_KEYS[category],
    items: NODE_CATALOG.filter((item) => item.category === category).map((item) => ({
      ...item,
      ...PALETTE_PRESENTATION[item.type],
    })),
  }))
  .filter((category) => category.items.length > 0);

const catalogDefaultConfig = (type: string): Record<string, unknown> => ({
  ...(NODE_CATALOG.find((item) => item.type === type)?.defaultConfig ?? {}),
});

// Keep the former starter canvas only for explicit mock/demo mode. Live workflows
// always use the nodes returned by Workflow Service.
const INITIAL_NODES: Node[] = [
  { id: 'node-manual', type: 'customNode', position: { x: 80, y: 80 }, data: { id: 'manual_trigger_v1', nameKey: 'builder.node.manual', nodeType: 'trigger.manual', status: 'idle', executionTime: '', config: catalogDefaultConfig('trigger.manual') } },
  { id: 'node-webhook', type: 'customNode', position: { x: 80, y: 300 }, data: { id: 'webhook_inbound_v1', name: 'Webhook Trigger', nameKey: 'builder.node.webhook', nodeType: 'trigger.webhook', status: 'idle', executionTime: '', config: catalogDefaultConfig('trigger.webhook') } },
  { id: 'node-extract', type: 'customNode', position: { x: 420, y: 180 }, data: { id: 'extract_order_v1', name: 'AI Extract Core', nameKey: 'builder.node.ai_extract', nodeType: 'ai.extract', status: 'idle', executionTime: '', config: catalogDefaultConfig('ai.extract') } },
  { id: 'node-condition', type: 'customNode', position: { x: 760, y: 180 }, data: { id: 'condition_check_v1', name: 'High Value Check', nameKey: 'builder.node.condition', nodeType: 'logic.condition', status: 'idle', executionTime: '', config: catalogDefaultConfig('logic.condition') } },
  { id: 'node-notify', type: 'customNode', position: { x: 1100, y: 180 }, data: { id: 'notify_slack_v1', name: 'Notify Priority Queue', nameKey: 'builder.node.email', nodeType: 'email.send', status: 'idle', executionTime: '', config: catalogDefaultConfig('email.send') } },
];

const INITIAL_EDGES: Edge[] = [
  { id: 'edge-manual-extract', source: 'node-manual', target: 'node-extract', type: 'execution', animated: false, style: { stroke: '#94a3b8', strokeWidth: 1.75 } },
  { id: 'edge-1-2', source: 'node-webhook', target: 'node-extract', type: 'execution', animated: false, style: { stroke: '#94a3b8', strokeWidth: 1.75 } },
  { id: 'edge-2-3', source: 'node-extract', target: 'node-condition', type: 'execution', animated: false, style: { stroke: '#94a3b8', strokeWidth: 1.75 } },
  { id: 'edge-3-4', source: 'node-condition', sourceHandle: 'true', target: 'node-notify', type: 'execution', animated: false, style: { stroke: '#94a3b8', strokeWidth: 1.75 } },
];

const CONDITION_OPERATORS = [
  { value: 'eq', label: 'Equals' },
  { value: 'ne', label: 'Does not equal' },
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'Greater than or equal' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'Less than or equal' },
] as const;

const getNodeReadinessMessage = (type: string, config: Record<string, unknown>): string | undefined => {
  if (!SUPPORTED_NODE_TYPES.has(type)) return `Unsupported node type "${type}" is preserved from this draft.`;
  if (type === 'trigger.webhook') return 'Draft: the system-managed webhook endpoint is provisioned after publication.';
  if (type === 'google.sheets') {
    return String(config.connectionId ?? '').trim()
      ? 'Workspace must authorize this Google Sheets connection before publication.'
      : 'Not configured: select an authorized Google Sheets connection before publication.';
  }
  if (type === 'trigger.telegram') return 'Unavailable: the Bot Service trigger contract has not been approved.';
  if (type === 'telegram.send_message') return 'Unavailable: the Telegram sender contract is not implemented.';
  if (type === 'email.send') return 'Unavailable: Gmail send capability is not configured.';
  if (type.startsWith('ai.')) return 'Unavailable: the AI provider contract is not implemented.';
  if (type === 'logic.condition' && (!String(config.left ?? '').trim() || !String(config.right ?? '').trim())) {
    return 'Not configured: set both condition values before publication.';
  }
  if (type === 'trigger.schedule') {
    const fields = String(config.cron ?? '').trim().split(/\s+/);
    if (fields.length !== 6 || !String(config.timezone ?? '').trim()) {
      return 'Not configured: use a six-field cron expression and an IANA timezone.';
    }
  }
  if (type === 'http.request' && !String(config.url ?? '').trim()) return 'Not configured: enter a request URL.';
  if (type === 'ocr.extract') {
    return 'Unavailable: OCR JWT verification, URL allowlist, and artifact resolution are not verified.';
  }
  return undefined;
};

const getPublishBlockers = (nodes: Node[]): string[] => {
  const blockers = new Set<string>();
  for (const node of nodes) {
    const type = String(node.data?.nodeType ?? '');
    const config = (node.data?.config ?? {}) as Record<string, unknown>;
    if (!SUPPORTED_NODE_TYPES.has(type)) {
      blockers.add(`Unsupported node type ${type || '(missing type)'}`);
      continue;
    }
    if (type === 'logic.condition' && (!String(config.left ?? '').trim() || !String(config.right ?? '').trim())) {
      blockers.add('Condition nodes require both left and right values');
    }
    if (type === 'trigger.schedule') {
      const fields = String(config.cron ?? '').trim().split(/\s+/);
      if (fields.length !== 6 || !String(config.timezone ?? '').trim()) {
        blockers.add('Schedule nodes require six-field cron and an IANA timezone');
      }
    }
    if (type === 'http.request' && !String(config.url ?? '').trim()) {
      blockers.add('HTTP request nodes require a URL');
    }
    if (type === 'google.sheets' && !String(config.connectionId ?? '').trim()) {
      blockers.add('Google Sheets requires an authorized Workspace connection');
    }
    if (type === 'trigger.telegram' || type === 'telegram.send_message' || type === 'email.send' || type.startsWith('ai.') || type === 'ocr.extract') {
      blockers.add(getNodeReadinessMessage(type, config) ?? `${type} is not configured`);
    }
    if (type === 'ocr.extract') {
      const hasArtifactId = Boolean(String(config.artifactId ?? '').trim());
      const hasFileUrl = Boolean(String(config.fileUrl ?? '').trim());
      if (hasArtifactId === hasFileUrl) blockers.add('OCR requires exactly one of artifactId or fileUrl');
    }
  }
  return [...blockers];
};

export const WorkflowBuilderPage: React.FC = () => {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const { theme } = useUIStore();
  const { t } = useI18nStore();
  const prefersReducedMotion = useReducedMotion();
  const nodeSequenceRef = useRef(INITIAL_NODES.length);
  const logSequenceRef = useRef(0);
  const executionTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const inspectorRef = useRef<HTMLElement | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedNodeType = String(selectedNode?.data?.nodeType ?? '');
  const selectedNodeConfig = (selectedNode?.data?.config ?? {}) as Record<string, unknown>;
  const unsupportedNodeTypes = useMemo(
    () => [...new Set(nodes.map((node) => String(node.data?.nodeType ?? '')).filter((type) => !SUPPORTED_NODE_TYPES.has(type)))],
    [nodes]
  );
  const publishBlockers = useMemo(() => getPublishBlockers(nodes), [nodes]);
  const selectedNodeReadiness = selectedNode
    ? getNodeReadinessBadge(selectedNodeType, selectedNodeConfig)
    : undefined;
  const selectedNodeReadinessMessage = selectedNode
    ? getNodeReadinessMessage(selectedNodeType, selectedNodeConfig)
    : undefined;
  const isUnsupportedNode = Boolean(selectedNodeType) && !SUPPORTED_NODE_TYPES.has(selectedNodeType);
  const isGoogleSheetsNode = selectedNodeType === 'google.sheets';
  const isGoogleDocsNode = selectedNodeType === 'google.docs';
  const isGoogleNode = isGoogleSheetsNode;
  const googleOperation = String(selectedNodeConfig.operation ?? 'read');

  // Canvas State & Controls
  const [showGrid, setShowGrid] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectorTab, setInspectorTab] = useState<'config' | 'input' | 'output' | 'logs'>('config');

  // Workflow Metadata & Status
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [workflowTitle, setWorkflowTitle] = useState('');
  const [isSaved, setIsSaved] = useState(true);
  const [isLoadingWorkflow, setIsLoadingWorkflow] = useState(true);
  const [isSavingWorkflow, setIsSavingWorkflow] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowNotice, setWorkflowNotice] = useState<string | null>(null);
  const [publishedWebhooks, setPublishedWebhooks] = useState<WebhookProvisioning[]>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null);

  // Inspector Form State (for selected node)
  const [ocrLanguage, setOcrLanguage] = useState('vi+en');
  const [ocrDetectTables, setOcrDetectTables] = useState(true);
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrExtractionResult | null>(null);
  const [ocrError, setOcrError] = useState<{ code: string; message: string; retryable?: boolean } | null>(null);
  const [isOcrRunning, setIsOcrRunning] = useState(false);

  const clearExecutionTimers = useCallback(() => {
    executionTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    executionTimeoutsRef.current = [];
  }, []);

  const scheduleExecutionStep = useCallback((callback: () => void, delay: number) => {
    const timeoutId = setTimeout(() => {
      executionTimeoutsRef.current = executionTimeoutsRef.current.filter((id) => id !== timeoutId);
      callback();
    }, delay);
    executionTimeoutsRef.current.push(timeoutId);
  }, []);

  useEffect(() => clearExecutionTimers, [clearExecutionTimers]);

  useEffect(() => {
    let disposed = false;
    setIsLoadingWorkflow(true);
    setWorkflowError(null);
    if (!workflowId) {
      setWorkflowError('Workflow ID is missing.');
      setIsLoadingWorkflow(false);
      return;
    }

    void workflowApi.getWorkflow(workflowId)
      .then((loaded) => {
        if (disposed) return;
        if (!loaded) {
          setWorkflow(null);
          setWorkflowError('Workflow not found in the active workspace.');
          return;
        }
        const flow = isWorkflowMockMode
          ? {
              nodes: INITIAL_NODES.map((node) => ({ ...node, position: { ...node.position }, data: { ...node.data, config: { ...(node.data.config as Record<string, unknown>) } } })),
              edges: INITIAL_EDGES.map((edge) => ({ ...edge, style: edge.style ? { ...edge.style } : undefined })),
            }
          : workflowToReactFlow(loaded);
        setWorkflow(loaded);
        setWorkflowTitle(loaded.name);
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setIsSaved(true);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setWorkflow(null);
        setWorkflowError(error instanceof Error ? error.message : 'Workflow could not be loaded.');
      })
      .finally(() => {
        if (!disposed) setIsLoadingWorkflow(false);
      });

    return () => { disposed = true; };
  }, [workflowId, setNodes, setEdges]);

  const saveDraft = useCallback(async () => {
    if (!workflow) throw new Error('Workflow is not loaded.');
    const draft = reactFlowToWorkflow(nodes, edges, { ...workflow, name: workflowTitle });
    const saved = await workflowApi.updateWorkflow(workflow.id, draft);
    setWorkflow(saved);
    setWorkflowTitle(saved.name);
    setIsSaved(true);
    return saved;
  }, [edges, nodes, setWorkflow, setWorkflowTitle, setIsSaved, workflow, workflowTitle]);

  const handleSaveDraft = async () => {
    setWorkflowError(null);
    setWorkflowNotice(null);
    setIsSavingWorkflow(true);
    try {
      await saveDraft();
      setWorkflowNotice('Draft saved to Workflow Service.');
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : 'Draft could not be saved.');
    } finally {
      setIsSavingWorkflow(false);
    }
  };

  const handlePublishWorkflow = async () => {
    setWorkflowError(null);
    setWorkflowNotice(null);
    setPublishedWebhooks([]);
    setIsSavingWorkflow(true);
    try {
      const saved = isSaved ? workflow : await saveDraft();
      if (!saved) throw new Error('Workflow is not loaded.');
      const publication = await workflowApi.publishWorkflow(saved.id);
      setWorkflow(publication.workflow);
      setIsSaved(true);
      setPublishedWebhooks(publication.webhooks);
      setWorkflowNotice('Workflow published.');
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : 'Workflow could not be published.');
    } finally {
      setIsSavingWorkflow(false);
    }
  };

  const handleRunWorkflow = async () => {
    if (!workflow) return;
    setWorkflowError(null);
    try {
      const accepted = await workflowApi.runWorkflow(workflow.id, {});
      navigate(`/executions?workflowId=${encodeURIComponent(workflow.id)}&executionId=${encodeURIComponent(accepted.executionId)}`);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : 'Workflow execution could not be queued.');
    }
  };

  // Telemetry Console State
  const [telemetryOpen, setTelemetryOpen] = useState(true);
  const [logs, setLogs] = useState<Array<{ id: string; time: string; level: 'info' | 'success' | 'warn'; msg: string }>>([]);

  const nodeTypes = useMemo(() => ({ customNode: CustomWorkflowNode }), []);
  const edgeTypes = useMemo(() => ({ execution: ExecutionEdge }), []);
  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        type: 'execution',
        data: {
          ...edge.data,
          active: edge.id === activeEdgeId,
          reducedMotion: Boolean(prefersReducedMotion),
        },
      })),
    [activeEdgeId, edges, prefersReducedMotion]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      setIsSaved(false);
      setEdges((eds) =>
        addEdge({
          ...params,
          type: 'execution',
          animated: false,
          style: { stroke: '#94a3b8', strokeWidth: 1.75 },
        }, eds)
      );
    },
    [setEdges, setIsSaved]
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes);
      if (changes.some((change) => change.type !== 'select')) setIsSaved(false);
    },
    [onEdgesChange, setIsSaved]
  );

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    setSelectedNodeId(null);
    setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, selected: false } })));
  }, [setNodes]);

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      if (changes.some((change) => change.type !== 'select')) setIsSaved(false);
      if (selectedNodeId && changes.some((change) => change.type === 'remove' && change.id === selectedNodeId)) {
        setSelectedNodeId(null);
        setInspectorOpen(false);
      }
    },
    [onNodesChange, selectedNodeId, setIsSaved]
  );

  const handleWorkspacePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (!inspectorRef.current?.contains(target)) {
        closeInspector();
      }
    },
    [closeInspector]
  );

  const onNodeClick = (_: React.MouseEvent, node: Node) => {
    setInspectorOpen(true);
    setSelectedNodeId(node.id);
    if (node.data?.nodeType === 'ocr.extract') {
      const config = (node.data.config ?? {}) as Record<string, unknown>;
      setOcrLanguage(String(config.language ?? 'vi+en'));
      setOcrDetectTables(Boolean(config.detectTables ?? true));
      setOcrFile(null);
      setOcrResult(null);
      setOcrError(null);
    }
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          selected: n.id === node.id,
        },
      }))
    );
  };

  const updateSelectedNodeConfig = useCallback(
    (updates: Record<string, unknown>) => {
      if (!selectedNodeId) return;
      setNodes((nds) =>
        nds.map((node) =>
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, config: { ...(node.data.config as Record<string, unknown>), ...updates } } }
            : node
        )
      );
      setIsSaved(false);
    },
    [selectedNodeId, setNodes]
  );

  const handleOcrFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setOcrFile(file);
    setOcrResult(null);
    setOcrError(null);
  };

  const handleRunOcr = async () => {
    if (!ocrFile) {
      setOcrError({
        code: 'INVALID_REQUEST',
        message: t('ocr.file_required'),
        retryable: false,
      });
      return;
    }

    setIsOcrRunning(true);
    setOcrError(null);
    try {
      const workspaceId = isWorkflowMockMode ? 'ws-main' : await getActiveWorkflowWorkspaceId();
      const result = await ocrApi.extractText(
        ocrFile,
        { language: ocrLanguage, detectTables: ocrDetectTables },
        { workspaceId }
      );
      setOcrResult(result);
      updateSelectedNodeConfig({
        language: ocrLanguage,
        detectTables: ocrDetectTables,
      });
      setNodes((nds) =>
        nds.map((node) =>
          node.id === selectedNodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  status: 'tested',
                  executionTime: `${result.metadata.processingTimeMs}ms`,
                },
              }
            : node
        )
      );
      const displayConfidence =
        result.confidence !== null ? `${(result.confidence * 100).toFixed(1)}%` : '—';
      setLogs((prev) => [
        ...prev,
        {
          id: String(++logSequenceRef.current),
          time: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()),
          level: result.metadata.quality === 'OK' ? 'success' : 'warn',
          msg: `[OCR test] Extracted ${result.document.pages} page${result.document.pages === 1 ? '' : 's'} (${result.metadata.quality}) at ${displayConfidence} confidence`,
        },
      ]);
    } catch (error) {
      if (error instanceof OcrApiError) {
        setOcrError({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        });
      } else if (error instanceof Error) {
        setOcrError({
          code: 'OCR_ERROR',
          message: error.message,
          retryable: false,
        });
      } else {
        setOcrError({
          code: 'OCR_FAILED',
          message: t('ocr.failed'),
          retryable: false,
        });
      }
    } finally {
      setIsOcrRunning(false);
    }
  };

  const handleAddCatalogItem = (type: string, name: string, nameKey: string) => {
    const usedIds = new Set(nodes.map((node) => node.id));
    let sequence = nodeSequenceRef.current;
    let newNodeId = '';
    do {
      sequence += 1;
      newNodeId = `node-${sequence}`;
    } while (usedIds.has(newNodeId));
    nodeSequenceRef.current = sequence;
    const catalogItem = NODE_CATALOG.find((item) => item.type === type);
    const newNode: Node = {
      id: newNodeId,
      type: 'customNode',
      position: { x: 300 + (sequence % 3) * 40, y: 200 + (sequence % 2) * 60 },
      data: {
        id: `${type.replace('.', '_')}_v1`,
        name,
        nameKey,
        nodeType: type,
        status: 'idle',
        executionTime: '',
        selected: true,
        config: { ...(catalogItem?.defaultConfig ?? {}) },
      },
    };

    setNodes((nds) => [
      ...nds.map((n) => ({ ...n, data: { ...n.data, selected: false } })),
      newNode,
    ]);
    setSelectedNodeId(newNodeId);
    setInspectorOpen(true);
    if (type === 'ocr.extract') {
      setOcrLanguage('vi+en');
      setOcrDetectTables(true);
      setOcrFile(null);
      setOcrResult(null);
      setOcrError(null);
    }
    setIsSaved(false);
  };


  // This previews the graph connections only; it does not execute workflow nodes.
  const handlePreviewFlow = () => {
    if (isPreviewing) return;
    clearExecutionTimers();
    setActiveEdgeId(null);
    setIsPreviewing(true);
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
    setLogs((prev) => [
      ...prev,
      {
        id: String(++logSequenceRef.current),
        time,
        level: 'info',
        msg: 'Preview only; this action does not call the Workflow Service or node integrations.',
      },
    ]);

    if (prefersReducedMotion || edges.length === 0) {
      setIsPreviewing(false);
      return;
    }

    edges.forEach((edge, index) => {
      scheduleExecutionStep(() => setActiveEdgeId(edge.id), index * 500);
    });
    scheduleExecutionStep(() => setActiveEdgeId(null), edges.length * 500);
    scheduleExecutionStep(() => setIsPreviewing(false), edges.length * 500 + 300);
  };

  return (
    <div
      onPointerDownCapture={handleWorkspacePointerDown}
      className="flex flex-col h-[calc(100vh-48px)] -m-6 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans"
    >
      {/* TOP EDITOR HEADER (~48px) */}
      <header className="h-12 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          <Link
            to="/workflows"
            className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title={t('builder.back_to_workflows')}
          >
            <ArrowLeft size={16} />
          </Link>

          <div className="flex items-center gap-2">
            <input
              data-testid="workflow-title"
              aria-label="Workflow name"
              type="text"
              value={workflowTitle}
              disabled={isLoadingWorkflow || isSavingWorkflow || !workflow}
              onChange={(e) => {
                setWorkflowTitle(e.target.value);
                setIsSaved(false);
              }}
              className="bg-transparent font-semibold text-xs text-slate-900 dark:text-slate-100 focus:outline-none border-b border-transparent hover:border-slate-300 dark:hover:border-slate-700 px-1 py-0.5"
            />
            <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {isSaved ? t('builder.saved') : t('builder.edited')}
            </span>
          </div>
        </div>

        {/* Header Zoom & Canvas Controls */}
        <div className="hidden md:flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-md border border-slate-200 dark:border-slate-700">
          <button className="px-2 py-0.5 hover:bg-white dark:hover:bg-slate-700 rounded text-slate-700 dark:text-slate-300">
            -
          </button>
          <span className="px-1.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">100%</span>
          <button className="px-2 py-0.5 hover:bg-white dark:hover:bg-slate-700 rounded text-slate-700 dark:text-slate-300">
            +
          </button>
          <span className="w-px h-3 bg-slate-300 dark:bg-slate-700 mx-0.5" />
          <button className="px-2 py-0.5 hover:bg-white dark:hover:bg-slate-700 rounded text-[11px] text-slate-700 dark:text-slate-300">
            {t('builder.fit_view')}
          </button>
        </div>

        {/* Top Header Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            data-testid="workflow-save"
            onClick={handleSaveDraft}
            disabled={isLoadingWorkflow || isSavingWorkflow || !workflow}
            aria-busy={isSavingWorkflow}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md transition-colors disabled:cursor-wait disabled:opacity-50"
          >
            {isSavingWorkflow ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            <span>{isSavingWorkflow ? 'Saving…' : t('builder.save')}</span>
          </button>

          <button
            data-testid="workflow-publish"
            onClick={handlePublishWorkflow}
            aria-describedby={publishBlockers.length > 0 ? 'publish-blocker-summary' : undefined}
            title={publishBlockers.length > 0 ? publishBlockers.join('; ') : undefined}
            disabled={publishBlockers.length > 0 || isLoadingWorkflow || isSavingWorkflow || !workflow}
            aria-busy={isSavingWorkflow}
            className="hidden sm:flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <span>{t('builder.publish')}</span>
          </button>

          {workflow?.status === 'PUBLISHED' && (
            <button
              data-testid="workflow-run"
              onClick={handleRunWorkflow}
              className="hidden sm:flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              <Play size={13} />
              <span>Run</span>
            </button>
          )}

          <motion.button
            data-testid="workflow-preview"
            onClick={handlePreviewFlow}
            disabled={isPreviewing}
            title="Visual preview only. No Workflow Service run or node provider is called."
            aria-label="Preview workflow (visual only)"
            aria-busy={isPreviewing}
            whileHover={prefersReducedMotion ? undefined : { y: -1, scale: 1.01 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm shadow-blue-600/25 transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-80"
          >
            {isPreviewing ? (
              <>
                <span className="relative flex size-3.5 items-center justify-center"><span className="absolute size-3.5 animate-ping rounded-full bg-white/45 motion-reduce:animate-none" /><Loader2 size={13} className="relative motion-safe:animate-spin" /></span>
                <span>Previewing…</span>
              </>
            ) : (
              <>
                <Play size={13} className="fill-white" />
                <span>Preview flow</span>
              </>
            )}
          </motion.button>
        </div>
      </header>

      {isLoadingWorkflow && <div role="status" className="border-b border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Loading workflow…</div>}
      {workflowError && <div role="alert" data-testid="workflow-builder-error" className="border-b border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{workflowError}</div>}
      {workflowNotice && <div role="status" data-testid="workflow-builder-notice" className="border-b border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{workflowNotice}</div>}
      {publishedWebhooks.length > 0 && (
        <section aria-label="One-time webhook credentials" className="space-y-2 border-b border-amber-300 bg-amber-50 px-3 py-3 text-xs text-amber-950">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold">Copy these webhook credentials now. The secret will not be returned again.</p>
            <button type="button" onClick={() => setPublishedWebhooks([])} className="rounded px-2 py-1 hover:bg-amber-100">Dismiss</button>
          </div>
          {publishedWebhooks.map((webhook) => (
            <div key={webhook.triggerId} className="flex flex-wrap items-center gap-2 font-mono">
              <span>Endpoint key: {webhook.endpointKey}</span>
              <span>Secret: {webhook.secret}</span>
              <button type="button" onClick={() => void navigator.clipboard.writeText(webhook.secret)} className="inline-flex items-center gap-1 rounded border border-amber-400 px-2 py-1 hover:bg-amber-100">
                <Copy size={12} /> Copy secret
              </button>
            </div>
          ))}
        </section>
      )}

      {publishBlockers.length > 0 && (
        <div
          id="publish-blocker-summary"
          data-testid="publish-blocker-summary"
          role="status"
          className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-300"
        >
          Publish unavailable: {publishBlockers[0]}
          {publishBlockers.length > 1 ? ` (+${publishBlockers.length - 1} more)` : ''}
        </div>
      )}

      {unsupportedNodeTypes.length > 0 && (
        <div
          data-testid="unsupported-draft-warning"
          role="alert"
          className="border-b border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/25 dark:text-rose-300"
        >
          Unsupported V1 nodes are preserved in this draft: {unsupportedNodeTypes.join(', ')}. Remove or replace them before publishing.
        </div>
      )}

      {/* COMPACT EDITOR TOOLBAR / SUB-HEADER (~40px) */}
      <div className="h-10 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 px-3 flex items-center justify-between text-xs shrink-0 z-10">
        <div className="flex items-center gap-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
          <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            {workflow?.status ?? 'Draft'}
          </span>
          <span className="text-slate-400 dark:text-slate-600">|</span>
          <span data-testid="workflow-preview-notice" className="text-slate-500 dark:text-slate-400">
            Visual preview only · no workflow or provider calls
          </span>
        </div>

        <span className="hidden lg:flex text-[11px] font-mono text-slate-500 dark:text-slate-400">
          No Workflow Service execution history
        </span>

        {/* Right Toolbar View Toggles */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`p-1 rounded transition-colors ${
              showGrid ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100' : 'text-slate-400'
            }`}
            title={t('builder.toggle_grid')}
          >
            <Grid size={14} />
          </button>
          <button
            onClick={() => setShowMinimap(!showMinimap)}
            className={`p-1 rounded transition-colors ${
              showMinimap ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100' : 'text-slate-400'
            }`}
            title={t('builder.toggle_minimap')}
          >
            <Map size={14} />
          </button>
        </div>
      </div>

      {/* CENTER WORKSPACE LAYOUT */}
      <div className="flex-1 flex min-h-0 relative">
        {/* LEFT PALETTE SIDEBAR (~240px) */}
        <aside className="w-60 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0 z-10">
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {t('builder.add_step')}
              </span>
              <span data-testid="workflow-palette-count" className="text-[10px] text-slate-400 font-mono">{PALETTE_CATALOG.reduce((total, category) => total + category.items.length, 0)} {t('builder.available')}</span>
            </div>

            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-2 text-slate-400" />
              <input
                type="text"
                placeholder={t('builder.search_actions')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded border border-slate-200 bg-slate-100 py-1 pl-7 pr-2.5 text-xs outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/60 dark:bg-slate-800/80"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
            {PALETTE_CATALOG.map((cat) => (
              <div key={cat.categoryKey} className="space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                  {t(cat.categoryKey)}
                </span>
                <div className="space-y-1">
                  {cat.items
                    .filter((item) => {
                      const name = item.nameKey ? t(item.nameKey) : item.title;
                      return name.toLowerCase().includes(searchQuery.toLowerCase());
                    })
                    .map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <button
                          key={item.type}
                          data-testid="workflow-palette-item"
                          data-node-type={item.type}
                          disabled={isLoadingWorkflow || !workflow}
                          onClick={() => handleAddCatalogItem(item.type, item.nameKey ? t(item.nameKey) : item.title, item.nameKey ?? '')}
                          aria-label={item.nameKey ? t(item.nameKey) : item.title}
                          className="group flex w-full cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-left transition-[background-color,border-color,transform] hover:-translate-y-px hover:border-blue-400/60 hover:bg-blue-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/50 dark:bg-slate-800/40 dark:hover:bg-blue-950/25 motion-reduce:hover:translate-y-0"
                        >
                          <ItemIcon size={14} className="mt-0.5 shrink-0 text-slate-500 transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="truncate text-xs font-medium text-slate-800 transition-colors group-hover:text-blue-700 dark:text-slate-200 dark:group-hover:text-blue-300">
                              {item.nameKey ? t(item.nameKey) : item.title}
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{item.descKey ? t(item.descKey) : item.description}</span>
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* WORKFLOW CANVAS (CENTER) */}
        <main data-testid="workflow-canvas" className="flex-1 h-full bg-slate-100 dark:bg-slate-950 relative overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={renderedEdges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={closeInspector}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            colorMode={theme}
          >
            {showGrid && (
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1}
                color={theme === 'dark' ? '#334155' : '#cbd5e1'}
              />
            )}
            <Controls className="!bg-white dark:!bg-slate-900 !border-slate-200 dark:!border-slate-800 !text-slate-700 dark:!text-slate-300" />
            {showMinimap && (
              <MiniMap
                data-testid="workflow-minimap"
                aria-label="Workflow minimap"
                className="workflow-minimap hidden sm:block !bottom-3 !right-3 !m-0 !h-28 !w-44 !rounded-md !border-slate-300 !bg-slate-200/90 !shadow-lg dark:!border-slate-700 dark:!bg-slate-950/90"
                style={{ width: 176, height: 112, borderRadius: 6 }}
                nodeColor={(node) => {
                  const status = String(node.data?.status ?? 'idle');
                  return status === 'success' ? '#10b981' : status === 'processing' ? '#f59e0b' : '#4f8cff';
                }}
                nodeStrokeColor={theme === 'dark' ? '#64748b' : '#94a3b8'}
                nodeStrokeWidth={1.5}
                nodeBorderRadius={4}
                maskColor={theme === 'dark' ? 'rgba(15, 24, 38, 0.62)' : 'rgba(71, 85, 105, 0.42)'}
                maskStrokeColor={theme === 'dark' ? '#94a3b8' : '#64748b'}
                maskStrokeWidth={1.5}
                pannable
                zoomable
              />
            )}
          </ReactFlow>
        </main>

        {/* RIGHT INSPECTOR PANEL (~360px) */}
        <AnimatePresence initial={false}>
          {inspectorOpen && selectedNode && (
        <motion.aside
          key="workflow-inspector"
          ref={inspectorRef}
          data-testid="workflow-inspector"
          initial={prefersReducedMotion ? false : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-y-0 right-0 z-10 flex w-88 flex-col border-l border-slate-200 bg-white shadow-xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/25"
        >
          {/* Inspector Header */}
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {selectedNode.data.nameKey
                  ? t(String(selectedNode.data.nameKey))
                  : (selectedNode.data.name as string) || t('builder.step_inspector')}
              </span>
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                {(selectedNode.data.id as string) || 'extract_order_v1'}
              </span>
            </div>
            <span className={selectedNodeReadiness?.state === 'ready'
              ? 'rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              : 'rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 dark:text-amber-400'}>
              ● {selectedNodeReadiness?.label ?? t('builder.ready')}
            </span>
          </div>

          {selectedNodeReadinessMessage && (
            <div
              data-testid="integration-readiness"
              role="status"
              className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-300"
            >
              {selectedNodeReadinessMessage}
              {isUnsupportedNode && <span className="block">Existing configuration is preserved and read-only.</span>}
            </div>
          )}
          {selectedNodeType === 'trigger.webhook' && (
            <div data-testid="webhook-endpoint-readiness" role="status" className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
              The endpoint key and secret are provisioned on publish. The public path is system-managed.
            </div>
          )}

          {/* Inspector Tabs */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs">
            {(['config', 'input', 'output', 'logs'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setInspectorTab(tab)}
                className={`flex-1 py-2 font-medium capitalize text-center transition-colors border-b-2 ${
                  inspectorTab === tab
                    ? 'border-blue-500 text-blue-700 dark:text-blue-300'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {t(`builder.tab.${tab}`)}
              </button>
            ))}
          </div>

          {/* Inspector Body Content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
            {inspectorTab === 'config' && (
              isUnsupportedNode ? (
                <div data-testid="unsupported-node-config" className="space-y-3">
                  <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                    This node is outside Workflow V1. Its saved configuration stays intact and cannot be edited or published here.
                  </p>
                  <pre className="max-h-72 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[10px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                    {JSON.stringify(selectedNodeConfig, null, 2)}
                  </pre>
                </div>
              ) : selectedNodeType === 'logic.condition' ? (
                <div data-testid="condition-config" className="space-y-3">
                  <div>
                    <label htmlFor="condition-left" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Left value</label>
                    <input
                      id="condition-left"
                      data-testid="condition-left"
                      value={String(selectedNodeConfig.left ?? '')}
                      placeholder="{{ trigger.input.email }}"
                      onChange={(event) => updateSelectedNodeConfig({ left: event.target.value })}
                      className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="condition-operator" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Operator</label>
                    <select
                      id="condition-operator"
                      data-testid="condition-operator"
                      value={String(selectedNodeConfig.operator ?? 'eq')}
                      onChange={(event) => updateSelectedNodeConfig({ operator: event.target.value })}
                      className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {CONDITION_OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="condition-right" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Right value</label>
                    <input
                      id="condition-right"
                      data-testid="condition-right"
                      value={String(selectedNodeConfig.right ?? '')}
                      placeholder="500 or {{ variables.threshold }}"
                      onChange={(event) => updateSelectedNodeConfig({ right: event.target.value })}
                      className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">Use JSON values or V1 mappings. Expressions, operators, and code are not accepted as values.</p>
                </div>
              ) : selectedNodeType === 'trigger.schedule' ? (
                <div data-testid="schedule-config" className="space-y-3">
                  <div>
                    <label htmlFor="schedule-cron" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Six-field cron</label>
                    <input
                      id="schedule-cron"
                      data-testid="schedule-cron"
                      value={String(selectedNodeConfig.cron ?? '')}
                      placeholder="0 0 9 * * *"
                      onChange={(event) => updateSelectedNodeConfig({ cron: event.target.value })}
                      className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="schedule-timezone" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">IANA timezone</label>
                    <input
                      id="schedule-timezone"
                      data-testid="schedule-timezone"
                      value={String(selectedNodeConfig.timezone ?? '')}
                      placeholder="Asia/Ho_Chi_Minh"
                      onChange={(event) => updateSelectedNodeConfig({ timezone: event.target.value })}
                      className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>
              ) : selectedNodeType === 'trigger.webhook' ? (
                <div data-testid="webhook-config" className="space-y-3">
                  <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">The endpoint key and secret are provisioned on publish and shown once. This draft does not choose a public path.</p>
                  <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                    Method: <span className="font-mono">POST</span>
                  </div>
                </div>
              ) : selectedNodeType === 'trigger.manual' ? (
                <div>
                  <label htmlFor="manual-button-label" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Button label</label>
                  <input
                    id="manual-button-label"
                    value={String(selectedNodeConfig.buttonLabel ?? '')}
                    onChange={(event) => updateSelectedNodeConfig({ buttonLabel: event.target.value })}
                    className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              ) : selectedNodeType === 'trigger.telegram' ? (
                <div data-testid="telegram-trigger-config" className="rounded border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-300">
                  This trigger can be saved as a draft. Bot Service owns Telegram event normalization; no payload or ingress contract is available yet.
                </div>
              ) : selectedNodeType === 'telegram.send_message' ? (
                <div data-testid="telegram-send-config" className="space-y-3">
                  <div>
                    <label htmlFor="telegram-chat-id" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Chat ID</label>
                    <input id="telegram-chat-id" value={String(selectedNodeConfig.chatId ?? '')} onChange={(event) => updateSelectedNodeConfig({ chatId: event.target.value })} className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                  </div>
                  <div>
                    <label htmlFor="telegram-text" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Message</label>
                    <textarea id="telegram-text" rows={3} value={String(selectedNodeConfig.text ?? '')} onChange={(event) => updateSelectedNodeConfig({ text: event.target.value })} className="w-full resize-y rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                  </div>
                </div>
              ) : selectedNodeType === 'http.request' ? (
                <div data-testid="http-request-config" className="space-y-3">
                  <div>
                    <label htmlFor="http-method" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Method</label>
                    <select id="http-method" value={String(selectedNodeConfig.method ?? 'GET')} onChange={(event) => updateSelectedNodeConfig({ method: event.target.value })} className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                      {['GET', 'POST', 'PUT', 'DELETE'].map((method) => <option key={method}>{method}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="http-url" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">URL</label>
                    <input id="http-url" value={String(selectedNodeConfig.url ?? '')} onChange={(event) => updateSelectedNodeConfig({ url: event.target.value })} placeholder="https://example.com/api" className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                  </div>
                  <div>
                    <label htmlFor="http-body" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Body</label>
                    <textarea id="http-body" rows={3} value={String(selectedNodeConfig.body ?? '')} onChange={(event) => updateSelectedNodeConfig({ body: event.target.value })} placeholder="JSON or mapping" className="w-full resize-y rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Successful responses expose their body as output.data.</p>
                </div>
              ) : selectedNodeType === 'email.send' ? (
                <div data-testid="email-config" className="space-y-3">
                  <div>
                    <label htmlFor="email-to" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Recipient</label>
                    <input id="email-to" value={String(selectedNodeConfig.to ?? '')} onChange={(event) => updateSelectedNodeConfig({ to: event.target.value })} className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                  </div>
                  <div>
                    <label htmlFor="email-subject" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Subject</label>
                    <input id="email-subject" value={String(selectedNodeConfig.subject ?? '')} onChange={(event) => updateSelectedNodeConfig({ subject: event.target.value })} className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                  </div>
                  <div>
                    <label htmlFor="email-body" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Body</label>
                    <textarea id="email-body" rows={3} value={String(selectedNodeConfig.body ?? '')} onChange={(event) => updateSelectedNodeConfig({ body: event.target.value })} className="w-full resize-y rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                  </div>
                </div>
              ) : selectedNodeType.startsWith('ai.') ? (
                <div data-testid="ai-config" className="space-y-3">
                  {selectedNodeType === 'ai.extract' && (
                    <div>
                      <label htmlFor="ai-schema-description" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Schema description</label>
                      <textarea id="ai-schema-description" rows={4} value={String(selectedNodeConfig.schemaDescription ?? '')} onChange={(event) => updateSelectedNodeConfig({ schemaDescription: event.target.value })} className="w-full resize-y rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                    </div>
                  )}
                  {selectedNodeType === 'ai.classify' && (
                    <div>
                      <label htmlFor="ai-categories" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Categories (comma separated)</label>
                      <input id="ai-categories" value={Array.isArray(selectedNodeConfig.categories) ? selectedNodeConfig.categories.join(', ') : ''} onChange={(event) => updateSelectedNodeConfig({ categories: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                    </div>
                  )}
                  {selectedNodeType === 'ai.summarize' && (
                    <div>
                      <label htmlFor="ai-max-length" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">Maximum length</label>
                      <input id="ai-max-length" type="number" min="1" value={String(selectedNodeConfig.maxLength ?? 200)} onChange={(event) => updateSelectedNodeConfig({ maxLength: Number(event.target.value) })} className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                    </div>
                  )}
                </div>
              ) : selectedNodeType === 'ocr.extract' ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-900/70 dark:bg-blue-950/25">
                    <div className="flex items-start gap-2">
                      <Scan size={16} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                      <div>
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{t('ocr.title')}</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">{t('ocr.description')}</p>
                      </div>
                    </div>
                  </div>

                  <div data-testid="ocr-workflow-source" className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-950/60">
                    <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Workflow source (choose exactly one)</p>
                    <div>
                      <label htmlFor="ocr-artifact-id" className="mb-1 block text-[10px] font-medium text-slate-600 dark:text-slate-400">Workspace artifact ID</label>
                      <input
                        id="ocr-artifact-id"
                        data-testid="ocr-artifact-id"
                        value={String(selectedNodeConfig.artifactId ?? '')}
                        onChange={(event) => updateSelectedNodeConfig({ artifactId: event.target.value, fileUrl: '' })}
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label htmlFor="ocr-file-url" className="mb-1 block text-[10px] font-medium text-slate-600 dark:text-slate-400">File URL</label>
                      <input
                        id="ocr-file-url"
                        data-testid="ocr-file-url"
                        value={String(selectedNodeConfig.fileUrl ?? '')}
                        onChange={(event) => updateSelectedNodeConfig({ fileUrl: event.target.value, artifactId: '' })}
                        placeholder="https://..."
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                    <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">Leave both empty while drafting; filling one clears the other. URL execution stays disabled until its security checks are verified.</p>
                  </div>

                  <div>
                    <label htmlFor="ocr-file-input" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      Try OCR now (separate from the workflow source)
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-slate-300 bg-slate-50 px-2.5 py-2 text-xs text-slate-600 transition-colors hover:border-blue-400 hover:bg-blue-50/60 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:border-blue-500/60 dark:hover:bg-blue-950/25">
                      <Upload size={14} className="shrink-0 text-blue-600 dark:text-blue-400" />
                      <span className="min-w-0 flex-1 truncate">{ocrFile?.name ?? t('ocr.choose_file')}</span>
                      <input
                        id="ocr-file-input"
                        data-testid="ocr-file-input"
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
                        onChange={handleOcrFileChange}
                        className="sr-only"
                      />
                    </label>
                    <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{t('ocr.accepted')}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="ocr-language" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        {t('ocr.language')}
                      </label>
                      <select
                        id="ocr-language"
                        value={ocrLanguage}
                        onChange={(event) => {
                          setOcrLanguage(event.target.value);
                          updateSelectedNodeConfig({ language: event.target.value });
                        }}
                        className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="vi+en">Tiếng Việt + English</option>
                        <option value="vi">Tiếng Việt</option>
                        <option value="en">English</option>
                      </select>
                    </div>
                    <label className="mt-5 flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={ocrDetectTables}
                        onChange={(event) => {
                          setOcrDetectTables(event.target.checked);
                          updateSelectedNodeConfig({ detectTables: event.target.checked });
                        }}
                        className="size-3.5 accent-blue-600"
                      />
                      {t('ocr.detect_tables')}
                    </label>
                  </div>

                  {ocrError && (
                    <div
                      role="alert"
                      data-testid="ocr-error"
                      className="rounded border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-mono text-[10px] font-semibold uppercase bg-rose-200/70 dark:bg-rose-900/60 px-1 py-0.5 rounded">
                          {ocrError.code}
                        </span>
                        {ocrError.retryable && (
                          <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                            Retryable
                          </span>
                        )}
                      </div>
                      <p className="mt-1 leading-relaxed">{ocrError.message}</p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleRunOcr}
                    disabled={isOcrRunning}
                    className="flex w-full items-center justify-center gap-1.5 rounded bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
                  >
                    {isOcrRunning ? <Loader2 size={14} className="animate-spin" /> : <Scan size={14} />}
                    {isOcrRunning ? t('ocr.processing') : t('ocr.extract_text')}
                  </button>

                  {ocrResult && (
                    <div data-testid="ocr-result" className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">{t('ocr.result')}</span>
                          {ocrResult.metadata.quality === 'OK' && (
                            <span data-testid="ocr-quality-badge" className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                              ● OK
                            </span>
                          )}
                          {ocrResult.metadata.quality === 'LOW_CONFIDENCE' && (
                            <span data-testid="ocr-quality-badge" className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              ▲ Low Confidence
                            </span>
                          )}
                          {ocrResult.metadata.quality === 'EMPTY' && (
                            <span data-testid="ocr-quality-badge" className="rounded border border-slate-400/20 bg-slate-400/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-500 dark:text-slate-400">
                              ○ Empty
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setOcrResult(null)}
                          className="rounded p-0.5 text-slate-500 transition-colors hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
                          aria-label={t('ocr.dismiss_result')}
                        >
                          <X size={13} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <span className="rounded bg-white/70 px-2 py-1.5 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">{t('ocr.pages')}: <strong>{ocrResult.document.pages}</strong></span>
                        <span className="rounded bg-white/70 px-2 py-1.5 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                          {t('ocr.confidence')}: <strong>{ocrResult.confidence !== null ? `${(ocrResult.confidence * 100).toFixed(1)}%` : '—'}</strong>
                        </span>
                        <span className="rounded bg-white/70 px-2 py-1.5 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                          {t('ocr.mime_type')}: <strong>{ocrResult.document.mimeType}</strong>
                        </span>
                        <span className="rounded bg-white/70 px-2 py-1.5 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                          {t('ocr.tables')}: <strong>{ocrResult.tables?.length ?? 0}</strong>
                        </span>
                      </div>

                      {ocrResult.metadata.quality === 'EMPTY' && (
                        <div data-testid="ocr-empty-note" className="rounded border border-amber-200/60 bg-amber-50/50 p-2 text-[11px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
                          {t('ocr.empty_text')}
                        </div>
                      )}

                      {ocrResult.metadata.warnings && ocrResult.metadata.warnings.length > 0 && (
                        <div data-testid="ocr-warnings" className="space-y-1">
                          <span className="block text-[10px] font-medium text-amber-700 dark:text-amber-400">
                            {t('ocr.warnings')} ({ocrResult.metadata.warnings.length})
                          </span>
                          <div className="space-y-1">
                            {ocrResult.metadata.warnings.map((w, idx) => (
                              <div key={idx} className="rounded border border-amber-200/80 bg-amber-50/70 px-2 py-1 text-[10px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                                <span className="font-mono font-semibold">[{w.code}]</span>{' '}
                                {w.page ? `(p.${w.page}) ` : ''}
                                {w.message}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <span className="mb-1 block text-[10px] font-medium text-slate-600 dark:text-slate-400">{t('ocr.raw_text')}</span>
                        <pre data-testid="ocr-raw-text" className="max-h-24 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white/70 p-2 font-mono text-[10px] leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">{ocrResult.text.rawText || '(No text detected)'}</pre>
                      </div>
                    </div>
                  )}
                </div>
              ) : isGoogleNode ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-900/70 dark:bg-blue-950/25">
                    <div className="flex items-start gap-2">
                      {isGoogleSheetsNode ? (
                        <FileSpreadsheet size={16} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                      ) : (
                        <FileText size={16} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                      )}
                      <div>
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{t('builder.google.title')}</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">{t('builder.google.description')}</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="google-connection" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      {t('builder.google.connection')}
                    </label>
                    <select
                      id="google-connection"
                      data-testid="google-connection"
                      value={String(selectedNodeConfig.connectionId ?? '')}
                      onChange={(event) => updateSelectedNodeConfig({ connectionId: event.target.value })}
                      className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="">Select an authorized connection</option>
                      {String(selectedNodeConfig.connectionId ?? '').trim() && (
                        <option value={String(selectedNodeConfig.connectionId)}>Existing connection reference</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="google-operation" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      {t('builder.google.operation')}
                    </label>
                    <select
                      id="google-operation"
                      value={googleOperation}
                      onChange={(event) => updateSelectedNodeConfig({ operation: event.target.value })}
                      className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {isGoogleSheetsNode ? (
                        <>
                          <option value="read">{t('builder.google.operation.read')}</option>
                          <option value="append">{t('builder.google.operation.append')}</option>
                          <option value="update">{t('builder.google.operation.update')}</option>
                        </>
                      ) : (
                        <>
                          <option value="create">{t('builder.google.operation.create')}</option>
                          <option value="read">{t('builder.google.operation.read')}</option>
                          <option value="append">{t('builder.google.operation.append')}</option>
                        </>
                      )}
                    </select>
                  </div>

                  {isGoogleSheetsNode && (
                    <>
                      <div>
                        <label htmlFor="google-spreadsheet-id" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          {t('builder.google.spreadsheet_id')}
                        </label>
                        <input
                          id="google-spreadsheet-id"
                          type="text"
                          value={String(selectedNodeConfig.spreadsheetId ?? '')}
                          onChange={(event) => updateSelectedNodeConfig({ spreadsheetId: event.target.value })}
                          className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </div>

                      {googleOperation === 'append' ? (
                        <>
                          <div>
                            <label htmlFor="google-sheet-name" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                              {t('builder.google.sheet_name')}
                            </label>
                            <input
                              id="google-sheet-name"
                              type="text"
                              value={String(selectedNodeConfig.sheetName ?? '')}
                              onChange={(event) => updateSelectedNodeConfig({ sheetName: event.target.value })}
                              className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                            />
                          </div>
                          <div>
                            <label htmlFor="google-row-variable" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                              {t('builder.google.row_variable')}
                            </label>
                            <input
                              id="google-row-variable"
                              type="text"
                              value={String(selectedNodeConfig.rowDataVariable ?? '')}
                              onChange={(event) => updateSelectedNodeConfig({ rowDataVariable: event.target.value })}
                              className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                            />
                          </div>
                        </>
                      ) : (
                        <div>
                          <label htmlFor="google-range" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                            {t('builder.google.range')}
                          </label>
                          <input
                            id="google-range"
                            type="text"
                            value={String(selectedNodeConfig.range ?? '')}
                            onChange={(event) => updateSelectedNodeConfig({ range: event.target.value })}
                            className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                          />
                        </div>
                      )}

                      {googleOperation === 'update' && (
                        <div>
                          <label htmlFor="google-value-variable" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                            {t('builder.google.value_variable')}
                          </label>
                          <input
                            id="google-value-variable"
                            type="text"
                            value={String(selectedNodeConfig.valueVariable ?? '')}
                            onChange={(event) => updateSelectedNodeConfig({ valueVariable: event.target.value })}
                            className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                          />
                        </div>
                      )}
                    </>
                  )}

                  {isGoogleDocsNode && googleOperation === 'create' && (
                    <div>
                      <label htmlFor="google-document-title" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        {t('builder.google.title_field')}
                      </label>
                      <input
                        id="google-document-title"
                        type="text"
                        value={String(selectedNodeConfig.title ?? '')}
                        onChange={(event) => updateSelectedNodeConfig({ title: event.target.value })}
                        className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}

                  {isGoogleDocsNode && googleOperation !== 'create' && (
                    <div>
                      <label htmlFor="google-document-id" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        {t('builder.google.document_id')}
                      </label>
                      <input
                        id="google-document-id"
                        type="text"
                        value={String(selectedNodeConfig.documentId ?? '')}
                        onChange={(event) => updateSelectedNodeConfig({ documentId: event.target.value })}
                        className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}

                  {isGoogleDocsNode && (googleOperation === 'create' || googleOperation === 'append') && (
                    <div>
                      <label htmlFor="google-content-variable" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        {t('builder.google.content_variable')}
                      </label>
                      <input
                        id="google-content-variable"
                        type="text"
                        value={String(selectedNodeConfig.contentVariable ?? '')}
                        onChange={(event) => updateSelectedNodeConfig({ contentVariable: event.target.value })}
                        className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}

                  <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">{t('builder.google.id_hint')}</p>
                </div>
              ) : (
                <div data-testid="node-config-fallback" className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  No editable V1 configuration is defined for this node.
                </div>
              )
            )}

            {inspectorTab === 'input' && (
              <div data-testid="workflow-no-input" className="text-[11px] text-slate-500 dark:text-slate-400">
                No workflow input data is available because this draft has not been executed.
              </div>
            )}

            {inspectorTab === 'output' && (
              <div data-testid="workflow-no-output" className="text-[11px] text-slate-500 dark:text-slate-400">
                No workflow output data is available because this draft has not been executed.
              </div>
            )}

            {inspectorTab === 'logs' && (
              <div data-testid="workflow-no-node-logs" className="text-[11px] text-slate-500 dark:text-slate-400">
                No Workflow Service node logs are available for this draft.
              </div>
            )}
          </div>

          {/* Inspector Footer Actions */}
          <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
            <button
              data-testid="workflow-preview-inspector"
              onClick={handlePreviewFlow}
              disabled={isPreviewing}
              aria-label="Preview workflow (visual only)"
              className="px-2.5 py-1 text-xs font-medium bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded transition-colors"
            >
              Preview flow
            </button>
            <button className="rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
              {t('builder.save_changes')}
            </button>
          </div>
        </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* BOTTOM TELEMETRY CONSOLE STREAM */}
      <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0 z-20">
        {/* Telemetry Bar Header */}
        <div
          onClick={() => setTelemetryOpen(!telemetryOpen)}
          className="h-8 px-3 flex items-center justify-between text-[11px] font-mono bg-slate-50 dark:bg-slate-900/80 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors border-b border-slate-200 dark:border-slate-800"
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-semibold">
              <Terminal size={12} className="text-blue-500" />
              Draft activity
            </span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-500">No V1 execution history</span>
          </div>

          <div className="flex items-center gap-2 text-slate-400">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLogs([]);
              }}
              className="hover:text-slate-600 dark:hover:text-slate-200 text-[10px]"
            >
          {t('builder.telemetry.clear_logs')}
            </button>
            <ChevronDown size={14} className={`transform transition-transform ${telemetryOpen ? '' : 'rotate-180'}`} />
          </div>
        </div>

        {/* Console Log Content */}
        {telemetryOpen && (
          <div className="h-28 p-2.5 font-mono text-[11px] overflow-y-auto bg-slate-950 text-slate-300">
            <p data-testid="workflow-telemetry-preview-notice" role="note" className="mb-2 text-slate-400">
              Visual preview only. This action does not call the Workflow Service or node integrations.
            </p>
            <div className="space-y-1 text-[11px]">
              {logs.length === 0 && (
                <p data-testid="workflow-telemetry-empty" className="text-slate-500">
                  No execution telemetry is available for this draft.
                </p>
              )}
              {logs.map((log) => (
                <div key={log.id} className="flex items-center gap-2">
                  <span className="text-slate-500 text-[10px]">{log.time}</span>
                  <span
                    className={
                      log.level === 'success'
                        ? 'text-emerald-400'
                        : log.level === 'warn'
                        ? 'text-amber-400'
                        : 'text-slate-300'
                    }
                  >
                    {log.msg}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
