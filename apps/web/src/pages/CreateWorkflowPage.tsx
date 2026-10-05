import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  LayoutGrid,
  Sparkles,
  Zap,
  Plus,
  ArrowRight,
} from 'lucide-react';
import { workflowApi } from '../api/workflow.api';
import { useI18nStore } from '../store/useI18nStore';
import { captureNotificationSession, isCurrentNotificationSession } from '../lib/notifications/session';
import { showSuccessToast } from '../lib/feedback/toast';
import { useNotificationMilestoneRefresh } from '../hooks/useNotificationMilestoneRefresh';

interface TemplateCard {
  id: string;
  category: string;
  categoryLabel: string;
  title: string;
  description: string;
  stepsCount: number;
  avgDuration: string;
  triggerType: string;
  triggerColor: string;
  flow: Array<{ name: string; type: 'trigger' | 'ai' | 'action' | 'logic' }>;
}

const TEMPLATES: TemplateCard[] = [
  {
    id: 'tpl-1',
    category: 'customer-ops',
    categoryLabel: 'E-Commerce & Ops',
    title: 'Order notification & fulfillment',
    description: 'Ingest webhook payloads from Shopify or Stripe, extract line items with structured AI parser, and dispatch Slack alerts.',
    stepsCount: 3,
    avgDuration: '~140ms',
    triggerType: 'Webhook',
    triggerColor: 'bg-[#2563EB]',
    flow: [
      { name: 'Webhook', type: 'trigger' },
      { name: 'AI Extract', type: 'ai' },
      { name: 'Slack Alert', type: 'action' },
    ],
  },
  {
    id: 'tpl-2',
    category: 'data-etl',
    categoryLabel: 'DevOps & Data',
    title: 'Daily DB backup & S3 audit',
    description: 'Scheduled snapshot of PostgreSQL clusters with checksum validation, storage upload, and automated incident paging.',
    stepsCount: 4,
    avgDuration: '1.2m',
    triggerType: 'Cron (Daily)',
    triggerColor: 'bg-[#2563EB]',
    flow: [
      { name: 'Cron', type: 'trigger' },
      { name: 'Postgres', type: 'action' },
      { name: 'S3 Dump', type: 'action' },
      { name: 'Audit', type: 'logic' },
    ],
  },
  {
    id: 'tpl-3',
    category: 'customer-ops',
    categoryLabel: 'CRM & Sales',
    title: 'Customer onboarding & enrichment',
    description: 'Enrich new signup domains via Clearbit, route VIP accounts to sales executives, and synchronize contacts to BigQuery.',
    stepsCount: 3,
    avgDuration: '~210ms',
    triggerType: 'Event',
    triggerColor: 'bg-[#2563EB]',
    flow: [
      { name: 'Webhook', type: 'trigger' },
      { name: 'Enrich AI', type: 'ai' },
      { name: 'BigQuery', type: 'action' },
    ],
  },
  {
    id: 'tpl-4',
    category: 'ai-vectors',
    categoryLabel: 'Support & AI',
    title: 'Zendesk priority triage & vectors',
    description: 'Classify incoming tickets by urgency score, vectorize customer context into Pinecone, and draft preliminary answers.',
    stepsCount: 3,
    avgDuration: '~580ms',
    triggerType: 'Ticket Webhook',
    triggerColor: 'bg-[#2563EB]',
    flow: [
      { name: 'Zendesk', type: 'trigger' },
      { name: 'Embeddings', type: 'ai' },
      { name: 'Vector DB', type: 'action' },
    ],
  },
  {
    id: 'tpl-5',
    category: 'data-etl',
    categoryLabel: 'Data Pipeline',
    title: 'PostgreSQL to BigQuery ETL sync',
    description: 'Incremental hourly extraction of transaction tables with strict type validation, row hashing, and automatic retry buffers.',
    stepsCount: 4,
    avgDuration: '~3.4m',
    triggerType: 'Hourly',
    triggerColor: 'bg-[#2563EB]',
    flow: [
      { name: 'Sched', type: 'trigger' },
      { name: 'Postgres', type: 'action' },
      { name: 'Transform', type: 'ai' },
      { name: 'BigQuery', type: 'action' },
    ],
  },
  {
    id: 'tpl-6',
    category: 'ai-vectors',
    categoryLabel: 'Document AI',
    title: 'Invoice PDF OCR & Slack dispatcher',
    description: 'Extract invoice tables, tax identification numbers, and line items from email attachments to Google Sheets and Slack alerts.',
    stepsCount: 4,
    avgDuration: '~1.8s',
    triggerType: 'IMAP / S3',
    triggerColor: 'bg-[#2563EB]',
    flow: [
      { name: 'Email', type: 'trigger' },
      { name: 'OCR AI', type: 'ai' },
      { name: 'Sheets', type: 'action' },
      { name: 'Slack', type: 'action' },
    ],
  },
];

const TEMPLATE_CATEGORY_KEYS: Record<string, string> = {
  'tpl-1': 'create.category.ecommerce',
  'tpl-2': 'create.category.devops',
  'tpl-3': 'create.category.crm',
  'tpl-4': 'create.category.support',
  'tpl-5': 'create.category.pipeline',
  'tpl-6': 'create.category.document_ai',
};

export const CreateWorkflowPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useI18nStore();
  const refreshNotifications = useNotificationMilestoneRefresh();

  const [selectedMethod, setSelectedMethod] = useState<'blank' | 'template' | 'ai'>('blank');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleStartBlank = async () => {
    const mutationSession = captureNotificationSession();
    setIsCreating(true);
    setCreateError(null);
    try {
      const newWf = await workflowApi.createWorkflow({
        name: 'Untitled Automation Pipeline',
        description: 'Custom blank workflow created from canvas editor.',
      });
      if (!isCurrentNotificationSession(mutationSession)) return;
      showSuccessToast('toast.workflow.created', mutationSession);
      refreshNotifications(mutationSession);
      navigate(`/workflows/${newWf.id}/builder`);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) {
        setCreateError(error instanceof Error ? error.message : 'Workflow could not be created.');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleUseTemplate = async (templateTitle: string) => {
    const mutationSession = captureNotificationSession();
    setIsCreating(true);
    setCreateError(null);
    try {
      const newWf = await workflowApi.createWorkflow({
        name: templateTitle,
        description: `Workflow bootstrapped from template: ${templateTitle}`,
      });
      if (!isCurrentNotificationSession(mutationSession)) return;
      showSuccessToast('toast.workflow.created', mutationSession);
      refreshNotifications(mutationSession);
      navigate(`/workflows/${newWf.id}/builder`);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) {
        setCreateError(error instanceof Error ? error.message : 'Workflow could not be created.');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleGenerateAiCanvas = () => {
    if (!aiPrompt.trim()) {
      navigate('/ai/workflow-generator');
      return;
    }
    navigate('/ai/workflow-generator', { state: { initialPrompt: aiPrompt } });
  };

  const filteredTemplates = TEMPLATES.filter((tpl) => {
    if (activeCategory === 'all') return true;
    return tpl.category === activeCategory;
  });

  const chip = 'rounded-md bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground';
  const optionCard = (method: typeof selectedMethod) =>
    `group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border bg-card p-5 transition-all ${
      selectedMethod === method
        ? 'border-primary/50 shadow-lift ring-1 ring-primary/20'
        : 'border-border shadow-soft hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lift'
    }`;
  const flowDot: Record<string, string> = {
    trigger: 'bg-amber-500',
    ai: 'bg-violet-500',
    logic: 'bg-sky-500',
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12 font-sans text-foreground">
      {createError && (
        <div role="alert" data-testid="workflow-create-error" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300">
          {createError}
        </div>
      )}

      {/* Breadcrumb & heading */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link to="/workspace" className="transition-colors hover:text-foreground">
            {t('create.workspace')}
          </Link>
          <span className="text-muted-foreground/50">/</span>
          <Link to="/workflows" className="flex items-center gap-1 transition-colors hover:text-foreground">
            <ArrowLeft size={12} />
            <span>{t('nav.workflows')}</span>
          </Link>
          <span className="text-muted-foreground/50">/</span>
          <span className="font-semibold text-foreground">{t('create.title')}</span>
        </div>

        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[26px]">
              {t('create.title')}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('create.subtitle')}
            </p>
          </div>

          <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-card px-3 py-1 font-mono text-xs text-muted-foreground shadow-soft sm:self-auto">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" />
            {t('create.production_cluster')} (us-east-1)
          </span>
        </div>
      </div>

      {/* Quick AI prompt — the fastest path, so it leads the page */}
      <div className="rounded-2xl bg-brand-gradient p-px shadow-brand">
        <div className="page-hero-glow flex flex-col items-stretch gap-3 rounded-[15px] bg-card p-4 sm:flex-row sm:items-center">
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-white">
              <Sparkles size={17} />
            </span>
            <span className="text-sm font-semibold text-foreground">{t('create.quick_prompt')}</span>
          </div>

          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleGenerateAiCanvas();
            }}
            placeholder={t('create.prompt_placeholder')}
            aria-label={t('create.quick_prompt')}
            className="h-10 w-full flex-1 rounded-xl border border-border bg-muted/50 px-3.5 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:bg-card focus:outline-none focus:ring-4 focus:ring-primary/10"
          />

          <button
            onClick={handleGenerateAiCanvas}
            className="flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
          >
            <span>{t('create.generate_canvas')}</span>
            <ArrowRight size={15} />
          </button>
        </div>
      </div>

      {/* Creation methods */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Option 1: Blank Workflow */}
        <div onClick={() => setSelectedMethod('blank')} className={optionCard('blank')}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-500/10 dark:text-slate-200">
                <FileText size={20} />
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">v2.4 engine</span>
            </div>

            <h3 className="text-[15px] font-semibold text-foreground">{t('create.blank')}</h3>
            <p className="min-h-[40px] text-[13px] leading-relaxed text-muted-foreground">
              {t('create.blank_description')}
            </p>

            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className={chip}>{t('create.full_control')}</span>
              <span className={chip}>{t('create.custom_triggers')}</span>
              <span className={chip}>{t('create.any_payload')}</span>
            </div>
          </div>

          <div className="mt-5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleStartBlank();
              }}
              disabled={isCreating}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <Plus size={15} />
              <span>{isCreating ? t('create.creating') : t('create.start_blank')}</span>
            </button>
          </div>
        </div>

        {/* Option 2: Pre-configured Template */}
        <div onClick={() => setSelectedMethod('template')} className={optionCard('template')}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
                <LayoutGrid size={20} />
              </div>
              <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                {t('create.recipes')}
              </span>
            </div>

            <h3 className="text-[15px] font-semibold text-foreground">{t('create.from_template')}</h3>
            <p className="min-h-[40px] text-[13px] leading-relaxed text-muted-foreground">
              {t('create.templates_description')}
            </p>

            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className={chip}>{t('create.preconfigured')}</span>
              <span className={chip}>{t('create.schema_verified')}</span>
              <span className={chip}>{t('create.zero_latency')}</span>
            </div>
          </div>

          <div className="mt-5">
            <a
              href="#templates-list"
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LayoutGrid size={15} />
              <span>{t('create.browse_templates')}</span>
            </a>
          </div>
        </div>

        {/* Option 3: Create with AI */}
        <div onClick={() => setSelectedMethod('ai')} className={optionCard('ai')}>
          <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-gradient opacity-15 blur-2xl" />
          <div className="relative space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-brand">
                <Sparkles size={20} />
              </div>
              <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-semibold text-primary">
                {t('create.beta')}
              </span>
            </div>

            <h3 className="text-[15px] font-semibold text-foreground">{t('create.with_ai')}</h3>
            <p className="min-h-[40px] text-[13px] leading-relaxed text-muted-foreground">
              {t('create.ai_description')}
            </p>

            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className={chip}>{t('create.prompt_to_pipeline')}</span>
              <span className={chip}>{t('create.auto_mapping')}</span>
              <span className={chip}>{t('create.dry_run_preview')}</span>
            </div>
          </div>

          <div className="relative mt-5">
            <Link
              to="/ai/workflow-generator"
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-brand-gradient px-3 text-sm font-semibold text-white shadow-brand transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Zap size={15} />
              <span>{t('create.synthesize')}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Popular templates */}
      <div className="space-y-4 pt-2" id="templates-list">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{t('create.popular_templates')}</h2>
            <p className="text-sm text-muted-foreground">{t('create.select_template')}</p>
          </div>

          <div className="flex items-center gap-1 self-start overflow-x-auto rounded-xl bg-muted p-1 sm:self-auto">
            {[
              { id: 'all', label: t('create.filter.all') },
              { id: 'data-etl', label: t('create.filter.data_etl') },
              { id: 'customer-ops', label: t('create.filter.customer_ops') },
              { id: 'ai-vectors', label: t('create.filter.ai_vectors') },
            ].map((filter) => (
              <button
                key={filter.id}
                onClick={() => setActiveCategory(filter.id)}
                aria-pressed={activeCategory === filter.id}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeCategory === filter.id
                    ? 'bg-card text-foreground shadow-soft'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((tpl) => (
            <div
              key={tpl.id}
              className="group flex flex-col justify-between rounded-2xl border border-border bg-card p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lift"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className={chip}>{t(TEMPLATE_CATEGORY_KEYS[tpl.id])}</span>
                  <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    {t(`create.trigger.${tpl.triggerType.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`)}
                  </span>
                </div>

                <h4 className="pt-1 text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                  {t(`create.template.${tpl.id}.title`)}
                </h4>
                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {t(`create.template.${tpl.id}.description`)}
                </p>

                {/* Flow preview */}
                <div className="my-3 flex items-center gap-1 overflow-hidden rounded-xl border border-border bg-muted/40 p-2 font-mono text-[10px] text-foreground/80">
                  {tpl.flow.map((node, i) => (
                    <React.Fragment key={i}>
                      <div className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1 shadow-soft">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${flowDot[node.type] ?? 'bg-emerald-500'}`} />
                        <span className="max-w-[64px] truncate">{t(`create.flow.${node.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`)}</span>
                      </div>
                      {i < tpl.flow.length - 1 && <span aria-hidden="true" className="h-px min-w-2 flex-1 bg-border" />}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {tpl.stepsCount} {t('create.steps')} • {tpl.avgDuration}
                </span>
                <button
                  onClick={() => handleUseTemplate(tpl.title)}
                  className="flex h-8 items-center gap-1 rounded-lg bg-muted px-3 text-xs font-medium text-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span>{t('create.use_template')}</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
