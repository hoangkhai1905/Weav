import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
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
} from 'lucide-react';
import { CustomWorkflowNode } from '../components/builder/CustomWorkflowNode';
import { ExecutionEdge } from '../components/builder/ExecutionEdge';
import { useUIStore } from '../store/useUIStore';

// Preset Nodes for Initial Canvas State
const INITIAL_NODES: Node[] = [
  {
    id: 'node-webhook',
    type: 'customNode',
    position: { x: 80, y: 180 },
    data: {
      id: 'webhook_inbound_v1',
      name: 'Webhook Trigger',
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
      nodeType: 'ai.extract',
      status: 'idle',
      executionTime: '850ms',
      selected: true,
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
    category: 'TRIGGERS',
    items: [
      { type: 'trigger.webhook', name: 'Webhook Inbound', desc: 'Listen to HTTP POST payloads', icon: Globe },
      { type: 'trigger.schedule', name: 'Schedule / Cron', desc: 'Execute periodically on cron expression', icon: Zap },
      { type: 'trigger.manual', name: 'Manual Trigger', desc: 'Trigger workflow manually or via API', icon: Play },
    ],
  },
  {
    category: 'AI INTELLIGENCE',
    items: [
      { type: 'ai.extract', name: 'AI Extract Core', desc: 'Extract structured JSON from raw text', icon: Sparkles },
      { type: 'ai.classify', name: 'AI Classify', desc: 'Categorize inputs into dynamic labels', icon: ShieldCheck },
      { type: 'ai.summarize', name: 'AI Summarize', desc: 'Synthesize long text into concise summaries', icon: FileCode },
    ],
  },
  {
    category: 'FLOW LOGIC',
    items: [
      { type: 'logic.condition', name: 'If / Condition', desc: 'Branch execution based on rules', icon: GitBranch },
      { type: 'logic.filter', name: 'Filter Data', desc: 'Remove non-matching items from array', icon: SlidersHorizontal },
    ],
  },
  {
    category: 'INTEGRATIONS',
    items: [
      { type: 'email.send', name: 'Send Email / Slack', desc: 'Dispatch notifications to channels', icon: Mail },
      { type: 'http.request', name: 'HTTP Request', desc: 'Call external REST endpoints', icon: Globe },
    ],
  },
];

export const WorkflowBuilderPage: React.FC = () => {
  const { theme } = useUIStore();
  const prefersReducedMotion = useReducedMotion();
  const nodeSequenceRef = useRef(INITIAL_NODES.length);
  const logSequenceRef = useRef(4);
  const executionTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(INITIAL_EDGES);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('node-extract');

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
    { id: '1', time: '11:04:12.102', level: 'info', msg: '[Webhook] Inbound POST request received from Stripe endpoint' },
    { id: '2', time: '11:04:12.224', level: 'success', msg: '[Webhook] Payload validated successfully (size: 4.2 KB)' },
    { id: '3', time: '11:04:12.250', level: 'info', msg: '[AI Extract] Dispatching prompt to model gpt-4o-mini...' },
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

  const onNodeClick = (_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
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

  const handleAddCatalogItem = (type: string, name: string) => {
    const sequence = ++nodeSequenceRef.current;
    const newNodeId = `node-${sequence}`;
    const newNode: Node = {
      id: newNodeId,
      type: 'customNode',
      position: { x: 300 + (sequence % 3) * 40, y: 200 + (sequence % 2) * 60 },
      data: {
        id: `${type.replace('.', '_')}_v1`,
        name,
        nodeType: type,
        status: 'idle',
        executionTime: '',
        selected: true,
        config: {},
      },
    };

    setNodes((nds) => [
      ...nds.map((n) => ({ ...n, data: { ...n.data, selected: false } })),
      newNode,
    ]);
    setSelectedNodeId(newNodeId);
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

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || nodes[1];

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] -m-6 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans">
      {/* TOP EDITOR HEADER (~48px) */}
      <header className="h-12 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          <Link
            to="/workflows"
            className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Back to Workflows"
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
              {isSaved ? 'Saved' : 'Edited'}
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
            Fit View
          </button>
        </div>

        {/* Top Header Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsSaved(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md transition-colors"
          >
            <Save size={13} />
            <span>Save</span>
          </button>

          <button className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md transition-colors">
            <span>Publish</span>
          </button>

          <button
            onClick={handleRunExecution}
            disabled={isRunning}
            aria-label="Run test workflow"
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
          >
            {isRunning ? (
              <>
                <Loader2 size={13} className="motion-safe:animate-spin" />
                <span>Running...</span>
              </>
            ) : (
              <>
                <Play size={13} className="fill-white" />
                <span>Run Test</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* COMPACT EDITOR TOOLBAR / SUB-HEADER (~40px) */}
      <div className="h-10 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 px-3 flex items-center justify-between text-xs shrink-0 z-10">
        <div className="flex items-center gap-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
          <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            v1.4 Production
          </span>
          <span className="text-slate-400 dark:text-slate-600">|</span>
          <span className="text-slate-500 dark:text-slate-400">Live Test #EX-8492</span>
        </div>

        {/* Step Sequence Breadcrumb */}
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] font-mono">
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={11} /> Webhook (120ms)
          </span>
          <ChevronRight size={12} className="text-slate-400" />
          <span className="flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400">
            ● AI Extract (850ms)
          </span>
          <ChevronRight size={12} className="text-slate-400" />
          <span className="text-slate-500">Condition</span>
          <ChevronRight size={12} className="text-slate-400" />
          <span className="text-slate-500">Notify</span>
        </div>

        {/* Right Toolbar View Toggles */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`p-1 rounded transition-colors ${
              showGrid ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100' : 'text-slate-400'
            }`}
            title="Toggle Grid"
          >
            <Grid size={14} />
          </button>
          <button
            onClick={() => setShowMinimap(!showMinimap)}
            className={`p-1 rounded transition-colors ${
              showMinimap ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100' : 'text-slate-400'
            }`}
            title="Toggle Minimap"
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
                Add Step
              </span>
              <span className="text-[10px] text-slate-400 font-mono">12 Available</span>
            </div>

            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-2 text-slate-400" />
              <input
                type="text"
                placeholder="Search actions... (⌘F)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded border border-slate-200 bg-slate-100 py-1 pl-7 pr-2.5 text-xs outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700/60 dark:bg-slate-800/80"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
            {PALETTE_CATALOG.map((cat) => (
              <div key={cat.category} className="space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                  {cat.category}
                </span>
                <div className="space-y-1">
                  {cat.items
                    .filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <button
                          key={item.type}
                          onClick={() => handleAddCatalogItem(item.type, item.name)}
                          className="group flex w-full cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-left transition-[background-color,border-color,transform] hover:-translate-y-px hover:border-blue-400/60 hover:bg-blue-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-slate-700/50 dark:bg-slate-800/40 dark:hover:bg-blue-950/25 motion-reduce:hover:translate-y-0"
                        >
                          <ItemIcon size={14} className="mt-0.5 shrink-0 text-slate-500 transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="truncate text-xs font-medium text-slate-800 transition-colors group-hover:text-blue-700 dark:text-slate-200 dark:group-hover:text-blue-300">
                              {item.name}
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{item.desc}</span>
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
        <main className="flex-1 h-full bg-slate-100 dark:bg-slate-950 relative overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={renderedEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
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
        <motion.aside
          initial={prefersReducedMotion ? false : { opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="z-10 flex w-88 shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        >
          {/* Inspector Header */}
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {(selectedNode.data.name as string) || 'Step Inspector'}
              </span>
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                {(selectedNode.data.id as string) || 'extract_order_v1'}
              </span>
            </div>
            <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
              ● Ready
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
                {tab}
              </button>
            ))}
          </div>

          {/* Inspector Body Content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
            {inspectorTab === 'config' && (
              <>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    LLM Engine
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
                    Input Payload Variable
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
                    Extraction Prompt
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
                    Schema Attributes
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
                    JSON Schema Strict Output
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
              Test Step
            </button>
            <button className="rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
              Save Changes
            </button>
          </div>
        </motion.aside>
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
              Execution #EX-8492
            </span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-500">Started: Just now</span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-500">Elapsed: 1.4s</span>
            <span className="text-slate-400">|</span>
            <span className="text-emerald-600 dark:text-emerald-400">Pipeline Stages (4)</span>
          </div>

          <div className="flex items-center gap-2 text-slate-400">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLogs([]);
              }}
              className="hover:text-slate-600 dark:hover:text-slate-200 text-[10px]"
            >
              Clear Logs
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
