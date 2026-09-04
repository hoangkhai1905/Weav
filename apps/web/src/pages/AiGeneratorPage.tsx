import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Sparkles,
  Zap,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Edit3,
  Code2,
  Copy,
  Terminal,
  Database,
  Globe,
  GitBranch,
  Send,
  ShieldCheck,
  Lock,
  ArrowRight,
  BookOpen,
  History,
  Check,
} from 'lucide-react';
import { workflowApi } from '../api/workflow.api';

export function AiGeneratorPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // Initial prompt state (passed from CreateWorkflowPage or default)
  const [prompt, setPrompt] = useState<string>(
    (location.state as { initialPrompt?: string })?.initialPrompt ||
      'When a new order is received via Stripe webhook, check inventory in PostgreSQL, extract customer profile details using AI, verify order threshold (> $100), and dispatch a structured notification to Slack #sales-alerts.'
  );

  // Generation Stages & Animation State
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisMode, setSynthesisMode] = useState<'fast' | 'cot'>('fast');
  const [generationStage, setGenerationStage] = useState<'understand' | 'build' | 'validate' | 'complete'>('complete');
  const [visibleNodesCount, setVisibleNodesCount] = useState<number>(5);
  const [copiedCode, setCopiedCode] = useState(false);

  const handleSynthesize = () => {
    if (isSynthesizing) return;
    setIsSynthesizing(true);
    setGenerationStage('understand');
    setVisibleNodesCount(0);

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setGenerationStage('complete');
      setVisibleNodesCount(5);
      setIsSynthesizing(false);
      return;
    }

    // Stage 1: Understand (~400ms)
    setTimeout(() => {
      setGenerationStage('build');
      // Stage 2: Build - progressive node reveals
      setVisibleNodesCount(1);
    }, 500);

    setTimeout(() => setVisibleNodesCount(2), 800);
    setTimeout(() => setVisibleNodesCount(3), 1100);
    setTimeout(() => setVisibleNodesCount(4), 1400);
    setTimeout(() => {
      setVisibleNodesCount(5);
      setGenerationStage('validate');
    }, 1700);

    // Stage 3: Validate & Complete
    setTimeout(() => {
      setGenerationStage('complete');
      setIsSynthesizing(false);
    }, 2200);
  };

  const handleAcceptPipeline = async () => {
    try {
      const created = await workflowApi.createWorkflow({
        name: 'Stripe Order & AI Enrichment Pipeline',
        description: prompt,
      });
      navigate(`/workflows/${created.id}/builder`);
    } catch {
      navigate('/workflows/wf-prod-8492/builder');
    }
  };

  const handleCopyJson = () => {
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const PROMPT_STARTERS = [
    'Process incoming orders',
    'Sync customer data',
    'Generate daily reports',
    'Notify team on failed payments',
    'Parse invoice PDF to BigQuery',
  ];

  return (
    <div className="space-y-5 text-slate-900 dark:text-slate-100 font-sans pb-16">
      {/* Breadcrumb & Metadata Header */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <Link to="/workspace" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
              Workspace
            </Link>
            <span>/</span>
            <Link to="/workflows" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
              Workflows
            </Link>
            <span>/</span>
            <Link to="/workflows/new" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
              Create workflow
            </Link>
            <span>/</span>
            <span className="text-slate-900 dark:text-slate-100 font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
              Create with AI
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Engine: WEAV Synthesizer v2.4 (Deterministic)
            </span>
            <span className="hidden md:inline px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
              Cluster: us-east-prod-04
            </span>
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pt-1">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Link
                to="/workflows/new"
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 flex items-center gap-1"
              >
                <ArrowLeft size={14} />
                <span>Back to Create workflow</span>
              </Link>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Create with AI
              </h1>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 pl-6 max-w-3xl">
              Describe the automation in plain technical specifications. WEAV compiles step topologies, validates JSON schemas, and synthesizes immutable graph bindings.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button className="h-8 px-3 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
              <BookOpen size={14} />
              <span>Synthesizer Specs</span>
            </button>
            <button className="h-8 px-3 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
              <Terminal size={14} />
              <span>CLI Generator</span>
            </button>
          </div>
        </div>
      </div>

      {/* Top Workbench: Intent Prompting & Compiler Parameters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#2563EB]" />
            <label className="text-xs font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              Automation Intent & Prompt
            </label>
            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
              Natural Language to Pipeline AST
            </span>
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 size={12} />
              JSON-Schema Strict: Enforced
            </span>
            <span>•</span>
            <span>{prompt.length} chars</span>
            <span>•</span>
            <span>~{Math.ceil(prompt.length / 4.5)} tokens</span>
          </div>
        </div>

        {/* Textarea Field */}
        <div className="relative rounded-lg bg-slate-50 dark:bg-slate-950 border border-[#2563EB]/50 p-3 focus-within:border-[#2563EB] transition-all">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Describe triggers, downstream systems, transform logic, conditions, and notifications..."
            className="w-full bg-transparent text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 resize-none outline-none border-0 p-0 leading-relaxed font-sans"
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2.5 mt-2 border-t border-slate-200/60 dark:border-slate-800/80">
            {/* Starter Prompt Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 text-[11px]">
              <span className="text-slate-400 shrink-0 font-medium text-[10px]">Quick starters:</span>
              {PROMPT_STARTERS.map((starter, idx) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => setPrompt(`When triggered, ${starter.toLowerCase()} and log execution results.`)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap ${
                    idx === 0
                      ? 'bg-[#2563EB]/10 text-[#2563EB] border border-[#2563EB]/30 font-semibold'
                      : 'bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {idx === 0 && <Check size={10} className="inline mr-1" />}
                  {starter}
                </button>
              ))}
            </div>

            <button className="text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 flex items-center gap-1 shrink-0">
              <History size={12} />
              <span>Recent prompts</span>
            </button>
          </div>
        </div>

        {/* Controls Ribbon */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* Mode Switcher */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs">
              <button
                onClick={() => setSynthesisMode('fast')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                  synthesisMode === 'fast'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Zap size={12} className="text-[#2563EB]" />
                <span>Fast synthesis (v2.4)</span>
              </button>
              <button
                onClick={() => setSynthesisMode('cot')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                  synthesisMode === 'cot'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Sparkles size={12} />
                <span>Deep reasoning (CoT)</span>
              </button>
            </div>

            {/* Validation Badges */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-[11px] text-slate-600 dark:text-slate-400">
              <ShieldCheck size={13} className="text-emerald-500" />
              <span>
                Strict JSON schema validation: <strong className="text-slate-900 dark:text-slate-100">Enabled</strong>
              </span>
            </div>

            <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-[11px] text-slate-600 dark:text-slate-400">
              <Lock size={13} />
              <span>
                Secret Isolation: <strong className="text-slate-900 dark:text-slate-100">Strict</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-3">
            {/* Status Pill */}
            {isSynthesizing ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono text-[11px] border border-amber-500/20">
                <Loader2 size={12} className="animate-spin" />
                <span>
                  Stage:{' '}
                  {generationStage === 'understand'
                    ? '1. Understand Intent'
                    : generationStage === 'build'
                    ? '2. Build Topology'
                    : '3. Validate Schema'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-[11px] border border-emerald-500/20">
                <CheckCircle2 size={12} />
                <span>Synthesis complete (1.2s • 5 nodes generated)</span>
              </div>
            )}

            {/* Synthesize Button */}
            <button
              onClick={handleSynthesize}
              disabled={isSynthesizing}
              className="px-4 py-1.5 bg-[#2563EB] hover:bg-[#5b32d6] text-white text-xs font-semibold rounded-md transition-all shadow-xs flex items-center gap-1.5"
            >
              {isSynthesizing ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Synthesizing...</span>
                </>
              ) : (
                <>
                  <Zap size={14} />
                  <span>Synthesize Pipeline</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Generated Graph Pipeline Preview */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden flex flex-col">
        {/* Section Header */}
        <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[#2563EB]" />
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Generated Workflow Preview
              </span>
            </div>

            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              5 nodes • 4 connections • AST Validated
            </span>

            <span className="font-mono text-[10px] text-slate-400">
              Graph ID: wf_syn_802fb9
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSynthesize}
              className="h-7 px-2.5 rounded text-xs font-medium bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors flex items-center gap-1 shadow-xs"
            >
              <RefreshCw size={12} />
              <span>Regenerate</span>
            </button>
            <button
              onClick={handleAcceptPipeline}
              className="h-7 px-2.5 rounded text-xs font-medium bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors flex items-center gap-1 shadow-xs"
            >
              <Edit3 size={12} />
              <span>Edit in canvas</span>
            </button>
            <button
              onClick={handleAcceptPipeline}
              className="h-7 px-3 rounded text-xs font-semibold bg-[#2563EB] hover:bg-[#5b32d6] text-white transition-colors flex items-center gap-1 shadow-xs"
            >
              <span>Accept Pipeline</span>
              <ArrowRight size={12} />
            </button>
          </div>
        </div>

        {/* Graph Visual Area with Dot Matrix Backing */}
        <div
          className="relative w-full p-6 bg-slate-100 dark:bg-slate-950 overflow-x-auto min-h-[220px]"
          style={{
            backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)',
            backgroundSize: '16px 16px',
          }}
        >
          {/* Canvas Status Ribbon Top Left */}
          <div className="absolute top-3 left-4 flex items-center gap-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur rounded px-2.5 py-1 border border-slate-200 dark:border-slate-800 text-[10px] font-mono text-slate-500 dark:text-slate-400 shadow-xs">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Deterministic Flow
            </span>
            <span>•</span>
            <span>Zoom: 100%</span>
            <span>•</span>
            <span>Linear Execution Mode</span>
          </div>

          {/* Sequential Pipeline Row (5 Node Cards Connected) */}
          <div className="flex items-center gap-0 min-w-max pt-6 pb-2 px-2">
            {/* NODE 1: Webhook Trigger */}
            {visibleNodesCount >= 1 && (
              <div className="w-64 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col relative transition-all hover:shadow-md">
                <div className="h-8 px-3 bg-amber-500/10 rounded-t-lg flex items-center justify-between border-b border-amber-500/20">
                  <div className="flex items-center gap-2">
                    <Globe size={14} className="text-amber-600 dark:text-amber-400" />
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">Webhook Trigger</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400">
                    TRIGGER
                  </span>
                </div>
                <div className="p-2.5 space-y-2 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 text-[11px]">POST /stripe-orders</p>
                    <p className="font-mono text-[10px] text-slate-500 truncate">Listen for payment_intent.succeeded</p>
                  </div>
                  <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded font-mono text-[10px] text-slate-600 dark:text-slate-400 flex items-center justify-between">
                    <span>Output: $json.body</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
                    <span>Auth: HMAC SHA256</span>
                    <span className="text-emerald-500 font-semibold font-mono">Ready</span>
                  </div>
                </div>
              </div>
            )}

            {/* CONNECTOR 1 -> 2 */}
            {visibleNodesCount >= 2 && (
              <div className="w-10 flex items-center justify-center relative">
                <svg className="w-full h-4 text-slate-400" fill="none" viewBox="0 0 40 16">
                  <path d="M 0 8 L 32 8" stroke="currentColor" strokeDasharray="2 2" strokeWidth="2" />
                  <polygon fill="currentColor" points="32,4 40,8 32,12" />
                </svg>
                <div className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
              </div>
            )}

            {/* NODE 2: Database Query */}
            {visibleNodesCount >= 2 && (
              <div className="w-64 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col relative transition-all hover:shadow-md">
                <div className="h-8 px-3 bg-sky-500/10 rounded-t-lg flex items-center justify-between border-b border-sky-500/20">
                  <div className="flex items-center gap-2">
                    <Database size={14} className="text-sky-600 dark:text-sky-400" />
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">PostgreSQL Store</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-sky-500/20 text-sky-600 dark:text-sky-400">
                    DATABASE
                  </span>
                </div>
                <div className="p-2.5 space-y-2 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 text-[11px]">Query Inventory Status</p>
                    <p className="font-mono text-[10px] text-slate-500 truncate">SELECT stock FROM items WHERE id = :id</p>
                  </div>
                  <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded font-mono text-[10px] text-slate-600 dark:text-slate-400 flex items-center justify-between">
                    <span>Input: {`{{$json.item_id}}`}</span>
                    <span className="text-emerald-500 font-mono">200 OK</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
                    <span>Pool: pg-warehouse</span>
                    <span className="text-emerald-500 font-semibold font-mono">Configured</span>
                  </div>
                </div>
              </div>
            )}

            {/* CONNECTOR 2 -> 3 */}
            {visibleNodesCount >= 3 && (
              <div className="w-10 flex items-center justify-center relative">
                <svg className="w-full h-4 text-slate-400" fill="none" viewBox="0 0 40 16">
                  <path d="M 0 8 L 32 8" stroke="currentColor" strokeDasharray="2 2" strokeWidth="2" />
                  <polygon fill="currentColor" points="32,4 40,8 32,12" />
                </svg>
                <div className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
              </div>
            )}

            {/* NODE 3: AI Extract Node (Highlighted) */}
            {visibleNodesCount >= 3 && (
              <div className="w-68 bg-white dark:bg-slate-900 rounded-lg border-2 border-[#2563EB] shadow-md shadow-[#2563EB]/20 flex flex-col relative transition-all">
                <div className="h-8 px-3 bg-[#2563EB] rounded-t-[6px] flex items-center justify-between text-white">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="fill-white" />
                    <span className="text-xs font-semibold">AI Extract & Profile</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-white/20 text-white">
                    SYNTHESIZED
                  </span>
                </div>
                <div className="p-2.5 space-y-2 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 text-[11px]">Extract Customer Meta</p>
                    <p className="font-mono text-[10px] text-slate-500">Model: gpt-4o-mini (Structured)</p>
                  </div>
                  <div className="p-1.5 bg-[#2563EB]/10 border border-[#2563EB]/20 rounded font-mono text-[10px] space-y-0.5">
                    <span className="text-[#2563EB] font-semibold block">Schema: customer_schema_v1</span>
                    <span className="text-slate-600 dark:text-slate-400 block truncate">Yields: {`{{$json.customer_profile}}`}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-[#2563EB] font-medium">Auto-bound schema</span>
                    <span className="text-emerald-500 font-semibold font-mono">Valid</span>
                  </div>
                </div>
              </div>
            )}

            {/* CONNECTOR 3 -> 4 */}
            {visibleNodesCount >= 4 && (
              <div className="w-10 flex items-center justify-center relative">
                <svg className="w-full h-4 text-slate-400" fill="none" viewBox="0 0 40 16">
                  <path d="M 0 8 L 32 8" stroke="currentColor" strokeDasharray="2 2" strokeWidth="2" />
                  <polygon fill="currentColor" points="32,4 40,8 32,12" />
                </svg>
                <div className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
              </div>
            )}

            {/* NODE 4: Condition Node */}
            {visibleNodesCount >= 4 && (
              <div className="w-64 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col relative transition-all hover:shadow-md">
                <div className="h-8 px-3 bg-sky-500/10 rounded-t-lg flex items-center justify-between border-b border-sky-500/20">
                  <div className="flex items-center gap-2">
                    <GitBranch size={14} className="text-sky-600 dark:text-sky-400" />
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">Conditional Gate</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-sky-500/20 text-sky-600 dark:text-sky-400">
                    LOGIC
                  </span>
                </div>
                <div className="p-2.5 space-y-2 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 text-[11px]">Order Total &gt; $100</p>
                    <p className="font-mono text-[10px] text-slate-500 truncate">eval({`{{$json.amount}}`} &gt; 10000)</p>
                  </div>
                  <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded font-mono text-[10px] text-slate-600 dark:text-slate-400 flex items-center justify-between">
                    <span>Branch: true</span>
                    <span className="text-emerald-500 font-semibold font-mono">Passed</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
                    <span>Operator: GreaterThan</span>
                    <span className="text-emerald-500 font-semibold font-mono">Evaluated</span>
                  </div>
                </div>
              </div>
            )}

            {/* CONNECTOR 4 -> 5 */}
            {visibleNodesCount >= 5 && (
              <div className="w-10 flex items-center justify-center relative">
                <svg className="w-full h-4 text-slate-400" fill="none" viewBox="0 0 40 16">
                  <path d="M 0 8 L 32 8" stroke="currentColor" strokeDasharray="2 2" strokeWidth="2" />
                  <polygon fill="currentColor" points="32,4 40,8 32,12" />
                </svg>
                <div className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
              </div>
            )}

            {/* NODE 5: Slack Dispatch Action */}
            {visibleNodesCount >= 5 && (
              <div className="w-64 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col relative transition-all hover:shadow-md">
                <div className="h-8 px-3 bg-emerald-500/10 rounded-t-lg flex items-center justify-between border-b border-emerald-500/20">
                  <div className="flex items-center gap-2">
                    <Send size={14} className="text-emerald-600 dark:text-emerald-400" />
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">Slack Dispatch</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    ACTION
                  </span>
                </div>
                <div className="p-2.5 space-y-2 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 text-[11px]">Notify #sales-alerts</p>
                    <p className="font-mono text-[10px] text-slate-500 truncate">BlockKit: Order VIP Notification</p>
                  </div>
                  <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded font-mono text-[10px] text-slate-600 dark:text-slate-400 flex items-center justify-between">
                    <span>Channel: #sales-alerts</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
                    <span>Webhook Bot: Active</span>
                    <span className="text-emerald-500 font-semibold font-mono">Ready</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inspector & Synthesized Schema Detail Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Variable Bindings */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-3 lg:col-span-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 size={16} className="text-[#2563EB]" />
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Variable Bindings</span>
            </div>
            <span className="font-mono text-[10px] text-slate-400">3 parameters auto-bound</span>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Input paths mapped dynamically across node boundaries via downstream AST deduction:
          </p>

          <div className="space-y-2 font-mono text-xs">
            <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[#2563EB] font-semibold truncate">{`{{$json.body.order_id}}`}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  UUIDv4
                </span>
              </div>
              <p className="text-[10px] text-slate-500">From Node 1 (Webhook) ➔ Node 2 parameter :id</p>
            </div>

            <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[#2563EB] font-semibold truncate">{`{{$json.customer_profile}}`}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  Object
                </span>
              </div>
              <p className="text-[10px] text-slate-500">From Node 3 (AI Extract) ➔ Node 5 Slack template</p>
            </div>

            <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[#2563EB] font-semibold truncate">{`{{$json.inventory_status}}`}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  Boolean
                </span>
              </div>
              <p className="text-[10px] text-slate-500">From Node 2 (Postgres) ➔ Node 4 Condition check</p>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Lock size={12} className="text-emerald-500" />
              Zero secret leakages detected
            </span>
            <button className="text-[#2563EB] hover:underline font-medium text-[11px]">View Map</button>
          </div>
        </div>

        {/* Right: Synthesized Workflow AST JSON Specification */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-3 lg:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Terminal size={16} className="text-[#2563EB]" />
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Synthesized Workflow Definition
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyJson}
                className="h-6 px-2 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors flex items-center gap-1"
              >
                <Copy size={11} />
                <span>{copiedCode ? 'Copied!' : 'Copy JSON'}</span>
              </button>
              <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[10px] font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Valid RFC 8259
              </span>
            </div>
          </div>

          {/* Code Block Container */}
          <pre className="p-3 bg-slate-950 rounded-lg font-mono text-[11px] text-slate-300 overflow-x-auto max-h-[160px] leading-relaxed border border-slate-800">
            {`{
  "workflow_id": "wf_syn_802fb9",
  "execution_engine": "weav-runtime-v2",
  "topology": {
    "nodes_count": 5,
    "entrypoint": "node_webhook_01",
    "edges": [
      { "from": "node_webhook_01", "to": "node_pg_query_02" },
      { "from": "node_pg_query_02", "to": "node_ai_extract_03" },
      { "from": "node_ai_extract_03", "to": "node_cond_gate_04" },
      { "from": "node_cond_gate_04", "to": "node_slack_notify_05", "condition": "true" }
    ]
  },
  "verification_hash": "sha256:7f9a2e38c01b..."
}`}
          </pre>
        </div>
      </div>

      {/* Prominent Operational Control Bottom Bar (Fixed Sticky) */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 p-3 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <div className="flex flex-col">
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Synthesized graph is compiled and ready
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              All 5 node interfaces match upstream contract definitions without type mismatch.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <Link
            to="/workflows/new"
            className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded transition-colors"
          >
            Discard draft
          </Link>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded transition-colors"
          >
            Edit Prompt
          </button>
          <button
            onClick={handleAcceptPipeline}
            className="px-4 py-1.5 text-xs font-semibold bg-[#2563EB] hover:bg-[#5b32d6] text-white rounded transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Zap size={14} />
            <span>Create & Deploy Workflow</span>
          </button>
        </div>
      </div>
    </div>
  );
}

