import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { isWorkflowMockMode, workflowApi } from '../api/workflow.api';
import { useI18nStore } from '../store/useI18nStore';
import { showErrorToast } from '../lib/feedback/toast';

const PROMPT_MAX_LENGTH = 4000;
const NAME_MAX_LENGTH = 60;
const STARTERS = ['email_sheet', 'weekly_calendar', 'daily_summary', 'drive_invoice'] as const;

function nameFromPrompt(prompt: string, fallback: string) {
  const text = prompt.replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > NAME_MAX_LENGTH ? `${text.slice(0, NAME_MAX_LENGTH - 1).trimEnd()}…` : text;
}

export function AiGeneratorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18nStore();
  const [prompt, setPrompt] = useState<string>(
    (location.state as { initialPrompt?: string } | null)?.initialPrompt ?? '',
  );
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = !isCreating && !isWorkflowMockMode && prompt.trim().length > 0;

  // Creates an empty draft, then hands the prompt to the builder (router state, never the URL),
  // which opens the generate panel prefilled. The user confirms generation there.
  const handleContinue = async () => {
    if (!canSubmit) return;
    setIsCreating(true);
    setError(null);
    try {
      const created = await workflowApi.createWorkflow({ name: nameFromPrompt(prompt, t('ai_gen.default_name')) });
      navigate(`/workflows/${created.id}/builder`, { state: { generatePrompt: prompt.trim() } });
    } catch {
      setError(t('ai_gen.create_failed'));
      showErrorToast('ai_gen.create_failed');
      setIsCreating(false);
    }
  };

  return (
    <div data-testid="ai-generator-page" className="space-y-5 pb-8 font-sans text-foreground">
      <div className="space-y-2">
        <Link
          to="/workflows"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {t('ai_gen.back')}
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-foreground">{t('ai_gen.title')}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('ai_gen.simple_subtitle')}</p>
      </div>

      <section data-testid="ai-prompt-workbench" className="max-w-3xl space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <label htmlFor="workflow-prompt" className="text-sm font-semibold text-foreground">
              {t('ai_gen.prompt_label')}
            </label>
            <p id="workflow-prompt-hint" className="mt-1 text-xs text-muted-foreground">{t('ai_gen.prompt_hint')}</p>
          </div>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {t('ai_gen.characters').replace('{count}', String(prompt.length))}
          </span>
        </div>

        <textarea
          id="workflow-prompt"
          aria-describedby="workflow-prompt-hint"
          value={prompt}
          maxLength={PROMPT_MAX_LENGTH}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          className="w-full resize-y rounded-lg border border-border bg-subtle p-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground"
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">{t('ai_gen.try_example')}</span>
          {STARTERS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setPrompt(t(`ai_gen.starter_prompt.${key}`))}
              className="rounded-md border border-border-strong bg-card px-2.5 py-1 text-[11px] font-medium text-text-2 transition-colors hover:border-run/30 hover:bg-run-bg hover:text-run"
            >
              {t(`ai_gen.starter.${key}`)}
            </button>
          ))}
        </div>

        {isWorkflowMockMode ? (
          <p data-testid="ai-generator-mock-note" role="note" className="rounded border border-warn/30 bg-warn-bg px-2.5 py-1.5 text-xs text-warn">
            {t('ai_gen.mock_note')}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{t('ai_gen.next_step')}</p>
        )}
        {error ? <p role="alert" data-testid="ai-generator-error" className="text-xs text-err">{error}</p> : null}

        <div className="flex justify-end">
          <button
            type="button"
            data-testid="ai-generator-continue"
            onClick={() => void handleContinue()}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreating ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
            <span>{isCreating ? t('ai_gen.building') : t('ai_gen.btn_generate')}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
