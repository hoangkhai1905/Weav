import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
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
  Lock,
  ArrowRight,
} from 'lucide-react';
import { workflowApi } from '../api/workflow.api';
import { useI18nStore } from '../store/useI18nStore';

export function AiGeneratorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();
  const { t } = useI18nStore();

  // Initial prompt state (passed from CreateWorkflowPage or default)
  const [prompt, setPrompt] = useState<string>(
    (location.state as { initialPrompt?: string })?.initialPrompt ?? t('ai_gen.default_prompt')
  );

  // Generation Stages & Animation State
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [visibleNodesCount, setVisibleNodesCount] = useState<number>(5);
  const [copiedCode, setCopiedCode] = useState(false);

  const handleSynthesize = () => {
    if (isSynthesizing) return;
    setIsSynthesizing(true);
    setVisibleNodesCount(0);

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setVisibleNodesCount(5);
      setIsSynthesizing(false);
      return;
    }

    // Stage 1: Understand (~400ms)
    setTimeout(() => {
      // Stage 2: Build - progressive node reveals
      setVisibleNodesCount(1);
    }, 500);

    setTimeout(() => setVisibleNodesCount(2), 800);
    setTimeout(() => setVisibleNodesCount(3), 1100);
    setTimeout(() => setVisibleNodesCount(4), 1400);
    setTimeout(() => {
      setVisibleNodesCount(5);
    }, 1700);

    // Stage 3: Validate & Complete
    setTimeout(() => {
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
    { label: 'ai_gen.starter.orders', prompt: 'ai_gen.starter_prompt.orders' },
    { label: 'ai_gen.starter.customers', prompt: 'ai_gen.starter_prompt.customers' },
    { label: 'ai_gen.starter.reports', prompt: 'ai_gen.starter_prompt.reports' },
    { label: 'ai_gen.starter.payments', prompt: 'ai_gen.starter_prompt.payments' },
    { label: 'ai_gen.starter.invoices', prompt: 'ai_gen.starter_prompt.invoices' },
  ];

  return (
    <div data-testid="ai-generator-page" className="space-y-5 text-foreground font-sans pb-16">
      {/* Focused creation header */}
      <div className="space-y-2">
        <Link
          to="/workflows/new"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          {t('ai_gen.back')}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight text-foreground">{t('ai_gen.title')}</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-ok-bg px-2 py-0.5 text-[10px] font-medium text-ok">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            {t('ai_gen.ready')}
          </span>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t('ai_gen.simple_subtitle')}
        </p>
      </div>

      {/* Focused prompt workbench */}
      <motion.section
        data-testid="ai-prompt-workbench"
        initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="space-y-3 rounded-xl border border-border bg-card p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <label htmlFor="workflow-prompt" className="text-sm font-semibold text-foreground">
              {t('ai_gen.prompt_label')}
            </label>
            <p className="mt-1 text-xs text-muted-foreground">{t('ai_gen.prompt_hint')}</p>
          </div>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{t('ai_gen.characters').replace('{count}', String(prompt.length))}</span>
        </div>

        <div className="rounded-lg border border-run/30 bg-subtle p-3 transition-colors focus-within:border-run/30">
          <textarea
            id="workflow-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder={t('ai_gen.prompt_hint')}
            className="w-full resize-none border-0 bg-transparent p-0 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          />

          <div className="mt-3 flex items-center gap-2 overflow-x-auto border-t border-border-strong pt-3">
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{t('ai_gen.try_example')}</span>
            {PROMPT_STARTERS.slice(0, 3).map((starter) => (
              <motion.button
                key={starter.label}
                type="button"
                onClick={() => setPrompt(t(starter.prompt))}
                whileHover={prefersReducedMotion ? undefined : { y: -1 }}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
                className="shrink-0 rounded-md border border-border-strong bg-card px-2.5 py-1 text-[11px] font-medium text-text-2 transition-colors hover:border-run/30 hover:bg-run-bg hover:text-run"
              >
                {t(starter.label)}
              </motion.button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <motion.div
            key={isSynthesizing ? 'building' : 'ready'}
            data-testid="generation-status"
            initial={prefersReducedMotion ? false : { opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-1.5 text-xs text-text-2"
          >
            {isSynthesizing ? <Loader2 size={14} className="animate-spin text-run" /> : <CheckCircle2 size={14} className="text-ok" />}
            <span>{isSynthesizing ? t('ai_gen.building_status') : t('ai_gen.ready_status')}</span>
          </motion.div>
          <motion.button
            onClick={handleSynthesize}
            disabled={isSynthesizing}
            whileHover={prefersReducedMotion ? undefined : { y: -1, scale: 1.01 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
            animate={isSynthesizing && !prefersReducedMotion ? { boxShadow: ['0 0 0 0 rgba(37, 99, 235, 0)', '0 0 0 6px rgba(37, 99, 235, 0.16)', '0 0 0 0 rgba(37, 99, 235, 0)'] } : undefined}
            transition={isSynthesizing && !prefersReducedMotion ? { duration: 1.25, repeat: Infinity } : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary disabled:cursor-wait disabled:opacity-70"
          >
            {isSynthesizing ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
            <span>{isSynthesizing ? t('ai_gen.building') : t('ai_gen.btn_generate')}</span>
          </motion.button>
        </div>
      </motion.section>

      {/* Generated Graph Pipeline Preview */}
      <motion.div
        data-testid="workflow-preview"
        initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.36, delay: prefersReducedMotion ? 0 : 0.08, ease: [0.16, 1, 0.3, 1] }}
        className="bg-card border border-border rounded-xl overflow-hidden flex flex-col"
      >
        {/* Section Header */}
        <div className="px-4 py-2.5 bg-subtle border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-run" />
              <span className="text-xs font-bold text-foreground">
                {t('ai_gen.preview')}
              </span>
            </div>

            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-ok-bg text-ok border border-ok/30 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-ok" />
              {t('ai_gen.steps_ready')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSynthesize}
              className="h-7 px-2.5 rounded text-xs font-medium bg-card hover:bg-subtle text-text-2 border border-border transition-colors flex items-center gap-1"
            >
              <RefreshCw size={12} />
              <span>{t('ai_gen.btn_regenerate')}</span>
            </button>
            <button
              onClick={handleAcceptPipeline}
              className="h-7 px-2.5 rounded text-xs font-medium bg-card hover:bg-subtle text-text-2 border border-border transition-colors flex items-center gap-1"
            >
              <Edit3 size={12} />
              <span>{t('ai_gen.edit')}</span>
            </button>
            <button
              onClick={handleAcceptPipeline}
              className="h-7 px-3 rounded text-xs font-semibold bg-primary hover:bg-primary text-white transition-colors flex items-center gap-1"
            >
              <span>{t('ai_gen.use_workflow')}</span>
              <ArrowRight size={12} />
            </button>
          </div>
        </div>

        {/* Graph Visual Area with Dot Matrix Backing */}
        <div
          className="relative w-full p-6 bg-subtle overflow-x-auto min-h-[220px]"
          style={{
            backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)',
            backgroundSize: '16px 16px',
          }}
        >
          {/* Canvas Status Ribbon Top Left */}
          <div className="absolute top-3 left-4 flex items-center gap-2 bg-card/90 backdrop-blur rounded px-2.5 py-1 border border-border text-[10px] font-mono text-text-2">
            <span className="flex items-center gap-1 text-ok font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-ok" />
              {t('ai_gen.diagram.deterministic')}
            </span>
            <span>•</span>
            <span>{t('ai_gen.diagram.zoom')}</span>
            <span>•</span>
            <span>{t('ai_gen.diagram.linear_mode')}</span>
          </div>

          {/* Sequential Pipeline Row (5 Node Cards Connected) */}
          <div className="flex items-center gap-0 min-w-max pt-6 pb-2 px-2">
            {/* NODE 1: Webhook Trigger */}
            {visibleNodesCount >= 1 && (
              <div className="w-64 bg-card rounded-lg border border-border flex flex-col relative transition-all">
                <div className="h-8 px-3 bg-warn-bg rounded-t-lg flex items-center justify-between border-b border-warn/30">
                  <div className="flex items-center gap-2">
                    <Globe size={14} className="text-warn" />
                    <span className="text-xs font-semibold text-foreground">{t('ai_gen.diagram.node.webhook')}</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-warn-bg text-warn">
                    {t('ai_gen.diagram.badge_trigger')}
                  </span>
                </div>
                <div className="p-2.5 space-y-2 text-xs">
                  <div>
                    <p className="font-semibold text-foreground text-[11px]">POST /stripe-orders</p>
                    <p className="font-mono text-[10px] text-muted-foreground truncate">{t('ai_gen.diagram.listen_for')}: payment_intent.succeeded</p>
                  </div>
                <div className="p-1.5 bg-subtle rounded font-mono text-[10px] text-text-2 flex items-center justify-between">
                    <span>{t('ai_gen.diagram.output')}: $json.body</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-ok" />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border">
                    <span>{t('ai_gen.diagram.auth')}: HMAC SHA256</span>
                    <span className="text-ok font-semibold font-mono">{t('ai_gen.ready')}</span>
                  </div>
                </div>
              </div>
            )}

            {/* CONNECTOR 1 -> 2 */}
            {visibleNodesCount >= 2 && (
              <div className="w-10 flex items-center justify-center relative">
                <svg className="w-full h-4 text-muted-foreground" fill="none" viewBox="0 0 40 16">
                  <path d="M 0 8 L 32 8" stroke="currentColor" strokeDasharray="2 2" strokeWidth="2" />
                  <polygon fill="currentColor" points="32,4 40,8 32,12" />
                </svg>
                <motion.div
                  data-testid="preview-flow-dot"
                  animate={prefersReducedMotion ? { opacity: 0.8 } : { x: [-8, 8], opacity: [0.45, 1, 0.45] }}
                  transition={prefersReducedMotion ? undefined : { duration: 1.1, repeat: Infinity, delay: 0 }}
                  className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary"
                />
              </div>
            )}

            {/* NODE 2: Database Query */}
            {visibleNodesCount >= 2 && (
              <div className="w-64 bg-card rounded-lg border border-border flex flex-col relative transition-all">
                <div className="h-8 px-3 bg-run-bg rounded-t-lg flex items-center justify-between border-b border-run/30">
                  <div className="flex items-center gap-2">
                    <Database size={14} className="text-run" />
                    <span className="text-xs font-semibold text-foreground">{t('ai_gen.diagram.node.postgres')}</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-run-bg text-run">
                    {t('ai_gen.diagram.badge_database')}
                  </span>
                </div>
                <div className="p-2.5 space-y-2 text-xs">
                  <div>
                    <p className="font-semibold text-foreground text-[11px]">{t('ai_gen.diagram.query_inventory')}</p>
                    <p className="font-mono text-[10px] text-muted-foreground truncate">SELECT stock FROM items WHERE id = :id</p>
                  </div>
                <div className="p-1.5 bg-subtle rounded font-mono text-[10px] text-text-2 flex items-center justify-between">
                    <span>{t('ai_gen.diagram.input')}: {`{{$json.item_id}}`}</span>
                    <span className="text-ok font-mono">200 OK</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border">
                    <span>{t('ai_gen.diagram.pool')}: pg-warehouse</span>
                    <span className="text-ok font-semibold font-mono">{t('ai_gen.diagram.configured')}</span>
                  </div>
                </div>
              </div>
            )}

            {/* CONNECTOR 2 -> 3 */}
            {visibleNodesCount >= 3 && (
              <div className="w-10 flex items-center justify-center relative">
                <svg className="w-full h-4 text-muted-foreground" fill="none" viewBox="0 0 40 16">
                  <path d="M 0 8 L 32 8" stroke="currentColor" strokeDasharray="2 2" strokeWidth="2" />
                  <polygon fill="currentColor" points="32,4 40,8 32,12" />
                </svg>
                <motion.div
                  data-testid="preview-flow-dot"
                  animate={prefersReducedMotion ? { opacity: 0.8 } : { x: [-8, 8], opacity: [0.45, 1, 0.45] }}
                  transition={prefersReducedMotion ? undefined : { duration: 1.1, repeat: Infinity, delay: 0.18 }}
                  className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary"
                />
              </div>
            )}

            {/* NODE 3: AI Extract Node (Highlighted) */}
            {visibleNodesCount >= 3 && (
              <div className="w-68 bg-card rounded-lg border-2 border-primary  flex flex-col relative transition-all">
                <div className="h-8 px-3 bg-primary rounded-t-[6px] flex items-center justify-between text-white">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="fill-white" />
                    <span className="text-xs font-semibold">{t('ai_gen.diagram.node.ai_extract')}</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-black/20 text-white">
                    {t('ai_gen.diagram.badge_synthesized')}
                  </span>
                </div>
                <div className="p-2.5 space-y-2 text-xs">
                  <div>
                    <p className="font-semibold text-foreground text-[11px]">{t('ai_gen.diagram.extract_customer')}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{t('ai_gen.diagram.model')}: gpt-4o-mini ({t('ai_gen.diagram.structured')})</p>
                  </div>
                  <div className="p-1.5 bg-primary/10 border border-run/20 rounded font-mono text-[10px] space-y-0.5">
                    <span className="text-run font-semibold block">{t('ai_gen.diagram.schema')}: customer_schema_v1</span>
                    <span className="text-text-2 block truncate">{t('ai_gen.diagram.yields')}: {`{{$json.customer_profile}}`}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border">
                    <span className="text-run font-medium">{t('ai_gen.diagram.auto_bound_schema')}</span>
                    <span className="text-ok font-semibold font-mono">{t('ai_gen.diagram.valid')}</span>
                  </div>
                </div>
              </div>
            )}

            {/* CONNECTOR 3 -> 4 */}
            {visibleNodesCount >= 4 && (
              <div className="w-10 flex items-center justify-center relative">
                <svg className="w-full h-4 text-muted-foreground" fill="none" viewBox="0 0 40 16">
                  <path d="M 0 8 L 32 8" stroke="currentColor" strokeDasharray="2 2" strokeWidth="2" />
                  <polygon fill="currentColor" points="32,4 40,8 32,12" />
                </svg>
                <motion.div
                  data-testid="preview-flow-dot"
                  animate={prefersReducedMotion ? { opacity: 0.8 } : { x: [-8, 8], opacity: [0.45, 1, 0.45] }}
                  transition={prefersReducedMotion ? undefined : { duration: 1.1, repeat: Infinity, delay: 0.36 }}
                  className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary"
                />
              </div>
            )}

            {/* NODE 4: Condition Node */}
            {visibleNodesCount >= 4 && (
              <div className="w-64 bg-card rounded-lg border border-border flex flex-col relative transition-all">
                <div className="h-8 px-3 bg-run-bg rounded-t-lg flex items-center justify-between border-b border-run/30">
                  <div className="flex items-center gap-2">
                    <GitBranch size={14} className="text-run" />
                    <span className="text-xs font-semibold text-foreground">{t('ai_gen.diagram.node.condition')}</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-run-bg text-run">
                    LOGIC
                  </span>
                </div>
                <div className="p-2.5 space-y-2 text-xs">
                  <div>
                    <p className="font-semibold text-foreground text-[11px]">{t('ai_gen.diagram.order_total')}</p>
                    <p className="font-mono text-[10px] text-muted-foreground truncate">eval({`{{$json.amount}}`} &gt; 10000)</p>
                  </div>
                <div className="p-1.5 bg-subtle rounded font-mono text-[10px] text-text-2 flex items-center justify-between">
                    <span>{t('ai_gen.diagram.branch')}: true</span>
                    <span className="text-ok font-semibold font-mono">{t('ai_gen.diagram.passed')}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border">
                    <span>{t('ai_gen.diagram.operator')}: GreaterThan</span>
                    <span className="text-ok font-semibold font-mono">{t('ai_gen.diagram.evaluated')}</span>
                  </div>
                </div>
              </div>
            )}

            {/* CONNECTOR 4 -> 5 */}
            {visibleNodesCount >= 5 && (
              <div className="w-10 flex items-center justify-center relative">
                <svg className="w-full h-4 text-muted-foreground" fill="none" viewBox="0 0 40 16">
                  <path d="M 0 8 L 32 8" stroke="currentColor" strokeDasharray="2 2" strokeWidth="2" />
                  <polygon fill="currentColor" points="32,4 40,8 32,12" />
                </svg>
                <motion.div
                  data-testid="preview-flow-dot"
                  animate={prefersReducedMotion ? { opacity: 0.8 } : { x: [-8, 8], opacity: [0.45, 1, 0.45] }}
                  transition={prefersReducedMotion ? undefined : { duration: 1.1, repeat: Infinity, delay: 0.54 }}
                  className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary"
                />
              </div>
            )}

            {/* NODE 5: Slack Dispatch Action */}
            {visibleNodesCount >= 5 && (
              <div className="w-64 bg-card rounded-lg border border-border flex flex-col relative transition-all">
                <div className="h-8 px-3 bg-ok-bg rounded-t-lg flex items-center justify-between border-b border-ok/30">
                  <div className="flex items-center gap-2">
                    <Send size={14} className="text-ok" />
                    <span className="text-xs font-semibold text-foreground">{t('ai_gen.diagram.node.slack')}</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-ok-bg text-ok">
                    ACTION
                  </span>
                </div>
                <div className="p-2.5 space-y-2 text-xs">
                  <div>
                    <p className="font-semibold text-foreground text-[11px]">{t('ai_gen.diagram.notify_channel')}</p>
                    <p className="font-mono text-[10px] text-muted-foreground truncate">BlockKit: {t('ai_gen.diagram.order_vip_notification')}</p>
                  </div>
                <div className="p-1.5 bg-subtle rounded font-mono text-[10px] text-text-2 flex items-center justify-between">
                    <span>{t('ai_gen.diagram.channel')}: #sales-alerts</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-ok" />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border">
                    <span>{t('ai_gen.diagram.webhook_bot_active')}</span>
                    <span className="text-ok font-semibold font-mono">{t('ai_gen.ready')}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Optional technical details */}
      <details data-testid="technical-details" className="group rounded-xl border border-border bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-text-2 transition-colors hover:text-foreground">
          <span className="inline-flex items-center gap-2">
            <Code2 size={15} className="text-run" />
            {t('ai_gen.technical_details')}
            <span className="text-xs font-normal text-muted-foreground">{t('ai_gen.optional')}</span>
          </span>
        </summary>
        <div className="grid grid-cols-1 gap-4 border-t border-border p-3 lg:grid-cols-3">
        {/* Left: Variable Bindings */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3 lg:col-span-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 size={16} className="text-run" />
              <span className="text-xs font-bold text-foreground">{t('ai_gen.diagram.variable_bindings')}</span>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">{t('ai_gen.diagram.parameters_bound').replace('{count}', '3')}</span>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('ai_gen.diagram.variable_bindings_description')}
          </p>

          <div className="space-y-2 font-mono text-xs">
            <div className="p-2.5 rounded bg-subtle border border-border space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-run font-semibold truncate">{`{{$json.body.order_id}}`}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-text-2">
                  UUIDv4
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">{t('ai_gen.diagram.mapping.node_1')}</p>
            </div>

            <div className="p-2.5 rounded bg-subtle border border-border space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-run font-semibold truncate">{`{{$json.customer_profile}}`}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-text-2">
                  Object
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">{t('ai_gen.diagram.mapping.node_3')}</p>
            </div>

            <div className="p-2.5 rounded bg-subtle border border-border space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-run font-semibold truncate">{`{{$json.inventory_status}}`}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-text-2">
                  Boolean
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">{t('ai_gen.diagram.mapping.node_2')}</p>
            </div>
          </div>

          <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Lock size={12} className="text-ok" />
              {t('ai_gen.diagram.no_secret_leaks')}
            </span>
            <button className="text-run hover:underline font-medium text-[11px]">{t('ai_gen.diagram.view_map')}</button>
          </div>
        </div>

        {/* Right: Synthesized Workflow AST JSON Specification */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3 lg:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Terminal size={16} className="text-run" />
              <span className="text-xs font-bold text-foreground">
                {t('ai_gen.diagram.synthesized_definition')}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyJson}
                className="h-6 px-2 rounded text-[11px] font-medium bg-subtle hover:bg-muted text-text-2 transition-colors flex items-center gap-1"
              >
                <Copy size={11} />
                <span>{copiedCode ? t('ai_gen.diagram.copied') : t('ai_gen.diagram.copy_json')}</span>
              </button>
              <span className="text-ok font-mono text-[10px] font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-ok" />
                {t('ai_gen.diagram.valid_rfc').replace('{number}', '8259')}
              </span>
            </div>
          </div>

          {/* Code Block Container */}
          <pre className="p-3 bg-subtle rounded-lg font-mono text-[11px] text-muted-foreground overflow-x-auto max-h-[160px] leading-relaxed border border-border">
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
      </details>

      {/* Prominent Operational Control Bottom Bar (Fixed Sticky) */}
      <div className="fixed bottom-0 left-0 right-0 z-40 md:left-[220px] bg-card/95 backdrop-blur border-t border-border p-3 shadow-pop flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-ok animate-pulse shrink-0" />
          <div className="flex flex-col">
            <span className="text-xs font-bold text-foreground">
              {t('ai_gen.workflow_ready')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <Link
            to="/workflows/new"
            className="px-3 py-1.5 text-xs font-medium text-text-2 hover:text-err hover:bg-err-bg rounded transition-colors"
          >
            {t('ai_gen.discard_draft')}
          </Link>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="px-3 py-1.5 text-xs font-medium bg-subtle hover:bg-muted text-foreground rounded transition-colors"
          >
            {t('ai_gen.edit_prompt')}
          </button>
          <button
            onClick={handleAcceptPipeline}
            className="px-4 py-1.5 text-xs font-semibold bg-primary hover:bg-primary text-white rounded transition-colors flex items-center gap-1.5"
          >
            <Zap size={14} />
            <span>{t('ai_gen.create_workflow')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
