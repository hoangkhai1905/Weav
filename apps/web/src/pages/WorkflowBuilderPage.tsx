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
  Plus,
} from 'lucide-react';
import { CustomWorkflowNode } from '../components/builder/CustomWorkflowNode';
import { ExecutionEdge } from '../components/builder/ExecutionEdge';
import { OutputSchemaEditor } from '../components/builder/OutputSchemaEditor';
import { GenerateWorkflowPanel } from '../components/builder/GenerateWorkflowPanel';
import { useUIStore } from '../store/useUIStore';
import { useI18nStore } from '../store/useI18nStore';
import { createReactFlowAriaLabelConfig } from '../lib/i18n/react-flow-aria';
import { useWorkspaceContext } from '../hooks/useWorkspace';
import { useConnections } from '../hooks/useConnections';
import { useAuthStore } from '../store/useAuthStore';
import { ocrApi, OcrApiError, type OcrExtractionResult } from '../api/ocr.api';
import { NODE_CATALOG } from '../lib/constants/nodeCatalog';
import { getNodeReadinessBadge } from '../lib/nodeReadiness';
import { workflowApi, isWorkflowMockMode } from '../api/workflow.api';
import type { WebhookProvisioning } from '../api/workflow-v1.api';
import { definitionToCanvas, type GenerationResponse } from '../api/workflow-v1.api';
import { workflowToReactFlow, reactFlowToWorkflow } from '../lib/mappers/workflowMapper';
import type { WorkflowDefinition } from '../types/workflow.types';
import { captureNotificationSession, isCurrentNotificationSession } from '../lib/notifications/session';
import { showSuccessToast } from '../lib/feedback/toast';
import { useNotificationMilestoneRefresh } from '../hooks/useNotificationMilestoneRefresh';

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

const INSPECTOR_WIDTH = 400;
const PORT_LABEL_ROOM = 80;

const CONDITION_OPERATORS = [
  { value: 'eq', labelKey: 'builder.cfg.op_eq' },
  { value: 'ne', labelKey: 'builder.cfg.op_ne' },
  { value: 'gt', labelKey: 'builder.cfg.op_gt' },
  { value: 'gte', labelKey: 'builder.cfg.op_gte' },
  { value: 'lt', labelKey: 'builder.cfg.op_lt' },
  { value: 'lte', labelKey: 'builder.cfg.op_lte' },
] as const;

const getNodeReadinessMessage = (type: string, config: Record<string, unknown>, t: (key: string) => string): string | undefined => {
  if (!SUPPORTED_NODE_TYPES.has(type)) return t('builder.cfg.msg_unsupported').replace('{type}', type);
  if (type === 'trigger.webhook') return t('builder.cfg.msg_webhook');
  if (type === 'google.sheets') {
    return String(config.connectionId ?? '').trim()
      ? t('builder.cfg.msg_sheets_auth')
      : t('builder.cfg.msg_sheets_select');
  }
  if (type === 'trigger.telegram') return t('builder.cfg.msg_tg_trigger');
  if (type === 'telegram.send_message') return t('builder.cfg.msg_tg_send');
  if (type === 'email.send') {
    if (!String(config.connectionId ?? '').trim()) {
      return t('builder.cfg.msg_gmail_select');
    }
    if (!String(config.to ?? '').trim() || !String(config.subject ?? '').trim()) {
      return t('builder.cfg.msg_email_fields');
    }
    return undefined;
  }
  if (type === 'logic.condition' && (!String(config.left ?? '').trim() || !String(config.right ?? '').trim())) {
    return t('builder.cfg.msg_condition');
  }
  if (type === 'trigger.schedule') {
    const fields = String(config.cron ?? '').trim().split(/\s+/);
    if (fields.length !== 6 || !String(config.timezone ?? '').trim()) {
      return t('builder.cfg.msg_schedule');
    }
  }
  if (type === 'http.request' && !String(config.url ?? '').trim()) return t('builder.cfg.msg_http');
  if (type === 'ocr.extract') {
    return t('builder.cfg.msg_ocr');
  }
  return undefined;
};

const getPublishBlockers = (nodes: Node[], t: (key: string) => string): string[] => {
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
    if (type === 'email.send') {
      const message = getNodeReadinessMessage(type, config, t);
      if (message) blockers.add(message);
    }
    if (type === 'trigger.telegram' || type === 'telegram.send_message' || type === 'ocr.extract') {
      blockers.add(getNodeReadinessMessage(type, config, t) ?? `${type} is not configured`);
    }
    if (type === 'ocr.extract') {
      const hasArtifactId = Boolean(String(config.artifactId ?? '').trim());
      const hasFileUrl = Boolean(String(config.fileUrl ?? '').trim());
      if (hasArtifactId === hasFileUrl) blockers.add('OCR requires exactly one of artifactId or fileUrl');
    }
  }
  return [...blockers];
};

type OcrErrorState = { code: string; message: string; retryable?: boolean };
type OcrScope = { userId: string | null; workspaceId: string | null };

export const WorkflowBuilderPage: React.FC = () => {
  const refreshNotifications = useNotificationMilestoneRefresh();
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const { theme } = useUIStore();
  const { language, t } = useI18nStore();
  const ariaLabelConfig = useMemo(() => createReactFlowAriaLabelConfig(t, language), [language, t]);
  const { activeWorkspaceId, userId } = useWorkspaceContext();
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
  const { data: workspaceConnections, isLoading: isLoadingConnections } = useConnections();
  const gmailConnections = useMemo(
    () => (workspaceConnections ?? []).filter(
      (connection) => connection.provider === 'GMAIL' && connection.status === 'ACTIVE' && connection.canAttach,
    ),
    [workspaceConnections],
  );
  const unsupportedNodeTypes = useMemo(
    () => [...new Set(nodes.map((node) => String(node.data?.nodeType ?? '')).filter((type) => !SUPPORTED_NODE_TYPES.has(type)))],
    [nodes]
  );
  const publishBlockers = useMemo(() => getPublishBlockers(nodes, t), [nodes, t]);
  const selectedNodeReadiness = selectedNode
    ? getNodeReadinessBadge(selectedNodeType, selectedNodeConfig)
    : undefined;
  const selectedNodeReadinessMessage = selectedNode
    ? getNodeReadinessMessage(selectedNodeType, selectedNodeConfig, t)
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
  const [publishedWebhooks, setPublishedWebhooks] = useState<WebhookProvisioning[]>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null);
  const [isGeneratePanelOpen, setIsGeneratePanelOpen] = useState(false);

  // Inspector Form State (for selected node)
  const [ocrLanguage, setOcrLanguage] = useState('vi+en');
  const [ocrDetectTables, setOcrDetectTables] = useState(true);
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ocrFileUserId, setOcrFileUserId] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrExtractionResult | null>(null);
  const [ocrResultScope, setOcrResultScope] = useState<OcrScope | null>(null);
  const [ocrError, setOcrError] = useState<OcrErrorState | null>(null);
  const [ocrErrorScope, setOcrErrorScope] = useState<OcrScope | null>(null);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const ocrRequestSequenceRef = useRef(0);
  const ocrRequestRef = useRef<{
    requestId: number;
    userId: string | null;
    workspaceId: string;
    controller: AbortController;
  } | null>(null);
  const ocrScopeRef = useRef<{ userId: string | null; workspaceId: string | null }>({
    userId,
    workspaceId: activeWorkspaceId,
  });
  const currentOcrScope: OcrScope = { userId, workspaceId: activeWorkspaceId };
  const currentUserOcrFile = ocrFileUserId === userId ? ocrFile : null;
  const visibleOcrResult =
    ocrResultScope?.userId === userId && ocrResultScope.workspaceId === activeWorkspaceId
      ? ocrResult
      : null;
  const visibleOcrError =
    ocrErrorScope?.userId === userId && ocrErrorScope.workspaceId === activeWorkspaceId
      ? ocrError
      : null;

  const clearOcrResult = () => {
    setOcrResult(null);
    setOcrResultScope(null);
  };

  const setScopedOcrError = (error: OcrErrorState | null, scope = currentOcrScope) => {
    setOcrError(error);
    setOcrErrorScope(error ? scope : null);
  };

  const isCurrentOcrRequest = useCallback(
    (requestId: number, requestUserId: string | null, requestWorkspaceId: string) => {
      const request = ocrRequestRef.current;
      return Boolean(
        request &&
          request.requestId === requestId &&
          ocrScopeRef.current.userId === requestUserId &&
          ocrScopeRef.current.workspaceId === requestWorkspaceId,
      );
    },
    [],
  );

  useEffect(() => {
    ocrScopeRef.current = { userId, workspaceId: activeWorkspaceId };
    const request = ocrRequestRef.current;
    if (
      request &&
      (request.userId !== userId || request.workspaceId !== activeWorkspaceId)
    ) {
      request.controller.abort();
      ocrRequestRef.current = null;
      setIsOcrRunning(false);
    }
  }, [activeWorkspaceId, userId]);

  useEffect(() => () => {
    ocrRequestRef.current?.controller.abort();
    ocrRequestRef.current = null;
  }, []);

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
    const mutationSession = captureNotificationSession();
    setIsSavingWorkflow(true);
    try {
      await saveDraft();
      if (isCurrentNotificationSession(mutationSession)) {
        showSuccessToast('toast.workflow.draft_saved', mutationSession);
      }
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) {
        setWorkflowError(error instanceof Error ? error.message : 'Draft could not be saved.');
      }
    } finally {
      setIsSavingWorkflow(false);
    }
  };

  const handlePublishWorkflow = async () => {
    setWorkflowError(null);
    const mutationSession = captureNotificationSession();
    setPublishedWebhooks([]);
    setIsSavingWorkflow(true);
    try {
      const saved = isSaved ? workflow : await saveDraft();
      if (!saved) throw new Error('Workflow is not loaded.');
      const publication = await workflowApi.publishWorkflow(saved.id);
      if (!isCurrentNotificationSession(mutationSession)) return;
      setWorkflow(publication.workflow);
      setIsSaved(true);
      setPublishedWebhooks(publication.webhooks);
      showSuccessToast('toast.workflow.published', mutationSession);
      refreshNotifications(mutationSession);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) {
        setWorkflowError(error instanceof Error ? error.message : 'Workflow could not be published.');
      }
    } finally {
      setIsSavingWorkflow(false);
    }
  };

  const handleRunWorkflow = async () => {
    if (!workflow) return;
    setWorkflowError(null);
    const mutationSession = captureNotificationSession();
    try {
      const accepted = await workflowApi.runWorkflow(workflow.id, {});
      if (!isCurrentNotificationSession(mutationSession)) return;
      showSuccessToast('toast.workflow.run_accepted', mutationSession);
      navigate(`/workflows/${encodeURIComponent(workflow.id)}/executions?run=${encodeURIComponent(accepted.executionId)}`);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) {
        setWorkflowError(error instanceof Error ? error.message : 'Workflow execution could not be queued.');
      }
    }
  };

  // Telemetry Console State
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const flowRef = useRef<{
    getNode: (id: string) => Node | undefined;
    getViewport: () => { x: number; y: number; zoom: number };
    setViewport: (viewport: { x: number; y: number; zoom: number }, options?: { duration?: number }) => Promise<boolean>;
  } | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
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

  // Keep the selected node (plus room for its branch labels) clear of the 400px inspector.
  // Runs on selection change only and never changes the zoom.
  useEffect(() => {
    if (!inspectorOpen || !selectedNodeId) return;
    const flow = flowRef.current;
    const canvas = canvasRef.current;
    if (!flow || !canvas) return;
    const frame = window.requestAnimationFrame(() => {
      const node = flow.getNode(selectedNodeId);
      if (!node) return;
      const { x, y, zoom } = flow.getViewport();
      const bounds = canvas.getBoundingClientRect();
      const margin = 24;
      const visibleRight = bounds.width - INSPECTOR_WIDTH - margin;
      const width = node.measured?.width ?? 232;
      const height = node.measured?.height ?? 80;
      const left = node.position.x * zoom + x;
      const top = node.position.y * zoom + y;
      const right = left + (width + PORT_LABEL_ROOM) * zoom;
      const bottom = top + height * zoom;
      let dx = 0;
      let dy = 0;
      if (right > visibleRight) dx = visibleRight - right;
      if (left + dx < margin) dx = margin - left;
      if (top < margin + 48) dy = margin + 48 - top;
      else if (bottom > bounds.height - margin) dy = bounds.height - margin - bottom;
      if (dx === 0 && dy === 0) return;
      void flow.setViewport({ x: x + dx, y: y + dy, zoom }, { duration: prefersReducedMotion ? 0 : 200 });
    });
    return () => window.cancelAnimationFrame(frame);
    // Only selection changes should pan; viewport/size reads are taken at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, inspectorOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchQuery('');
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === 'Escape') {
        if (paletteOpen) setPaletteOpen(false);
        else if (inspectorOpen) closeInspector();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen, inspectorOpen, closeInspector]);

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
      setOcrFileUserId(null);
      clearOcrResult();
      setScopedOcrError(null);
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
    if (file && !activeWorkspaceId) {
      event.target.value = '';
      setOcrFile(null);
      setOcrFileUserId(null);
      clearOcrResult();
      setScopedOcrError({
        code: 'WORKSPACE_REQUIRED',
        message: t('ocr.workspace_required'),
        retryable: false,
      });
      return;
    }
    setOcrFile(file);
    setOcrFileUserId(file ? userId : null);
    clearOcrResult();
    setScopedOcrError(null);
    if (file) updateSelectedNodeConfig({ fileName: file.name });
  };

  const handleRunOcr = async () => {
    if (ocrRequestRef.current || isOcrRunning) return;
    if (!activeWorkspaceId) {
      setScopedOcrError({
        code: 'WORKSPACE_REQUIRED',
        message: t('ocr.workspace_required'),
        retryable: false,
      });
      return;
    }
    if (!currentUserOcrFile) {
      setScopedOcrError({
        code: 'INVALID_REQUEST',
        message: t('ocr.file_required'),
        retryable: false,
      });
      return;
    }

    const requestId = ++ocrRequestSequenceRef.current;
    const requestUserId = userId;
    const requestWorkspaceId = activeWorkspaceId;
    const controller = new AbortController();
    ocrRequestRef.current = {
      requestId,
      userId: requestUserId,
      workspaceId: requestWorkspaceId,
      controller,
    };
    setIsOcrRunning(true);
    setScopedOcrError(null);
    try {
      const result = await ocrApi.extractText(
        currentUserOcrFile,
        { language: ocrLanguage, detectTables: ocrDetectTables },
        { workspaceId: requestWorkspaceId, signal: controller.signal }
      );
      if (!isCurrentOcrRequest(requestId, requestUserId, requestWorkspaceId)) return;
      setOcrResult(result);
      setOcrResultScope({ userId: requestUserId, workspaceId: requestWorkspaceId });
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
      if (!isCurrentOcrRequest(requestId, requestUserId, requestWorkspaceId)) return;
      if (controller.signal.aborted) return;
      if (error instanceof OcrApiError && error.statusCode === 401) {
        useAuthStore.getState().logout();
        return;
      }
      if (error instanceof OcrApiError) {
        setScopedOcrError({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        });
      } else if (error instanceof Error) {
        setScopedOcrError({
          code: 'OCR_ERROR',
          message: error.message,
          retryable: false,
        });
      } else {
        setScopedOcrError({
          code: 'OCR_FAILED',
          message: t('ocr.failed'),
          retryable: false,
        });
      }
    } finally {
      if (isCurrentOcrRequest(requestId, requestUserId, requestWorkspaceId)) {
        ocrRequestRef.current = null;
        setIsOcrRunning(false);
      }
    }
  };

  const handleRetryOcr = () => {
    void handleRunOcr();
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
      setOcrFileUserId(null);
      clearOcrResult();
      setScopedOcrError(null);
    }
    setIsSaved(false);
  };

  const handleGenerateReady = (result: Extract<GenerationResponse, { status: 'ready' }>) => {
    const hasBeyondTrigger = nodes.length > 1
      || (nodes.length === 1 && String(nodes[0].data?.nodeType ?? '') !== 'trigger.manual');
    if (hasBeyondTrigger && !window.confirm('Replace the current canvas?')) return;
    const canvas = definitionToCanvas(result.definition, result.layout);
    const flow = workflowToReactFlow({
      id: workflow?.id ?? 'generated',
      workspaceId: workflow?.workspaceId ?? activeWorkspaceId ?? '',
      name: result.name,
      status: 'DRAFT',
      version: 1,
      triggerType: 'trigger.manual',
      nodes: canvas.nodes,
      edges: canvas.edges,
      createdAt: workflow?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerName: workflow?.ownerName ?? '',
    });
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setWorkflowTitle(result.name);
    setIsSaved(false);
    setIsGeneratePanelOpen(false);
  };

  // This previews the graph connections only; it does not execute workflow nodes.
  const handlePreviewFlow = () => {
    if (isPreviewing) return;
    clearExecutionTimers();
    setActiveEdgeId(null);
    setIsPreviewing(true);
    setTelemetryOpen(true);
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
    setLogs((prev) => [
      ...prev,
      {
        id: String(++logSequenceRef.current),
        time,
        level: 'info',
        msg: t('builder.preview_log_notice'),
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
      className="flex h-full w-full flex-col overflow-hidden bg-background font-sans text-foreground"
    >
      {/* TOP EDITOR HEADER (48px): breadcrumb + name | tabs | actions */}
      <header className="z-20 grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-border bg-card px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/workflows"
            className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[13px] text-text-2 transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={t('builder.back_to_workflows')}
            aria-label={t('builder.back_to_workflows')}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span className="hidden lg:inline">{t('nav.workflows')}</span>
          </Link>
          <span aria-hidden="true" className="hidden shrink-0 text-muted-foreground lg:inline">/</span>
          <input
            data-testid="workflow-title"
            aria-label={t('builder.workflow_name')}
            type="text"
            value={workflowTitle}
            disabled={isLoadingWorkflow || isSavingWorkflow || !workflow}
            onChange={(e) => {
              setWorkflowTitle(e.target.value);
              setIsSaved(false);
            }}
            title={workflowTitle}
            className="h-7 min-w-[72px] flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 text-sm font-semibold text-foreground transition-colors hover:border-border focus:border-primary focus:bg-card focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
          />
          <span className={`inline-flex h-5 shrink-0 items-center gap-[5px] whitespace-nowrap rounded px-1.5 text-xs font-medium before:h-1.5 before:w-1.5 before:rounded-full before:bg-current before:content-[''] ${isSaved ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn'}`}>
            {isSaved ? t('builder.saved') : t('builder.edited')}
          </span>
          <span className="hidden h-5 shrink-0 items-center gap-[5px] whitespace-nowrap rounded bg-pause-bg px-1.5 text-xs font-medium text-pause before:h-1.5 before:w-1.5 before:rounded-full before:bg-current before:content-[''] xl:inline-flex">
            {workflow?.status === 'PUBLISHED' ? t('workflows.status_on') : workflow?.status === 'PAUSED' ? t('workflows.tab_paused') : t('workflows.tab_draft')}
          </span>
          <span
            data-testid="builder-workspace-context"
            title={t('builder.workspace_context').replace('{workspace}', activeWorkspaceId ?? t('builder.workspace_not_selected'))}
            className="sr-only"
          >
            {t('builder.workspace_context').replace('{workspace}', activeWorkspaceId ?? t('builder.workspace_not_selected'))}
          </span>
        </div>

        {/* Editor / Executions tabs */}
        <nav aria-label={t('builder.workflow_sections')} className="hidden h-12 shrink-0 items-stretch gap-5 whitespace-nowrap md:flex">
          <span aria-current="page" className="inline-flex items-center whitespace-nowrap border-b-2 border-foreground px-0.5 text-[13px] font-medium text-foreground">
            {t('builder.section_editor')}
          </span>
          {workflow && (
            <Link
              to={`/workflows/${encodeURIComponent(workflow.id)}/executions`}
              className="inline-flex items-center whitespace-nowrap border-b-2 border-transparent px-0.5 text-[13px] font-medium text-text-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('runs.tab_runs')}
            </Link>
          )}
        </nav>
        <span className="md:hidden" />

        {/* Actions: 2 secondary text buttons, 2 icon-only, 1 primary */}
        <div className="flex shrink-0 items-center justify-end gap-1.5 whitespace-nowrap">
          <button
            data-testid="workflow-generate-ai"
            onClick={() => setIsGeneratePanelOpen(true)}
            disabled={isLoadingWorkflow || !workflow}
            title={t('ai.generate_with_ai')}
            aria-label={t('ai.generate_with_ai')}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles size={15} aria-hidden="true" />
          </button>
          <button
            data-testid="workflow-preview"
            onClick={handlePreviewFlow}
            disabled={isPreviewing}
            title={t('builder.preview_title')}
            aria-label={t('builder.preview_aria')}
            aria-busy={isPreviewing}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70"
          >
            {isPreviewing ? <Loader2 size={15} className="motion-safe:animate-spin" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          </button>
          {workflow?.status === 'PUBLISHED' && (
            <button
              data-testid="workflow-run"
              onClick={handleRunWorkflow}
              className="hidden h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
            >
              <Play size={13} aria-hidden="true" />
              <span>{t('builder.run')}</span>
            </button>
          )}
          <button
            data-testid="workflow-publish"
            onClick={handlePublishWorkflow}
            aria-describedby={publishBlockers.length > 0 ? 'publish-blocker-summary' : undefined}
            title={publishBlockers.length > 0 ? publishBlockers.join('; ') : undefined}
            disabled={publishBlockers.length > 0 || isLoadingWorkflow || isSavingWorkflow || !workflow}
            aria-busy={isSavingWorkflow}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>{t('builder.publish')}</span>
          </button>
          <button
            data-testid="workflow-save"
            onClick={handleSaveDraft}
            disabled={isLoadingWorkflow || isSavingWorkflow || !workflow}
            aria-busy={isSavingWorkflow}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-primary bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:border-primary-hover hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-wait disabled:opacity-50"
          >
            {isSavingWorkflow ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}
            <span>{isSavingWorkflow ? t('builder.saving') : t('builder.save')}</span>
          </button>
        </div>
      </header>

      {isLoadingWorkflow && <div role="status" className="shrink-0 border-b border-border bg-card px-3 py-1.5 text-xs text-text-2">{t('builder.loading')}</div>}
      {workflowError && <div role="alert" data-testid="workflow-builder-error" className="shrink-0 border-b border-err-border bg-err-bg px-3 py-1.5 text-xs text-err">{workflowError}</div>}
      {publishedWebhooks.length > 0 && (
        <section aria-label={t('builder.webhook_credentials_label')} className="shrink-0 space-y-2 border-b border-warn/30 bg-warn-bg px-3 py-2 text-xs text-foreground">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">{t('builder.webhook_credentials_notice')}</p>
            <button type="button" onClick={() => setPublishedWebhooks([])} className="rounded px-2 py-1 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('builder.dismiss')}</button>
          </div>
          {publishedWebhooks.map((webhook) => (
            <div key={webhook.triggerId} className="flex flex-wrap items-center gap-2 font-mono">
              <span>{t('builder.endpoint_key')}: {webhook.endpointKey}</span>
              <span>{t('builder.secret')}: {webhook.secret}</span>
              <button type="button" onClick={() => void navigator.clipboard.writeText(webhook.secret)} className="inline-flex items-center gap-1 rounded border border-border-strong bg-card px-2 py-1 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Copy size={12} /> {t('builder.copy_secret')}
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
          className="shrink-0 border-b border-warn/30 bg-warn-bg px-3 py-1 text-xs text-warn"
        >
          {t('builder.publish_unavailable')}: {publishBlockers[0]}
          {publishBlockers.length > 1 ? ` (+${publishBlockers.length - 1} ${t('builder.more')})` : ''}
        </div>
      )}

      {unsupportedNodeTypes.length > 0 && (
        <div
          data-testid="unsupported-draft-warning"
          role="alert"
          className="shrink-0 border-b border-err-border bg-err-bg px-3 py-1 text-xs text-err"
        >
          {t('builder.unsupported_preserved')}: {unsupportedNodeTypes.join(', ')}. {t('builder.unsupported_remove')}
        </div>
      )}

      {isPreviewing && (
        <div className="shrink-0 border-b border-border bg-subtle px-3 py-1 text-xs text-text-2">
          <span data-testid="workflow-preview-notice">{t('builder.preview_notice')}</span>
        </div>
      )}

      {/* CENTER WORKSPACE LAYOUT */}
      <div className="flex-1 flex min-h-0 relative">
        {/* WORKFLOW CANVAS (CENTER) */}
        <main ref={canvasRef} data-testid="workflow-canvas" className="relative h-full flex-1 overflow-hidden bg-background">
          <ReactFlow
            ariaLabelConfig={ariaLabelConfig}
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
            onInit={(instance) => {
              flowRef.current = instance;
            }}
            fitViewOptions={{
              padding: { top: '15%', left: '15%', bottom: '15%', right: inspectorOpen && selectedNode ? `${INSPECTOR_WIDTH + 24}px` : '15%' },
              minZoom: 0.85,
              maxZoom: 1.2,
            }}
            minZoom={0.2}
            colorMode={theme}
          >
            {showGrid && (
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1}
                color={theme === 'dark' ? 'rgba(237,235,233,0.14)' : 'rgba(28,25,23,0.18)'}
              />
            )}
            <Controls className="workflow-controls !overflow-hidden !rounded-lg !border !border-border !bg-card !shadow-pop" />
            {showMinimap && (
              <MiniMap
                data-testid="workflow-minimap"
                aria-label={t('builder.workflow_minimap')}
                className="workflow-minimap hidden sm:block !bottom-3 !m-0 !h-28 !w-44 !overflow-hidden !rounded-lg !border !border-border !bg-card !shadow-pop"
                style={{ width: 176, height: 112, borderRadius: 8, right: inspectorOpen && selectedNode ? 412 : 12 }}
                nodeColor={(node) => {
                  const status = String(node.data?.status ?? 'idle');
                  return status === 'success' ? (theme === 'dark' ? '#5bc98a' : '#15803d') : status === 'processing' ? (theme === 'dark' ? '#8fb0f5' : '#2b5fd9') : (theme === 'dark' ? '#7d8791' : '#a8a29e');
                }}
                nodeStrokeColor={theme === 'dark' ? '#3d3a37' : '#d6d3d1'}
                nodeStrokeWidth={1.5}
                nodeBorderRadius={4}
                maskColor={theme === 'dark' ? 'rgba(0, 0, 0, 0.45)' : 'rgba(28, 25, 23, 0.1)'}
                maskStrokeColor={theme === 'dark' ? '#3d3a37' : '#d6d3d1'}
                maskStrokeWidth={1.5}
                pannable
                zoomable
              />
            )}
          </ReactFlow>

          {/* Floating canvas toolbar */}
          <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-pop">
            <button
              type="button"
              data-testid="workflow-add-step"
              onClick={() => {
                setSearchQuery('');
                setPaletteOpen(true);
              }}
              disabled={isLoadingWorkflow || !workflow}
              aria-haspopup="dialog"
              aria-keyshortcuts="Control+K Meta+K"
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={13} strokeWidth={2} aria-hidden="true" />
              {t('builder.add_step')}
              <kbd className="ml-1 rounded border border-primary-foreground/30 px-1 font-mono text-[10px] leading-4">⌘K</kbd>
            </button>
            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
            <button
              type="button"
              onClick={() => setShowGrid(!showGrid)}
              aria-pressed={showGrid}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${showGrid ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-subtle hover:text-foreground'}`}
              title={t('builder.toggle_grid')}
              aria-label={t('builder.toggle_grid')}
            >
              <Grid size={14} />
            </button>
            <button
              type="button"
              onClick={() => setShowMinimap(!showMinimap)}
              aria-pressed={showMinimap}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${showMinimap ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-subtle hover:text-foreground'}`}
              title={t('builder.toggle_minimap')}
              aria-label={t('builder.toggle_minimap')}
            >
              <Map size={14} />
            </button>
          </div>

          {/* Add-step palette (⌘K) */}
          {paletteOpen && (
            <div className="absolute inset-0 z-20 flex items-start justify-center pt-[12%]">
              <button
                type="button"
                aria-label={t('builder.close_palette')}
                onClick={() => setPaletteOpen(false)}
                className="absolute inset-0 cursor-default bg-foreground/20"
              />
              <section
                role="dialog"
                aria-modal="true"
                aria-label={t('builder.add_step')}
                data-testid="workflow-palette"
                className="relative flex max-h-[min(480px,70%)] w-[480px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-pop"
              >
                <div className="flex items-center gap-2 border-b border-border px-3">
                  <Search size={14} aria-hidden="true" className="text-muted-foreground" />
                  <input
                    autoFocus
                    type="text"
                    placeholder={t('builder.search_actions')}
                    aria-label={t('builder.search_actions')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <span data-testid="workflow-palette-count" className="font-mono text-[11px] text-muted-foreground">
                    {PALETTE_CATALOG.reduce((total, category) => total + category.items.length, 0)} {t('builder.available')}
                  </span>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
                  {PALETTE_CATALOG.map((cat) => {
                    const items = cat.items.filter((item) => {
                      const name = item.nameKey ? t(item.nameKey) : item.title;
                      return name.toLowerCase().includes(searchQuery.toLowerCase());
                    });
                    if (items.length === 0) return null;
                    return (
                      <div key={cat.categoryKey}>
                        <span className="block px-2 pb-1 text-[11px] font-medium text-muted-foreground">{t(cat.categoryKey)}</span>
                        {items.map((item) => {
                          const ItemIcon = item.icon;
                          return (
                            <button
                              key={item.type}
                              type="button"
                              data-testid="workflow-palette-item"
                              data-node-type={item.type}
                              disabled={isLoadingWorkflow || !workflow}
                              onClick={() => {
                                handleAddCatalogItem(item.type, item.nameKey ? t(item.nameKey) : item.title, item.nameKey ?? '');
                                setPaletteOpen(false);
                              }}
                              aria-label={item.nameKey ? t(item.nameKey) : item.title}
                              className="group flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md border border-transparent px-2 text-left transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-subtle text-text-2">
                                <span aria-hidden="true" className={`absolute -left-px bottom-1 top-1 w-[3px] rounded-r-sm ${item.type.startsWith('trigger') ? 'bg-t-trigger' : item.type.startsWith('ai') || item.type.startsWith('agent') ? 'bg-t-ai' : item.type.startsWith('logic') ? 'bg-t-logic' : 'bg-t-action'}`} />
                                <ItemIcon size={14} />
                              </span>
                              <span className="truncate text-[13px] font-medium text-foreground">{item.nameKey ? t(item.nameKey) : item.title}</span>
                              <span className="ml-auto hidden max-w-[45%] truncate text-xs text-muted-foreground sm:block">{item.descKey ? t(item.descKey) : item.description}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}
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
          className="absolute inset-y-0 right-0 z-10 flex w-[400px] max-w-full flex-col border-l border-border bg-card shadow-pop"
        >
          {/* Inspector Header */}
          <div className="flex items-center justify-between gap-2 border-b border-border p-3.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {selectedNode.data.nameKey
                  ? t(String(selectedNode.data.nameKey))
                  : (selectedNode.data.name as string) || t('builder.step_inspector')}
              </span>
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {(selectedNode.data.id as string) || selectedNodeType}
              </span>
            </div>
            <span className={selectedNodeReadiness?.state === 'ready'
              ? 'shrink-0 rounded bg-ok-bg px-1.5 py-0.5 text-[11px] font-medium text-ok'
              : 'shrink-0 rounded bg-warn-bg px-1.5 py-0.5 text-[11px] font-medium text-warn'}>
              ● {(selectedNodeReadiness ? t(selectedNodeReadiness.labelKey) : null) ?? t('builder.ready')}
            </span>
          </div>

          {selectedNodeReadinessMessage && (
            <div
              data-testid="integration-readiness"
              role="status"
              className="border-b border-warn/30 bg-warn-bg px-3 py-2 text-[11px] leading-relaxed text-warn"
            >
              {selectedNodeReadinessMessage}
              {isUnsupportedNode && <span className="block">{t('builder.cfg.preserved_readonly')}</span>}
            </div>
          )}
          {selectedNodeType === 'trigger.webhook' && (
            <div data-testid="webhook-endpoint-readiness" role="status" className="border-b border-border bg-subtle px-3 py-2 text-[11px] text-text-2">
              {t('builder.cfg.webhook_provision')}
            </div>
          )}

          {/* Inspector Tabs */}
          <div className="flex gap-1 border-b border-border bg-card px-2 text-xs">
            {(['config', 'input', 'output', 'logs'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setInspectorTab(tab)}
                className={`-mb-px flex-1 border-b-2 py-2 text-center text-[13px] font-medium transition-colors ${
                  inspectorTab === tab
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
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
                  <p className="text-[11px] leading-relaxed text-text-2">
                    {t('builder.cfg.unsupported_body')}
                  </p>
                  <pre className="max-h-72 overflow-auto rounded border border-border bg-subtle p-2 font-mono text-[10px] text-text-2">
                    {JSON.stringify(selectedNodeConfig, null, 2)}
                  </pre>
                </div>
              ) : selectedNodeType === 'logic.condition' ? (
                <div data-testid="condition-config" className="space-y-3">
                  <div>
                    <label htmlFor="condition-left" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.cond_left')}</label>
                    <input
                      id="condition-left"
                      data-testid="condition-left"
                      value={String(selectedNodeConfig.left ?? '')}
                      placeholder="{{ trigger.input.email }}"
                      onChange={(event) => updateSelectedNodeConfig({ left: event.target.value })}
                      className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor="condition-operator" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.cond_operator')}</label>
                    <select
                      id="condition-operator"
                      data-testid="condition-operator"
                      value={String(selectedNodeConfig.operator ?? 'eq')}
                      onChange={(event) => updateSelectedNodeConfig({ operator: event.target.value })}
                      className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                    >
                      {CONDITION_OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{t(operator.labelKey)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="condition-right" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.cond_right')}</label>
                    <input
                      id="condition-right"
                      data-testid="condition-right"
                      value={String(selectedNodeConfig.right ?? '')}
                      placeholder="500 or {{ variables.threshold }}"
                      onChange={(event) => updateSelectedNodeConfig({ right: event.target.value })}
                      className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">{t('builder.cfg.cond_hint')}</p>
                </div>
              ) : selectedNodeType === 'trigger.schedule' ? (
                <div data-testid="schedule-config" className="space-y-3">
                  <div>
                    <label htmlFor="schedule-cron" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.cron')}</label>
                    <input
                      id="schedule-cron"
                      data-testid="schedule-cron"
                      value={String(selectedNodeConfig.cron ?? '')}
                      placeholder="0 0 9 * * *"
                      onChange={(event) => updateSelectedNodeConfig({ cron: event.target.value })}
                      className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor="schedule-timezone" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.timezone')}</label>
                    <input
                      id="schedule-timezone"
                      data-testid="schedule-timezone"
                      value={String(selectedNodeConfig.timezone ?? '')}
                      placeholder="Asia/Ho_Chi_Minh"
                      onChange={(event) => updateSelectedNodeConfig({ timezone: event.target.value })}
                      className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              ) : selectedNodeType === 'trigger.webhook' ? (
                <div data-testid="webhook-config" className="space-y-3">
                  <p className="text-[11px] leading-relaxed text-text-2">{t('builder.cfg.webhook_body')}</p>
                  <div className="rounded border border-border bg-subtle px-2.5 py-2 text-[11px] text-text-2">
                    {t('builder.cfg.method_prefix')}<span className="font-mono">POST</span>
                  </div>
                </div>
              ) : selectedNodeType === 'trigger.manual' ? (
                <div>
                  <label htmlFor="manual-button-label" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.button_label')}</label>
                  <input
                    id="manual-button-label"
                    value={String(selectedNodeConfig.buttonLabel ?? '')}
                    onChange={(event) => updateSelectedNodeConfig({ buttonLabel: event.target.value })}
                    className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
              ) : selectedNodeType === 'trigger.telegram' ? (
                <div data-testid="telegram-trigger-config" className="rounded border border-warn/30 bg-warn-bg p-3 text-[11px] leading-relaxed text-warn">
                  {t('builder.cfg.telegram_trigger_body')}
                </div>
              ) : selectedNodeType === 'telegram.send_message' ? (
                <div data-testid="telegram-send-config" className="space-y-3">
                  <div>
                    <label htmlFor="telegram-chat-id" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.chat_id')}</label>
                    <input id="telegram-chat-id" value={String(selectedNodeConfig.chatId ?? '')} onChange={(event) => updateSelectedNodeConfig({ chatId: event.target.value })} className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary" />
                  </div>
                  <div>
                    <label htmlFor="telegram-text" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.message')}</label>
                    <textarea id="telegram-text" rows={3} value={String(selectedNodeConfig.text ?? '')} onChange={(event) => updateSelectedNodeConfig({ text: event.target.value })} className="w-full resize-y rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary" />
                  </div>
                </div>
              ) : selectedNodeType === 'http.request' ? (
                <div data-testid="http-request-config" className="space-y-3">
                  <div>
                    <label htmlFor="http-method" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.method')}</label>
                    <select id="http-method" value={String(selectedNodeConfig.method ?? 'GET')} onChange={(event) => updateSelectedNodeConfig({ method: event.target.value })} className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary">
                      {['GET', 'POST', 'PUT', 'DELETE'].map((method) => <option key={method}>{method}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="http-url" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.url')}</label>
                    <input id="http-url" value={String(selectedNodeConfig.url ?? '')} onChange={(event) => updateSelectedNodeConfig({ url: event.target.value })} placeholder="https://example.com/api" className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary" />
                  </div>
                  <div>
                    <label htmlFor="http-body" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.body')}</label>
                    <textarea id="http-body" rows={3} value={String(selectedNodeConfig.body ?? '')} onChange={(event) => updateSelectedNodeConfig({ body: event.target.value })} placeholder={t('builder.cfg.body_placeholder')} className="w-full resize-y rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary" />
                  </div>
                  <p className="text-[10px] text-muted-foreground">{t('builder.cfg.http_hint')}</p>
                </div>
              ) : selectedNodeType === 'email.send' ? (
                <div data-testid="email-config" className="space-y-3">
                  <div>
                    <label htmlFor="email-connection" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.gmail_connection')}</label>
                    <select
                      id="email-connection"
                      data-testid="email-connection"
                      value={String(selectedNodeConfig.connectionId ?? '')}
                      // Omit the key when cleared: the Workflow Service rejects an empty connectionId even in drafts.
                      onChange={(event) => updateSelectedNodeConfig({ connectionId: event.target.value || undefined })}
                      disabled={isLoadingConnections}
                      className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
                    >
                      <option value="">{isLoadingConnections ? t('builder.cfg.loading_connections') : t('builder.cfg.select_gmail')}</option>
                      {gmailConnections.map((connection) => (
                        <option key={connection.id} value={connection.id}>{connection.name}</option>
                      ))}
                      {String(selectedNodeConfig.connectionId ?? '').trim()
                        && !gmailConnections.some((connection) => connection.id === selectedNodeConfig.connectionId) && (
                        <option value={String(selectedNodeConfig.connectionId)}>{t('builder.cfg.unavailable_connection')}</option>
                      )}
                    </select>
                    {!isLoadingConnections && gmailConnections.length === 0 && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {t('builder.cfg.no_gmail')} <Link to="/connections" className="text-run underline">{t('builder.cfg.connect_gmail')}</Link> {t('builder.cfg.connect_first')}
                      </p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="email-to" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.recipient')}</label>
                    <input id="email-to" value={String(selectedNodeConfig.to ?? '')} onChange={(event) => updateSelectedNodeConfig({ to: event.target.value })} className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary" />
                  </div>
                  <div>
                    <label htmlFor="email-subject" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.subject')}</label>
                    <input id="email-subject" value={String(selectedNodeConfig.subject ?? '')} onChange={(event) => updateSelectedNodeConfig({ subject: event.target.value })} className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary" />
                  </div>
                  <div>
                    <label htmlFor="email-body" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.body')}</label>
                    <textarea id="email-body" rows={3} value={String(selectedNodeConfig.body ?? '')} onChange={(event) => updateSelectedNodeConfig({ body: event.target.value })} className="w-full resize-y rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary" />
                  </div>
                </div>
              ) : selectedNodeType.startsWith('ai.') ? (
                <div data-testid="ai-config" className="space-y-3">
                  {selectedNodeType === 'ai.extract' && (
                    <div className="space-y-3">
                      <OutputSchemaEditor
                        value={selectedNodeConfig.outputSchema}
                        legacyDescription={typeof selectedNodeConfig.schemaDescription === 'string' ? selectedNodeConfig.schemaDescription : undefined}
                        onChange={(outputSchema) => updateSelectedNodeConfig({ outputSchema })}
                      />
                      <div>
                        <label htmlFor="ai-input-text" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.input_text')}</label>
                        <input id="ai-input-text" value={String(selectedNodeConfig.text ?? '')} onChange={(event) => updateSelectedNodeConfig({ text: event.target.value })} className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary" />
                      </div>
                    </div>
                  )}
                  {selectedNodeType === 'ai.classify' && (
                    <div>
                      <label htmlFor="ai-categories" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.categories')}</label>
                      <input id="ai-categories" value={Array.isArray(selectedNodeConfig.categories) ? selectedNodeConfig.categories.join(', ') : ''} onChange={(event) => updateSelectedNodeConfig({ categories: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary" />
                    </div>
                  )}
                  {selectedNodeType === 'ai.summarize' && (
                    <div>
                      <label htmlFor="ai-max-length" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.max_length')}</label>
                      <input id="ai-max-length" type="number" min="1" value={String(selectedNodeConfig.maxLength ?? 200)} onChange={(event) => updateSelectedNodeConfig({ maxLength: Number(event.target.value) })} className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary" />
                    </div>
                  )}
                </div>
              ) : selectedNodeType === 'ocr.extract' ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-run/30 bg-run-bg p-3">
                    <div className="flex items-start gap-2">
                      <Scan size={16} className="mt-0.5 shrink-0 text-run" />
                      <div>
                        <p className="text-xs font-semibold text-foreground">{t('ocr.title')}</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-text-2">{t('ocr.description')}</p>
                      </div>
                    </div>
                  </div>

                  <div data-testid="ocr-workflow-source" className="space-y-2 rounded border border-border bg-subtle p-2.5">
                    <p className="text-[11px] font-semibold text-text-2">{t('builder.cfg.ocr_source')}</p>
                    <div>
                      <label htmlFor="ocr-artifact-id" className="mb-1 block text-[10px] font-medium text-text-2">{t('builder.cfg.artifact_id')}</label>
                      <input
                        id="ocr-artifact-id"
                        data-testid="ocr-artifact-id"
                        value={String(selectedNodeConfig.artifactId ?? '')}
                        onChange={(event) => updateSelectedNodeConfig({ artifactId: event.target.value, fileUrl: '' })}
                        className="w-full rounded border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label htmlFor="ocr-file-url" className="mb-1 block text-[10px] font-medium text-text-2">{t('builder.cfg.file_url')}</label>
                      <input
                        id="ocr-file-url"
                        data-testid="ocr-file-url"
                        value={String(selectedNodeConfig.fileUrl ?? '')}
                        onChange={(event) => updateSelectedNodeConfig({ fileUrl: event.target.value, artifactId: '' })}
                        placeholder="https://..."
                        className="w-full rounded border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <p className="text-[10px] leading-relaxed text-muted-foreground">{t('builder.cfg.ocr_source_hint')}</p>
                  </div>

                  <div>
                    <label htmlFor="ocr-file-input" className="mb-1 block text-[11px] font-medium text-text-2">
                      {t('builder.cfg.ocr_try')}
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border-strong bg-subtle px-2.5 py-2 text-xs text-text-2 transition-colors hover:border-run/30 hover:bg-run-bg">
                      <Upload size={14} className="shrink-0 text-run" />
                      <span className="min-w-0 flex-1 truncate">{currentUserOcrFile?.name ?? t('ocr.choose_file')}</span>
                      <input
                        id="ocr-file-input"
                        data-testid="ocr-file-input"
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
                        onChange={handleOcrFileChange}
                        disabled={isOcrRunning}
                        className="sr-only"
                      />
                    </label>
                    <p className="mt-1 text-[10px] text-muted-foreground">{t('ocr.accepted')}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="ocr-language" className="mb-1 block text-[11px] font-medium text-text-2">
                        {t('ocr.language')}
                      </label>
                      <select
                        id="ocr-language"
                        value={ocrLanguage}
                        onChange={(event) => {
                          setOcrLanguage(event.target.value);
                          updateSelectedNodeConfig({ language: event.target.value });
                        }}
                        className="w-full rounded-md border border-border-strong bg-card px-2 py-1.5 font-mono text-xs text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                      >
                        <option value="vi+en">{t('builder.language.vi_en')}</option>
                        <option value="vi">{t('settings.vietnamese')}</option>
                        <option value="en">{t('settings.english')}</option>
                      </select>
                    </div>
                    <label className="mt-5 flex items-center gap-2 text-[11px] text-text-2">
                      <input
                        type="checkbox"
                        checked={ocrDetectTables}
                        onChange={(event) => {
                          setOcrDetectTables(event.target.checked);
                          updateSelectedNodeConfig({ detectTables: event.target.checked });
                        }}
                        className="size-3.5 accent-run"
                      />
                      {t('ocr.detect_tables')}
                    </label>
                  </div>

                  {visibleOcrError && (
                    <div
                      role="alert"
                      data-testid="ocr-error"
                      className="rounded border border-err-border bg-err-bg p-2.5 text-[11px] text-err"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-mono text-[10px] font-semibold uppercase bg-err-bg px-1 py-0.5 rounded">
                          {visibleOcrError.code}
                        </span>
                        {visibleOcrError.retryable && (
                          <span className="text-[10px] text-warn font-medium">
                            {t('builder.cfg.retryable')}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 leading-relaxed">{visibleOcrError.message}</p>
                      {visibleOcrError.retryable && currentUserOcrFile && activeWorkspaceId && (
                        <button
                          type="button"
                          data-testid="ocr-retry"
                          onClick={handleRetryOcr}
                          disabled={isOcrRunning}
                          className="mt-2 rounded border border-err-border px-2 py-1 text-[10px] font-semibold text-err transition-colors hover:bg-err-bg disabled:cursor-wait disabled:opacity-70"
                        >
                          {t('builder.cfg.retry_ocr')}
                        </button>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    data-testid="ocr-submit"
                    onClick={handleRunOcr}
                    disabled={isOcrRunning}
                    className="flex w-full items-center justify-center gap-1.5 rounded bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
                  >
                    {isOcrRunning ? <Loader2 size={14} className="animate-spin" /> : <Scan size={14} />}
                    {isOcrRunning ? t('ocr.processing') : t('ocr.extract_text')}
                  </button>

                  {visibleOcrResult && (
                    <div data-testid="ocr-result" className="space-y-3 rounded-lg border border-border bg-subtle p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-foreground">{t('ocr.result')}</span>
                          {visibleOcrResult.metadata.quality === 'OK' && (
                            <span data-testid="ocr-quality-badge" className="rounded border border-ok/30 bg-ok-bg px-1.5 py-0.5 font-mono text-[10px] font-medium text-ok">
                              ● OK
                            </span>
                          )}
                          {visibleOcrResult.metadata.quality === 'LOW_CONFIDENCE' && (
                            <span data-testid="ocr-quality-badge" className="rounded border border-warn/30 bg-warn-bg px-1.5 py-0.5 font-mono text-[10px] font-medium text-warn">
                              ▲ {t('builder.cfg.low_confidence')}
                            </span>
                          )}
                          {visibleOcrResult.metadata.quality === 'EMPTY' && (
                            <span data-testid="ocr-quality-badge" className="rounded border border-border-strong bg-muted-foreground px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                              ○ Empty
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={clearOcrResult}
                          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted"
                          aria-label={t('ocr.dismiss_result')}
                        >
                          <X size={13} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <span className="rounded bg-card/70 px-2 py-1.5 text-text-2">{t('ocr.pages')}: <strong>{visibleOcrResult.document.pages}</strong></span>
                        <span className="rounded bg-card/70 px-2 py-1.5 text-text-2">
                          {t('ocr.confidence')}: <strong>{visibleOcrResult.confidence !== null ? `${(visibleOcrResult.confidence * 100).toFixed(1)}%` : '—'}</strong>
                        </span>
                        <span className="rounded bg-card/70 px-2 py-1.5 text-text-2">
                          {t('ocr.mime_type')}: <strong>{visibleOcrResult.document.mimeType}</strong>
                        </span>
                        <span className="rounded bg-card/70 px-2 py-1.5 text-text-2">
                          {t('ocr.tables')}: <strong>{visibleOcrResult.tables?.length ?? 0}</strong>
                        </span>
                      </div>

                      {visibleOcrResult.metadata.quality === 'EMPTY' && (
                        <div data-testid="ocr-empty-note" className="rounded border border-warn/30 bg-warn-bg p-2 text-[11px] text-warn">
                          {t('ocr.empty_text')}
                        </div>
                      )}

                      {visibleOcrResult.metadata.warnings && visibleOcrResult.metadata.warnings.length > 0 && (
                        <div data-testid="ocr-warnings" className="space-y-1">
                          <span className="block text-[10px] font-medium text-warn">
                            {t('ocr.warnings')} ({visibleOcrResult.metadata.warnings.length})
                          </span>
                          <div className="space-y-1">
                            {visibleOcrResult.metadata.warnings.map((w, idx) => (
                              <div key={idx} className="rounded border border-warn/30 bg-warn-bg px-2 py-1 text-[10px] text-warn">
                                <span className="font-mono font-semibold">[{w.code}]</span>{' '}
                                {w.page ? `(p.${w.page}) ` : ''}
                                {w.message}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <span className="mb-1 block text-[10px] font-medium text-text-2">{t('ocr.raw_text')}</span>
                        <pre data-testid="ocr-raw-text" className="max-h-24 overflow-auto whitespace-pre-wrap rounded border border-border bg-card/70 p-2 font-mono text-[10px] leading-relaxed text-text-2">{visibleOcrResult.text.rawText || '(No text detected)'}</pre>
                      </div>
                    </div>
                  )}
                </div>
              ) : isGoogleNode ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-run/30 bg-run-bg p-3">
                    <div className="flex items-start gap-2">
                      {isGoogleSheetsNode ? (
                        <FileSpreadsheet size={16} className="mt-0.5 shrink-0 text-run" />
                      ) : (
                        <FileText size={16} className="mt-0.5 shrink-0 text-run" />
                      )}
                      <div>
                        <p className="text-xs font-semibold text-foreground">{t('builder.google.title')}</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-text-2">{t('builder.google.description')}</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="google-connection" className="mb-1 block text-[11px] font-medium text-text-2">
                      {t('builder.google.connection')}
                    </label>
                    <select
                      id="google-connection"
                      data-testid="google-connection"
                      value={String(selectedNodeConfig.connectionId ?? '')}
                      onChange={(event) => updateSelectedNodeConfig({ connectionId: event.target.value })}
                      className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                    >
                      <option value="">{t('builder.cfg.select_authorized')}</option>
                      {String(selectedNodeConfig.connectionId ?? '').trim() && (
                        <option value={String(selectedNodeConfig.connectionId)}>{t('builder.cfg.existing_connection')}</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="google-operation" className="mb-1 block text-[11px] font-medium text-text-2">
                      {t('builder.google.operation')}
                    </label>
                    <select
                      id="google-operation"
                      value={googleOperation}
                      onChange={(event) => updateSelectedNodeConfig({ operation: event.target.value })}
                      className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
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
                        <label htmlFor="google-spreadsheet-id" className="mb-1 block text-[11px] font-medium text-text-2">
                          {t('builder.google.spreadsheet_id')}
                        </label>
                        <input
                          id="google-spreadsheet-id"
                          type="text"
                          value={String(selectedNodeConfig.spreadsheetId ?? '')}
                          onChange={(event) => updateSelectedNodeConfig({ spreadsheetId: event.target.value })}
                          className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                        />
                      </div>

                      {googleOperation === 'append' ? (
                        <>
                          <div>
                            <label htmlFor="google-sheet-name" className="mb-1 block text-[11px] font-medium text-text-2">
                              {t('builder.google.sheet_name')}
                            </label>
                            <input
                              id="google-sheet-name"
                              type="text"
                              value={String(selectedNodeConfig.sheetName ?? '')}
                              onChange={(event) => updateSelectedNodeConfig({ sheetName: event.target.value })}
                              className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                            />
                          </div>
                          <div>
                            <label htmlFor="google-row-variable" className="mb-1 block text-[11px] font-medium text-text-2">
                              {t('builder.google.row_variable')}
                            </label>
                            <input
                              id="google-row-variable"
                              type="text"
                              value={String(selectedNodeConfig.rowDataVariable ?? '')}
                              onChange={(event) => updateSelectedNodeConfig({ rowDataVariable: event.target.value })}
                              className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                            />
                          </div>
                        </>
                      ) : (
                        <div>
                          <label htmlFor="google-range" className="mb-1 block text-[11px] font-medium text-text-2">
                            {t('builder.google.range')}
                          </label>
                          <input
                            id="google-range"
                            type="text"
                            value={String(selectedNodeConfig.range ?? '')}
                            onChange={(event) => updateSelectedNodeConfig({ range: event.target.value })}
                            className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      )}

                      {googleOperation === 'update' && (
                        <div>
                          <label htmlFor="google-value-variable" className="mb-1 block text-[11px] font-medium text-text-2">
                            {t('builder.google.value_variable')}
                          </label>
                          <input
                            id="google-value-variable"
                            type="text"
                            value={String(selectedNodeConfig.valueVariable ?? '')}
                            onChange={(event) => updateSelectedNodeConfig({ valueVariable: event.target.value })}
                            className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      )}
                    </>
                  )}

                  {isGoogleDocsNode && googleOperation === 'create' && (
                    <div>
                      <label htmlFor="google-document-title" className="mb-1 block text-[11px] font-medium text-text-2">
                        {t('builder.google.title_field')}
                      </label>
                      <input
                        id="google-document-title"
                        type="text"
                        value={String(selectedNodeConfig.title ?? '')}
                        onChange={(event) => updateSelectedNodeConfig({ title: event.target.value })}
                        className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  )}

                  {isGoogleDocsNode && googleOperation !== 'create' && (
                    <div>
                      <label htmlFor="google-document-id" className="mb-1 block text-[11px] font-medium text-text-2">
                        {t('builder.google.document_id')}
                      </label>
                      <input
                        id="google-document-id"
                        type="text"
                        value={String(selectedNodeConfig.documentId ?? '')}
                        onChange={(event) => updateSelectedNodeConfig({ documentId: event.target.value })}
                        className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  )}

                  {isGoogleDocsNode && (googleOperation === 'create' || googleOperation === 'append') && (
                    <div>
                      <label htmlFor="google-content-variable" className="mb-1 block text-[11px] font-medium text-text-2">
                        {t('builder.google.content_variable')}
                      </label>
                      <input
                        id="google-content-variable"
                        type="text"
                        value={String(selectedNodeConfig.contentVariable ?? '')}
                        onChange={(event) => updateSelectedNodeConfig({ contentVariable: event.target.value })}
                        className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 font-mono text-xs text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  )}

                  <p className="text-[10px] leading-relaxed text-muted-foreground">{t('builder.google.id_hint')}</p>
                </div>
              ) : (
                <div data-testid="node-config-fallback" className="text-[11px] leading-relaxed text-muted-foreground">
                  {t('builder.cfg.no_config')}
                </div>
              )
            )}

            {inspectorTab === 'input' && (
              <div data-testid="workflow-no-input" className="text-[11px] text-muted-foreground">
                {t('builder.cfg.no_input')}
              </div>
            )}

            {inspectorTab === 'output' && (
              <div data-testid="workflow-no-output" className="text-[11px] text-muted-foreground">
                {t('builder.cfg.no_output')}
              </div>
            )}

            {inspectorTab === 'logs' && (
              <div data-testid="workflow-no-node-logs" className="text-[11px] text-muted-foreground">
                {t('builder.cfg.no_logs')}
              </div>
            )}
          </div>

          {/* Inspector Footer Actions */}
          <div className="p-3 border-t border-border flex items-center justify-between bg-subtle">
            <button
              data-testid="workflow-preview-inspector"
              onClick={handlePreviewFlow}
              disabled={isPreviewing}
              aria-label={t('builder.preview_aria')}
              className="px-2.5 py-1 text-xs font-medium bg-muted hover:bg-muted text-foreground rounded transition-colors"
            >
              {t('builder.preview_flow')}
            </button>
            <button
              data-testid="workflow-save-inspector"
              onClick={handleSaveDraft}
              disabled={isLoadingWorkflow || isSavingWorkflow || !workflow}
              aria-busy={isSavingWorkflow}
              className="rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-50"
            >
              {t('builder.save_changes')}
            </button>
          </div>
        </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* BOTTOM TELEMETRY CONSOLE STREAM */}
      <div className="z-20 shrink-0 border-t border-border bg-card">
        {/* Telemetry Bar Header */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={telemetryOpen}
          onClick={() => setTelemetryOpen(!telemetryOpen)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setTelemetryOpen(!telemetryOpen);
            }
          }}
          className="flex h-8 cursor-pointer items-center justify-between border-b border-border bg-card px-3 font-mono text-[11px] transition-colors hover:bg-muted/60 sm:px-4"
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              <Terminal size={13} className="text-text-2" />
              {t('builder.draft_activity')}
            </span>
            <span aria-hidden="true" className="text-border-strong">|</span>
            <span className="text-muted-foreground">{t('builder.no_execution_history')}</span>
          </div>

          <div className="flex items-center gap-2 text-muted-foreground">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLogs([]);
              }}
              className="rounded px-1.5 py-0.5 text-[10px] hover:bg-muted hover:text-foreground"
            >
          {t('builder.telemetry.clear_logs')}
            </button>
            <ChevronDown size={14} className={`transform transition-transform ${telemetryOpen ? '' : 'rotate-180'}`} />
          </div>
        </div>

        {/* Console Log Content */}
        {telemetryOpen && (
          <div className="h-28 overflow-y-auto bg-subtle p-3 font-mono text-[11px] text-muted-foreground sm:px-4">
            <p data-testid="workflow-telemetry-preview-notice" role="note" className="mb-2 text-muted-foreground">
              {t('builder.preview_log_notice')}
            </p>
            <div className="space-y-1 text-[11px]">
              {logs.length === 0 && (
                <p data-testid="workflow-telemetry-empty" className="text-muted-foreground">
                  {t('builder.cfg.no_telemetry')}
                </p>
              )}
              {logs.map((log) => (
                <div key={log.id} className="flex items-center gap-2">
                  <span className="text-muted-foreground text-[10px]">{log.time}</span>
                  <span
                    className={
                      log.level === 'success'
                        ? 'text-ok'
                        : log.level === 'warn'
                        ? 'text-warn'
                        : 'text-muted-foreground'
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
      <GenerateWorkflowPanel
        open={isGeneratePanelOpen}
        onClose={() => setIsGeneratePanelOpen(false)}
        onReady={handleGenerateReady}
      />
    </div>
  );
};
