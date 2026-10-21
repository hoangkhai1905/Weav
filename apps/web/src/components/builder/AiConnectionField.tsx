import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import { AI_PROVIDER_NAMES, isAiProvider, type AiProvider } from '../../lib/aiProviders';
import type { ConnectionResponse } from '../../api/connection.api';
import { FieldShell } from './FieldShell';

type AiPatch = { connectionId?: string; model?: string };
interface AiFieldProps {
  config: Record<string, unknown>;
  connections: ConnectionResponse[];
  /** A key set to `undefined` removes it from the step's config. */
  onChange: (patch: AiPatch) => void;
}

// Same rule as the workflow schema; the server stays the authority.
const MODEL_RULE = /^[A-Za-z0-9._:/-]{1,100}$/;
// The model each provider uses when the step names none (ai-service defaults), shown as the example.
const DEFAULT_MODELS: Record<AiProvider, string> = { OPENAI: 'gpt-5-mini', ANTHROPIC: 'claude-haiku-5-5', GEMINI: 'gemini-2.5-flash' };
const inputCls = 'w-full rounded-md border border-border-strong bg-card px-3 py-2 text-[13px] text-foreground outline-none hover:border-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring';
// "ChatGPT (OpenAI)" -> "ChatGPT"
const shortName = (provider: AiProvider) => AI_PROVIDER_NAMES[provider].replace(/ \(.*\)$/, '');

/** "AI for this step": the Weav default AI, or one of the workspace's own ChatGPT, Claude or Gemini connections. */
export const AiConnectionField: React.FC<AiFieldProps> = ({ config, connections, onChange }) => {
  const { t } = useI18nStore();
  const options = connections.filter((connection) => isAiProvider(connection.provider) && connection.status === 'ACTIVE' && connection.canAttach);
  const current = String(config.connectionId ?? '');
  const providerOf = (id: string) => connections.find((connection) => connection.id === id)?.provider;
  return (
    <div data-testid="ai-connection">
      <FieldShell id="ai-connection-select" label={t('builder.ai.connection')} hint={t('builder.ai.connection_hint')}>
        {({ id, describedBy }) => (
          <select
            id={id}
            data-testid="ai-connection-select"
            aria-describedby={describedBy}
            value={current}
            onChange={(event) => {
              const next = event.target.value;
              // The default AI takes no model, and a model of one provider does not fit another.
              onChange(next && providerOf(next) === providerOf(current)
                ? { connectionId: next }
                : { connectionId: next || undefined, model: undefined });
            }}
            className={inputCls}
          >
            <option value="">{t('builder.ai.default')}</option>
            {options.map((connection) => <option key={connection.id} value={connection.id}>{`${connection.name} (${shortName(connection.provider as AiProvider)})`}</option>)}
            {current && !options.some((connection) => connection.id === current) && <option value={current}>{t('builder.cfg.unavailable_connection')}</option>}
          </select>
        )}
      </FieldShell>
      <Link to="/workspace/connections" data-testid="add-connection-AI" className="mt-1.5 inline-flex items-center gap-1 rounded text-xs font-medium text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Plus size={12} aria-hidden="true" />{t('builder.ai.add_connection')}
      </Link>
    </div>
  );
};

/** "Model name" of a step that uses its own AI connection; nothing for the default AI (unless a model is still set). Belongs under the step's extra options. */
export const AiModelField: React.FC<AiFieldProps> = ({ config, connections, onChange }) => {
  const { t } = useI18nStore();
  // Text that breaks the model rule is shown with a message but never written to the config.
  const [draft, setDraft] = useState<string | null>(null);
  // An orphan model (a shared template drops the connection but may keep it) stays visible so it can be cleared.
  if (!String(config.connectionId ?? '').trim() && !String(config.model ?? '').trim()) return null;
  const provider = connections.find((connection) => connection.id === config.connectionId)?.provider;
  const example = provider && isAiProvider(provider) ? `${t('builder.field.example_prefix')}${DEFAULT_MODELS[provider]}` : undefined;
  const shown = draft ?? String(config.model ?? '');
  const invalid = draft !== null && !MODEL_RULE.test(draft.trim());
  return (
    <FieldShell id="ai-model" label={t('builder.ai.model')} hint={t('builder.ai.model_hint')} error={invalid ? t('builder.ai.model_invalid') : undefined}>
      {({ id, describedBy }) => (
        <input
          id={id}
          data-testid="field-model"
          type="text"
          maxLength={100}
          spellCheck={false}
          placeholder={example}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          value={shown}
          onChange={(event) => {
            const text = event.target.value.trim();
            if (text === '' || MODEL_RULE.test(text)) {
              setDraft(null);
              onChange({ model: text || undefined });
            } else {
              setDraft(event.target.value);
            }
          }}
          className={`${inputCls} font-mono`}
        />
      )}
    </FieldShell>
  );
};
