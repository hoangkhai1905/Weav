import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
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
  Sparkles,
  SlidersHorizontal,
  Search,
  Grid,
  Map,
  Terminal,
  Zap,
  CheckCircle2,
  Loader2,
  Globe,
  GitBranch,
  Mail,
  FileCode,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  FileImage,
  FileSpreadsheet,
  FileText,
  Scan,
  Upload,
  X,
} from 'lucide-react';
import { CustomWorkflowNode } from '../components/builder/CustomWorkflowNode';
import { ExecutionEdge } from '../components/builder/ExecutionEdge';
import { useUIStore } from '../store/useUIStore';
import { useI18nStore } from '../store/useI18nStore';
import { useAuthStore } from '../store/useAuthStore';
import { ocrApi, OcrApiError, type OcrExtractionResult } from '../api/ocr.api';
import { NODE_CATALOG } from '../lib/constants/nodeCatalog';

// Preset Nodes for Initial Canvas State
const INITIAL_NODES: Node[] = [
  {
    id: 'node-webhook',
    type: 'customNode',
    position: { x: 80, y: 180 },
    data: {
      id: 'webhook_inbound_v1',
      name: 'Webhook Trigger',
      nameKey: 'builder.node.webhook',
      nodeType: 'trigger.webhook',
      status: 'success',
      executionTime: '120ms',
      config: { endpoint: '/api/v1/webhooks/orders', method: 'POST' },
    },
  },
  {
    id: 'node-extract',
    type: 'customNode',
    position: { x: 420, y: 180 },
    data: {
      id: 'extract_order_v1',
      name: 'AI Extract Core',
      nameKey: 'builder.node.ai_extract',
      nodeType: 'ai.extract',
      status: 'idle',
      executionTime: '850ms',
      config: {
        model: 'gpt-4o-mini',
        inputPayload: '{{ $json.body.order_payload }}',
        prompt: 'Extract order items, quantities, customer address, and calculate total price.',
        schema: ['order_id', 'items[]', 'total_amount', 'shipping_address'],
      },
    },
  },
  {
    id: 'node-condition',
    type: 'customNode',
    position: { x: 760, y: 180 },
    data: {
      id: 'condition_check_v1',
      name: 'High Value Check',
      nameKey: 'builder.node.condition',
      nodeType: 'logic.condition',
      status: 'idle',
      executionTime: '45ms',
      config: { condition: '{{ $json.total_amount > 500 }}' },
    },
  },
  {
    id: 'node-notify',
    type: 'customNode',
    position: { x: 1100, y: 180 },
    data: {
      id: 'notify_slack_v1',
      name: 'Notify Priority Queue',
      nameKey: 'builder.node.email',
      nodeType: 'email.send',
      status: 'idle',
      executionTime: '210ms',
      config: { channel: '#priority-orders', template: 'order_alert_v2' },
    },
  },
];

const INITIAL_EDGES: Edge[] = [
  {
    id: 'edge-1-2',
    source: 'node-webhook',
    target: 'node-extract',
    type: 'execution',
    animated: false,
    style: { stroke: '#94a3b8', strokeWidth: 1.75 },
  },
  {
    id: 'edge-2-3',
    source: 'node-extract',
    target: 'node-condition',
    type: 'execution',
    animated: false,
    style: { stroke: '#94a3b8', strokeWidth: 1.75 },
  },
  {
    id: 'edge-3-4',
    source: 'node-condition',
    target: 'node-notify',
    type: 'execution',
    animated: false,
    style: { stroke: '#94a3b8', strokeWidth: 1.75 },
  },
];

// Step Palette Catalog Items
const PALETTE_CATALOG = [
  {
    categoryKey: 'builder.category.triggers',
    items: [
      { type: 'trigger.webhook', nameKey: 'builder.node.webhook', descKey: 'builder.node.webhook_desc', icon: Globe },
      { type: 'trigger.schedule', nameKey: 'builder.node.schedule', descKey: 'builder.node.schedule_desc', icon: Zap },
      { type: 'trigger.manual', nameKey: 'builder.node.manual', descKey: 'builder.node.manual_desc', icon: Play },
    ],
  },
  {
    categoryKey: 'builder.category.ai',
    items: [
      { type: 'ai.extract', nameKey: 'builder.node.ai_extract', descKey: 'builder.node.ai_extract_desc', icon: Sparkles },
      { type: 'ai.classify', nameKey: 'builder.node.ai_classify', descKey: 'builder.node.ai_classify_desc', icon: ShieldCheck },
      { type: 'ai.summarize', nameKey: 'builder.node.ai_summarize', descKey: 'builder.node.ai_summarize_desc', icon: FileCode },
    ],
  },
  {
    categoryKey: 'builder.category.documents',
    items: [
      { type: 'ocr.extract', nameKey: 'builder.node.ocr', descKey: 'builder.node.ocr_desc', icon: FileImage },
    ],
  },
  {
    categoryKey: 'builder.category.logic',
    items: [
      { type: 'logic.condition', nameKey: 'builder.node.condition', descKey: 'builder.node.condition_desc', icon: GitBranch },
      { type: 'logic.filter', nameKey: 'builder.node.filter', descKey: 'builder.node.filter_desc', icon: SlidersHorizontal },
    ],
  },
  {
    categoryKey: 'builder.category.integrations',
    items: [
      { type: 'email.send', nameKey: 'builder.node.email', descKey: 'builder.node.email_desc', icon: Mail },
      { type: 'http.request', nameKey: 'builder.node.http', descKey: 'builder.node.http_desc', icon: Globe },
      { type: 'google.sheets', nameKey: 'builder.node.google_sheets', descKey: 'builder.node.google_sheets_desc', icon: FileSpreadsheet },
      { type: 'google.docs', nameKey: 'builder.node.google_docs', descKey: 'builder.node.google_docs_desc', icon: FileText },
    ],
  },
];

export const WorkflowBuilderPage: React.FC = () => {
  const { theme } = useUIStore();
  const { t } = useI18nStore();
  const { activeWorkspace } = useAuthStore();
  const prefersReducedMotion = useReducedMotion();
  const nodeSequenceRef = useRef(INITIAL_NODES.length);
  const logSequenceRef = useRef(4);
  const executionTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const inspectorRef = useRef<HTMLElement | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(INITIAL_EDGES);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedNodeType = String(selectedNode?.data?.nodeType ?? '');
  const selectedNodeConfig = (selectedNode?.data?.config ?? {}) as Record<string, unknown>;
  const isGoogleSheetsNode = selectedNodeType === 'google.sheets';
  const isGoogleDocsNode = selectedNodeType === 'google.docs';
  const isGoogleNode = isGoogleSheetsNode || isGoogleDocsNode;
  const googleOperation = String(
    selectedNodeConfig.operation ?? (isGoogleSheetsNode ? 'read' : isGoogleDocsNode ? 'create' : '')
  );

  // Canvas State & Controls
  const [showGrid, setShowGrid] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectorTab, setInspectorTab] = useState<'config' | 'input' | 'output' | 'logs'>('config');

  // Workflow Metadata & Status
  const [workflowTitle, setWorkflowTitle] = useState('Order processing & notification');
  const [isSaved, setIsSaved] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null);

  // Inspector Form State (for selected node)
  const [llmModel, setLlmModel] = useState('gpt-4o-mini');
  const [payloadVar, setPayloadVar] = useState('{{ $json.body.order_payload }}');
  const [promptText, setPromptText] = useState('Extract order items, quantities, customer address, and calculate total price.');
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

  // Telemetry Console State
  const [telemetryOpen, setTelemetryOpen] = useState(true);
  const [logs, setLogs] = useState<Array<{ id: string; time: string; level: 'info' | 'success' | 'warn'; msg: string }>>([
    { id: '1', time: '11:04:12.102', level: 'info', msg: 'builder.log.webhook_received' },
    { id: '2', time: '11:04:12.224', level: 'success', msg: 'builder.log.webhook_validated' },
    { id: '3', time: '11:04:12.250', level: 'info', msg: 'builder.log.ai_dispatching' },
  ]);

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
    (params: Connection) =>
      setEdges((eds) =>
        addEdge({
          ...params,
          type: 'execution',
          animated: false,
          style: { stroke: '#94a3b8', strokeWidth: 1.75 },
        }, eds)
      ),
    [setEdges]
  );

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    setSelectedNodeId(null);
    setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, selected: false } })));
  }, [setNodes]);

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      if (selectedNodeId && changes.some((change) => change.type === 'remove' && change.id === selectedNodeId)) {
        setSelectedNodeId(null);
        setInspectorOpen(false);
      }
    },
    [onNodesChange, selectedNodeId]
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
    if (file) updateSelectedNodeConfig({ fileName: file.name });
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
      const result = await ocrApi.extractText(
        ocrFile,
        { language: ocrLanguage, detectTables: ocrDetectTables },
        { workspaceId: activeWorkspace?.id || 'ws-main' }
      );
      setOcrResult(result);
      updateSelectedNodeConfig({
        language: ocrLanguage,
        detectTables: ocrDetectTables,
        pages: result.document.pages,
        confidence: result.confidence,
        rawText: result.text.rawText,
      });
      setNodes((nds) =>
        nds.map((node) =>
          node.id === selectedNodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  status: 'success',
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
          time: '11:04:13.850',
          level: result.metadata.quality === 'OK' ? 'success' : 'warn',
          msg: `[OCR] Extracted ${result.document.pages} page${result.document.pages === 1 ? '' : 's'} (${result.metadata.quality}) at ${displayConfidence} confidence`,
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
    const sequence = ++nodeSequenceRef.current;
    const newNodeId = `node-${sequence}`;
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


  // Signature WEAV Execution Sequence Animation
  const handleRunExecution = () => {
    if (isRunning) return;
    clearExecutionTimers();
    setIsRunning(true);

    // Reset all nodes except trigger to idle
    setNodes((nds) =>
      nds.map((n) =>
        n.id === 'node-webhook'
          ? { ...n, data: { ...n.data, status: 'success', executionTime: '120ms' } }
          : { ...n, data: { ...n.data, status: 'idle' } }
      )
    );

    if (prefersReducedMotion) {
      // Reduced motion: immediate state transitions without packet animation
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: { ...n.data, status: 'success', executionTime: '120ms' },
        }))
      );
      setLogs((prev) => [
        ...prev,
        { id: String(++logSequenceRef.current), time: '11:04:14.000', level: 'success', msg: '[Execution] Completed in 1.4s (reduced motion enabled)' },
      ]);
      setIsRunning(false);
      return;
    }

    // Step 1: Webhook active -> Packet travels along edge 1
    setActiveEdgeId('edge-1-2');
    setLogs((prev) => [
      ...prev,
      { id: String(++logSequenceRef.current), time: '11:04:13.100', level: 'info', msg: '[Execution] Packet traveling: Webhook ➔ AI Extract' },
    ]);

    scheduleExecutionStep(() => {
      // Step 2: AI Extract becomes processing
      setActiveEdgeId(null);
      setNodes((nds) =>
        nds.map((n) => (n.id === 'node-extract' ? { ...n, data: { ...n.data, status: 'processing' } } : n))
      );
      setLogs((prev) => [
        ...prev,
        { id: String(++logSequenceRef.current), time: '11:04:13.400', level: 'info', msg: '[AI Extract] Processing JSON extraction schema...' },
      ]);
    }, 900);

    scheduleExecutionStep(() => {
      // Step 3: AI Extract success -> Packet travels along edge 2
      setNodes((nds) =>
        nds.map((n) =>
          n.id === 'node-extract' ? { ...n, data: { ...n.data, status: 'success', executionTime: '850ms' } } : n
        )
      );
      setActiveEdgeId('edge-2-3');
      setLogs((prev) => [
        ...prev,
        { id: String(++logSequenceRef.current), time: '11:04:14.250', level: 'success', msg: '[AI Extract] Resolved 4 schema parameters' },
      ]);
    }, 1900);

    scheduleExecutionStep(() => {
      // Step 4: Condition check processing
      setActiveEdgeId(null);
      setNodes((nds) =>
        nds.map((n) => (n.id === 'node-condition' ? { ...n, data: { ...n.data, status: 'processing' } } : n))
      );
    }, 2700);

    scheduleExecutionStep(() => {
      // Step 5: Condition success -> Packet travels along edge 3
      setNodes((nds) =>
        nds.map((n) =>
          n.id === 'node-condition' ? { ...n, data: { ...n.data, status: 'success', executionTime: '45ms' } } : n
        )
      );
      setActiveEdgeId('edge-3-4');
    }, 3400);

    scheduleExecutionStep(() => {
      // Step 6: Final node notify success
      setActiveEdgeId(null);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === 'node-notify' ? { ...n, data: { ...n.data, status: 'success', executionTime: '210ms' } } : n
        )
      );
      setLogs((prev) => [
        ...prev,
        { id: String(++logSequenceRef.current), time: '11:04:15.010', level: 'success', msg: '[Execution #EX-8492] Workflow finished successfully' },
      ]);
      setIsRunning(false);
    }, 4200);
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
              type="text"
              value={workflowTitle}
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
            onClick={() => setIsSaved(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md transition-colors"
          >
            <Save size={13} />
            <span>{t('builder.save')}</span>
          </button>

          <button className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md transition-colors">
            <span>{t('builder.publish')}</span>
          </button>

          <motion.button
            onClick={handleRunExecution}
            disabled={isRunning}
            aria-label="Run test workflow"
            aria-busy={isRunning}
            whileHover={prefersReducedMotion ? undefined : { y: -1, scale: 1.01 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm shadow-blue-600/25 transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-80"
          >
            {isRunning ? (
              <>
                <span className="relative flex size-3.5 items-center justify-center"><span className="absolute size-3.5 animate-ping rounded-full bg-white/45 motion-reduce:animate-none" /><Loader2 size={13} className="relative motion-safe:animate-spin" /></span>
                <span>{t('builder.running')}</span>
              </>
            ) : (
              <>
                <Play size={13} className="fill-white" />
                <span>{t('builder.run_test')}</span>
              </>
            )}
          </motion.button>
        </div>
      </header>

      {/* COMPACT EDITOR TOOLBAR / SUB-HEADER (~40px) */}
      <div className="h-10 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 px-3 flex items-center justify-between text-xs shrink-0 z-10">
        <div className="flex items-center gap-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
          <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            {t('builder.version_production')}
          </span>
          <span className="text-slate-400 dark:text-slate-600">|</span>
          <span className="text-slate-500 dark:text-slate-400">{t('builder.live_test')}</span>
        </div>

        {/* Step Sequence Breadcrumb */}
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] font-mono">
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={11} /> {t('builder.breadcrumb.webhook')} (120ms)
          </span>
          <ChevronRight size={12} className="text-slate-400" />
          <span className="flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400">
            ● {t('builder.breadcrumb.ai_extract')} (850ms)
          </span>
          <ChevronRight size={12} className="text-slate-400" />
          <span className="text-slate-500">{t('builder.breadcrumb.condition')}</span>
          <ChevronRight size={12} className="text-slate-400" />
          <span className="text-slate-500">{t('builder.breadcrumb.notify')}</span>
        </div>

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
              <span className="text-[10px] text-slate-400 font-mono">{PALETTE_CATALOG.reduce((total, category) => total + category.items.length, 0)} {t('builder.available')}</span>
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
                    .filter((item) => t(item.nameKey).toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <button
                          key={item.type}
                          onClick={() => handleAddCatalogItem(item.type, t(item.nameKey), item.nameKey)}
                          aria-label={t(item.nameKey)}
                          className="group flex w-full cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-left transition-[background-color,border-color,transform] hover:-translate-y-px hover:border-blue-400/60 hover:bg-blue-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-slate-700/50 dark:bg-slate-800/40 dark:hover:bg-blue-950/25 motion-reduce:hover:translate-y-0"
                        >
                          <ItemIcon size={14} className="mt-0.5 shrink-0 text-slate-500 transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="truncate text-xs font-medium text-slate-800 transition-colors group-hover:text-blue-700 dark:text-slate-200 dark:group-hover:text-blue-300">
                              {t(item.nameKey)}
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{t(item.descKey)}</span>
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
            onEdgesChange={onEdgesChange}
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
            <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
              ● {t('builder.ready')}
            </span>
          </div>

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
              selectedNodeType === 'ocr.extract' ? (
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

                  <div>
                    <label htmlFor="ocr-file-input" className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      {t('ocr.file_input')}
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
                    <input
                      id="google-connection"
                      type="text"
                      value={String(selectedNodeConfig.connectionId ?? '')}
                      onChange={(event) => updateSelectedNodeConfig({ connectionId: event.target.value })}
                      className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                    />
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
              <>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    {t('builder.llm_engine')}
                  </label>
                  <select
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="gpt-4o-mini">gpt-4o-mini (Recommended)</option>
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
                    <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    {t('builder.input_payload')}
                  </label>
                  <input
                    type="text"
                    value={payloadVar}
                    onChange={(e) => setPayloadVar(e.target.value)}
                    className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    {t('builder.extraction_prompt')}
                  </label>
                  <textarea
                    rows={3}
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    className="w-full resize-none rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    {t('builder.schema_attributes')}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {['order_id', 'items[]', 'total_amount', 'shipping_address'].map((attr) => (
                      <span
                        key={attr}
                        className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] rounded border border-slate-200 dark:border-slate-700"
                      >
                        {attr}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                  <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    {t('builder.json_schema_output')}
                  </span>
                  <pre className="p-2.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded font-mono text-[10px] text-slate-800 dark:text-slate-300 overflow-x-auto">
{`{
  "type": "object",
  "properties": {
    "order_id": { "type": "string" },
    "items": { "type": "array" },
    "total_amount": { "type": "number" },
    "shipping_address": { "type": "string" }
  },
  "required": ["order_id", "total_amount"]
}`}
                  </pre>
                </div>
              </>
              )
            )}

            {inspectorTab === 'input' && (
              <div className="space-y-2 font-mono text-[11px]">
                <span className="text-[10px] text-slate-500">Incoming JSON Body Payload</span>
                <pre className="p-2.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-800 dark:text-slate-300 overflow-x-auto">
{`{
  "event": "stripe.charge.succeeded",
  "order_payload": {
    "id": "ord_9941",
    "amount": 540.00,
    "customer": "Enterprise Corp"
  }
}`}
                </pre>
              </div>
            )}

            {inspectorTab === 'output' && (
              <div className="space-y-2 font-mono text-[11px]">
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Extracted JSON Structure</span>
                <pre className="p-2.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-800 dark:text-slate-300 overflow-x-auto">
{`{
  "order_id": "ord_9941",
  "total_amount": 540.00,
  "items": ["License Key", "Support Addon"],
  "shipping_address": "742 Evergreen Terrace"
}`}
                </pre>
              </div>
            )}

            {inspectorTab === 'logs' && (
              <div className="space-y-1.5 font-mono text-[10px] text-slate-600 dark:text-slate-400">
                <p>[11:04:12.250] Initializing AI Extract node...</p>
                <p>[11:04:12.800] Token usage: 142 prompt / 68 completion</p>
                <p className="text-emerald-600 dark:text-emerald-400">[11:04:13.100] Execution finished in 850ms</p>
              </div>
            )}
          </div>

          {/* Inspector Footer Actions */}
          <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
            <button
              onClick={handleRunExecution}
              aria-label="Run test workflow"
              className="px-2.5 py-1 text-xs font-medium bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded transition-colors"
            >
              {t('builder.test_step')}
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
              {t('builder.telemetry.execution')} #EX-8492
            </span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-500">{t('builder.telemetry.started')}</span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-500">{t('builder.telemetry.elapsed')}</span>
            <span className="text-slate-400">|</span>
            <span className="text-emerald-600 dark:text-emerald-400">{t('builder.telemetry.stages')} (4)</span>
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
          <div className="h-28 p-2.5 font-mono text-[11px] overflow-y-auto bg-slate-950 text-slate-300 flex gap-4">
            {/* Pipeline Stage List */}
            <div className="w-48 border-r border-slate-800 pr-3 space-y-1 shrink-0 text-[10px]">
              <div className="flex items-center justify-between text-emerald-400">
                <span>✓ Webhook</span>
                <span>120ms</span>
              </div>
              <div className="flex items-center justify-between font-bold text-blue-400">
                <span>● AI Extract</span>
                <span>850ms</span>
              </div>
              <div className="flex items-center justify-between text-slate-500">
                <span>○ Condition</span>
                <span>45ms</span>
              </div>
              <div className="flex items-center justify-between text-slate-500">
                <span>○ Send Notification</span>
                <span>210ms</span>
              </div>
            </div>

            {/* Log Stream */}
            <div className="flex-1 space-y-1 text-[11px]">
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
                    {t(log.msg)}
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
