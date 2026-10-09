import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  LayoutGrid,
  Sparkles,
  Zap,
  Plus,
  ArrowRight,
} from 'lucide-react';
import { isWorkflowMockMode, workflowApi } from '../api/workflow.api';
import { workflowV1Api } from '../api/workflow-v1.api';
import { useI18nStore } from '../store/useI18nStore';
import { captureNotificationSession, isCurrentNotificationSession } from '../lib/notifications/session';
import { showSuccessToast } from '../lib/feedback/toast';
import { useNotificationMilestoneRefresh } from '../hooks/useNotificationMilestoneRefresh';
import { NODE_SCHEMAS } from '../lib/nodeSchemas';
import { nodeLabel } from '../lib/nodeLabels';
import { WORKFLOW_TEMPLATES, templateToDraft, type TemplateCategory, type WorkflowTemplate } from '../lib/templates';

const CATEGORY_FILTERS: Array<{ id: 'all' | TemplateCategory; key: string }> = [
  { id: 'all', key: 'create.filter.all' },
  { id: 'chat', key: 'hp.create.filter.chat' },
  { id: 'google', key: 'hp.create.filter.google' },
  { id: 'ai', key: 'hp.create.filter.ai' },
];

const nodeDot = (type: string) => {
  if (type.startsWith('trigger.')) return 'bg-t-trigger';
  if (type.startsWith('ai.')) return 'bg-t-ai';
  if (type.startsWith('logic.') || type.startsWith('data.')) return 'bg-t-logic';
  return 'bg-t-action';
};

const connectionNodeCount = (template: WorkflowTemplate) =>
  template.nodes.filter((node) => NODE_SCHEMAS[node.type]?.required.includes('connectionId')).length;

export const CreateWorkflowPage: React.FC = () => {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { t, language } = useI18nStore();
  const refreshNotifications = useNotificationMilestoneRefresh();

  const [selectedMethod, setSelectedMethod] = useState<'blank' | 'template' | 'ai'>('blank');
  const [activeCategory, setActiveCategory] = useState<'all' | TemplateCategory>('all');
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [blankName, setBlankName] = useState<string>('');

  // Links such as /workflows/new#templates-list land on the templates section.
  useEffect(() => {
    if (hash === '#templates-list') document.getElementById('templates-list')?.scrollIntoView?.();
  }, [hash]);

  const createAndOpen = async (create: () => Promise<string>) => {
    const mutationSession = captureNotificationSession();
    setIsCreating(true);
    setCreateError(null);
    try {
      const workflowId = await create();
      if (!isCurrentNotificationSession(mutationSession)) return;
      showSuccessToast('toast.workflow.created', mutationSession);
      refreshNotifications(mutationSession);
      navigate(`/workflows/${workflowId}/builder`);
    } catch (error) {
      if (isCurrentNotificationSession(mutationSession)) {
        setCreateError(error instanceof Error ? error.message : t('hp.create.failed'));
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleStartBlank = () =>
    createAndOpen(async () => {
      const created = await workflowApi.createWorkflow({
        name: blankName.trim() || t('create.blank_default_name'),
        description: t('hp.create.blank_description'),
      });
      return created.id;
    });

  const handleUseTemplate = (template: WorkflowTemplate) =>
    createAndOpen(async () => {
      const copy = language === 'VI' ? template.vi : template.en;
      if (isWorkflowMockMode) return (await workflowApi.createWorkflow({ name: copy.name, description: copy.description })).id;
      return workflowV1Api.createWorkflowFromDefinition(templateToDraft(template, copy.name));
    });

  const handleGenerateAiCanvas = () => {
    if (!aiPrompt.trim()) {
      navigate('/ai/workflow-generator');
      return;
    }
    navigate('/ai/workflow-generator', { state: { initialPrompt: aiPrompt } });
  };

  const filteredTemplates = WORKFLOW_TEMPLATES.filter((tpl) => activeCategory === 'all' || tpl.category === activeCategory);

  const chip = 'rounded-md bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground';
  const optionCard = (method: typeof selectedMethod) =>
    `group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border bg-card p-5 transition-all ${
      selectedMethod === method
        ? 'border-primary/50 shadow-pop ring-1 ring-primary/20'
        : 'border-border hover:-translate-y-0.5 hover:border-primary/25'
    }`;

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12 font-sans text-foreground">
      {createError && (
        <div role="alert" data-testid="workflow-create-error" className="rounded-xl border border-err-border bg-err-bg px-4 py-3 text-sm text-err">
          {createError}
        </div>
      )}

      {/* Breadcrumb & heading */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link to="/workspace" className="transition-colors hover:text-foreground">
            {t('create.workspace')}
          </Link>
          <span aria-hidden="true" className="text-muted-foreground/50">/</span>
          <Link to="/workflows" className="flex items-center gap-1 transition-colors hover:text-foreground">
            <ArrowLeft size={12} />
            <span>{t('nav.workflows')}</span>
          </Link>
          <span aria-hidden="true" className="text-muted-foreground/50">/</span>
          <span className="font-semibold text-foreground">{t('create.title')}</span>
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[26px]">
            {t('create.title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('create.subtitle')}
          </p>
        </div>
      </div>

      {/* Quick AI prompt — the fastest path, so it leads the page */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-col items-stretch gap-3 rounded-lg p-4 sm:flex-row sm:items-center">
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white">
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
            className="flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
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
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-subtle text-text-2">
                <FileText size={20} />
              </div>
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

          <div className="mt-5 space-y-2">
            <label htmlFor="blank-workflow-name" className="block text-[11px] font-medium text-text-2">{t('create.blank_name')}</label>
            <input
              id="blank-workflow-name"
              data-testid="blank-workflow-name"
              value={blankName}
              maxLength={100}
              placeholder={t('create.blank_default_name')}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setBlankName(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                void handleStartBlank();
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
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-run-bg text-run">
                <LayoutGrid size={20} />
              </div>
              <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                {WORKFLOW_TEMPLATES.length} {t('create.recipes')}
              </span>
            </div>

            <h3 className="text-[15px] font-semibold text-foreground">{t('create.from_template')}</h3>
            <p className="min-h-[40px] text-[13px] leading-relaxed text-muted-foreground">
              {t('create.templates_description')}
            </p>

            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className={chip}>{t('create.preconfigured')}</span>
              <span className={chip}>{t('create.schema_verified')}</span>
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
          <div className="relative space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
                <Sparkles size={20} />
              </div>
              <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-ink">
                {t('create.beta')}
              </span>
            </div>

            <h3 className="text-[15px] font-semibold text-foreground">{t('create.with_ai')}</h3>
            <p className="min-h-[40px] text-[13px] leading-relaxed text-muted-foreground">
              {t('create.ai_description')}
            </p>

            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className={chip}>{t('create.prompt_to_pipeline')}</span>
              <span className={chip}>{t('hp.create.ai_chip_edit')}</span>
            </div>
          </div>

          <div className="relative mt-5">
            <Link
              to="/ai/workflow-generator"
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-white transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Zap size={15} />
              <span>{t('create.synthesize')}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Templates */}
      <div className="space-y-4 pt-2" id="templates-list">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{t('create.popular_templates')}</h2>
            <p className="text-sm text-muted-foreground">{t('hp.create.select_template')}</p>
          </div>

          <div className="flex items-center gap-1 self-start overflow-x-auto rounded-xl bg-muted p-1 sm:self-auto">
            {CATEGORY_FILTERS.map((filter) => (
              <button
                key={filter.id}
                onClick={() => setActiveCategory(filter.id)}
                aria-pressed={activeCategory === filter.id}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeCategory === filter.id
                    ? 'bg-card text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(filter.key)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((tpl) => {
            const copy = language === 'VI' ? tpl.vi : tpl.en;
            const needsConnections = connectionNodeCount(tpl);
            return (
              <div
                key={tpl.id}
                data-testid={`template-${tpl.id}`}
                className="group flex flex-col justify-between rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/25"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className={chip}>{t(`hp.create.filter.${tpl.category}`)}</span>
                    {needsConnections > 0 ? (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {needsConnections} {t('hp.create.needs_connections')}
                      </span>
                    ) : null}
                  </div>

                  <h4 className="pt-1 text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                    {copy.name}
                  </h4>
                  <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {copy.description}
                  </p>

                  {/* Flow preview */}
                  <div className="my-3 flex items-center gap-1 overflow-hidden rounded-xl border border-border bg-muted/40 p-2 font-mono text-[10px] text-foreground/80">
                    {tpl.nodes.map((node, i) => (
                      <React.Fragment key={node.id}>
                        <div className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${nodeDot(node.type)}`} />
                          <span className="max-w-[64px] truncate">{nodeLabel(node.type, t)}</span>
                        </div>
                        {i < tpl.nodes.length - 1 && <span aria-hidden="true" className="h-px min-w-2 flex-1 bg-border" />}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border pt-3">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {tpl.nodes.length} {t('create.steps')}
                  </span>
                  <button
                    type="button"
                    aria-label={`${t('create.use_template')}: ${copy.name}`}
                    onClick={() => void handleUseTemplate(tpl)}
                    disabled={isCreating}
                    className="flex h-8 items-center gap-1 rounded-lg bg-muted px-3 text-xs font-medium text-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    <span>{t('create.use_template')}</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
