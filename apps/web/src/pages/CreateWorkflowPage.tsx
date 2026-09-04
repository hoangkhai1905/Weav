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

export const CreateWorkflowPage: React.FC = () => {
  const navigate = useNavigate();

  const [selectedMethod, setSelectedMethod] = useState<'blank' | 'template' | 'ai'>('blank');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [isCreating, setIsCreating] = useState<boolean>(false);

  const handleStartBlank = async () => {
    setIsCreating(true);
    try {
      const newWf = await workflowApi.createWorkflow({
        name: 'Untitled Automation Pipeline',
        description: 'Custom blank workflow created from canvas editor.',
      });
      navigate(`/workflows/${newWf.id}/builder`);
    } catch {
      navigate('/workflows/wf-prod-8492/builder');
    } finally {
      setIsCreating(false);
    }
  };

  const handleUseTemplate = async (templateTitle: string) => {
    setIsCreating(true);
    try {
      const newWf = await workflowApi.createWorkflow({
        name: templateTitle,
        description: `Workflow bootstrapped from template: ${templateTitle}`,
      });
      navigate(`/workflows/${newWf.id}/builder`);
    } catch {
      navigate('/workflows/wf-prod-8492/builder');
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

  return (
    <div className="space-y-6 text-slate-900 dark:text-slate-100 font-sans">
      {/* Top Breadcrumb & Page Heading */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Link to="/workspace" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
            Workspace
          </Link>
          <span>/</span>
          <Link to="/workflows" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors flex items-center gap-1">
            <ArrowLeft size={12} />
            <span>Workflows</span>
          </Link>
          <span>/</span>
          <span className="text-slate-900 dark:text-slate-100 font-semibold">Create workflow</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-1">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Create workflow
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              Choose how you want to start building your automated pipeline.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-mono border border-slate-200 dark:border-slate-700">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Production Cluster (us-east-1)
            </span>
          </div>
        </div>
      </div>

      {/* 3-Panel Creation Options Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Option 1: Blank Workflow */}
        <div
          onClick={() => setSelectedMethod('blank')}
          className={`cursor-pointer rounded-xl p-5 bg-white dark:bg-slate-900 border transition-all flex flex-col justify-between ${
            selectedMethod === 'blank'
              ? 'border-[#2563EB] ring-1 ring-[#2563EB] shadow-md shadow-[#2563EB]/10'
              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-800 dark:text-slate-200">
                <FileText size={20} />
              </div>
              <span className="font-mono text-[10px] text-slate-400">v2.4 engine</span>
            </div>

            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Blank workflow</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed min-h-[40px]">
              Start from an empty canvas and assemble triggers, custom logic, and target actions from scratch.
            </p>

            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                Full control
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                Custom triggers
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                Any payload
              </span>
            </div>
          </div>

          <div className="pt-5 mt-4 border-t border-slate-100 dark:border-slate-800/80">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleStartBlank();
              }}
              disabled={isCreating}
              className="w-full h-8 px-3 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus size={14} />
              <span>{isCreating ? 'Creating...' : 'Start blank'}</span>
            </button>
          </div>
        </div>

        {/* Option 2: Pre-configured Template */}
        <div
          onClick={() => setSelectedMethod('template')}
          className={`cursor-pointer rounded-xl p-5 bg-white dark:bg-slate-900 border transition-all flex flex-col justify-between ${
            selectedMethod === 'template'
              ? 'border-[#2563EB] ring-1 ring-[#2563EB] shadow-md shadow-[#2563EB]/10'
              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-800 dark:text-slate-200">
                <LayoutGrid size={20} />
              </div>
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                30+ recipes
              </span>
            </div>

            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">From template</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed min-h-[40px]">
              Jumpstart with battle-tested automation templates tailored for modern data & engineering stacks.
            </p>

            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                Pre-configured
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                Schema verified
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                Zero latency
              </span>
            </div>
          </div>

          <div className="pt-5 mt-4 border-t border-slate-100 dark:border-slate-800/80">
            <a
              href="#templates-list"
              className="w-full h-8 px-3 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
            >
              <LayoutGrid size={14} />
              <span>Browse templates</span>
            </a>
          </div>
        </div>

        {/* Option 3: Create with AI */}
        <div
          onClick={() => setSelectedMethod('ai')}
          className={`cursor-pointer rounded-xl p-5 bg-white dark:bg-slate-900 border transition-all flex flex-col justify-between ${
            selectedMethod === 'ai'
              ? 'border-[#2563EB] ring-1 ring-[#2563EB] shadow-md shadow-[#2563EB]/10'
              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-lg bg-[#2563EB]/10 flex items-center justify-center text-[#2563EB]">
                <Sparkles size={20} />
              </div>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#2563EB]/10 text-[#2563EB]">
                Beta
              </span>
            </div>

            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <span>Create with AI</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed min-h-[40px]">
              Describe your target automation in natural language and let WEAV compile nodes, code, and routing.
            </p>

            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                Prompt-to-pipeline
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                Auto-mapping
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                Dry run preview
              </span>
            </div>
          </div>

          <div className="pt-5 mt-4 border-t border-slate-100 dark:border-slate-800/80">
            <Link
              to="/ai/workflow-generator"
              className="w-full h-8 px-3 rounded bg-[#2563EB] hover:bg-[#1d4ed8] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
            >
              <Zap size={14} />
              <span>Synthesize pipeline</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Quick Inline AI Prompt Assistant Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="flex items-center gap-2 text-[#2563EB] shrink-0">
          <Sparkles size={16} />
          <span className="text-xs font-medium text-slate-900 dark:text-slate-100">Quick prompt:</span>
        </div>

        <div className="relative flex-1 w-full">
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="e.g. Ingest Stripe charge.failed webhooks, query PostgreSQL users table, format alert and post to #incident-ops in Slack..."
            className="w-full h-9 pl-3 pr-8 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 rounded-lg placeholder:text-slate-400 focus:outline-none focus:border-[#2563EB] border border-slate-200 dark:border-slate-700"
          />
        </div>

        <button
          onClick={handleGenerateAiCanvas}
          className="w-full sm:w-auto h-9 px-4 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-900 dark:text-slate-100 transition-colors flex items-center justify-center gap-1.5 shrink-0"
        >
          <span>Generate canvas</span>
          <ArrowRight size={14} />
        </button>
      </div>

      {/* Popular Templates Section Header & Filter Controls */}
      <div className="pt-2 space-y-4" id="templates-list">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Popular templates</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Select a verified blueprint to customize and trigger directly.</p>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg self-start sm:self-auto overflow-x-auto">
            {[
              { id: 'all', label: 'All' },
              { id: 'data-etl', label: 'Data & ETL' },
              { id: 'customer-ops', label: 'Customer Ops' },
              { id: 'ai-vectors', label: 'AI & Vectors' },
            ].map((filter) => (
              <button
                key={filter.id}
                onClick={() => setActiveCategory(filter.id)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  activeCategory === filter.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {/* Templates Grid (Dense Technical Layout) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((tpl) => (
            <div
              key={tpl.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-xl p-4 flex flex-col justify-between shadow-xs hover:shadow-md transition-all group"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    {tpl.categoryLabel}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
                    {tpl.triggerType}
                  </span>
                </div>

                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-[#2563EB] transition-colors">
                  {tpl.title}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                  {tpl.description}
                </p>

                {/* Graph Flow Sequence Preview */}
                <div className="my-3 p-2 rounded bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between font-mono text-[10px] text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-800">
                  {tpl.flow.map((node, i) => (
                    <React.Fragment key={i}>
                      <div className="flex items-center gap-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            node.type === 'trigger'
                              ? 'bg-amber-500'
                              : node.type === 'ai'
                              ? 'bg-[#2563EB]'
                              : node.type === 'logic'
                              ? 'bg-sky-500'
                              : 'bg-emerald-500'
                          }`}
                        />
                        <span className="truncate max-w-[64px]">{node.name}</span>
                      </div>
                      {i < tpl.flow.length - 1 && <span className="text-slate-400 font-bold">→</span>}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                <span className="font-mono text-[10px] text-slate-400">
                  {tpl.stepsCount} steps • {tpl.avgDuration}
                </span>
                <button
                  onClick={() => handleUseTemplate(tpl.title)}
                  className="h-7 px-2.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-[#2563EB] hover:text-white text-slate-800 dark:text-slate-200 text-xs font-medium transition-colors flex items-center gap-1"
                >
                  <span>Use template</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
