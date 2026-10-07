import React from 'react';
import { Plus, X } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import { SchemaField } from './SchemaField';

const inputCls = 'w-full min-w-0 rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';
const addCls = 'mt-1.5 inline-flex items-center gap-1 rounded text-[11px] font-medium text-run hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';

// DefinitionValidator.validateSwitchCases: 1-20 unique literal cases, max 64 chars, "default" reserved.
const MAX_CASES = 20;

const caseProblem = (value: string, index: number, cases: string[]): string | undefined => {
  if (!value.trim()) return 'builder.cfg.switch_case_blank';
  if (value === 'default') return 'builder.cfg.switch_case_reserved';
  if (value.includes('{{')) return 'builder.cfg.switch_case_mapping';
  if (cases.indexOf(value) !== index) return 'builder.cfg.switch_case_duplicate';
  return undefined;
};

interface SwitchEditorProps {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  /** Called with the new case list so the canvas can drop edges of removed or renamed ports. */
  onCasesChange: (cases: string[]) => void;
}

/** logic.switch: the value to match and one output port per case; unmatched values leave by "default". */
export const SwitchEditor: React.FC<SwitchEditorProps> = ({ config, onChange, onCasesChange }) => {
  const { t } = useI18nStore();
  const cases = Array.isArray(config.cases) ? config.cases.map((item) => String(item ?? '')) : [];

  return (
    <div data-testid="switch-config" className="space-y-3">
      <SchemaField nodeType="logic.switch" name="value" value={config.value} onChange={(value) => onChange({ value })} />
      <fieldset className="space-y-1.5">
        <legend className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.field.logic.switch.cases')}</legend>
        {cases.map((value, index) => {
          const problem = caseProblem(value, index, cases);
          const n = String(index + 1);
          return (
            <div key={index}>
              <div className="flex items-center gap-1.5">
                <input
                  aria-label={t('builder.cfg.switch_case').replace('{n}', n)}
                  aria-invalid={Boolean(problem)}
                  data-testid="switch-case"
                  maxLength={64}
                  value={value}
                  onChange={(event) => onCasesChange(cases.map((item, i) => (i === index ? event.target.value : item)))}
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => onCasesChange(cases.filter((_, i) => i !== index))}
                  aria-label={t('builder.cfg.switch_remove').replace('{n}', n)}
                  title={t('builder.cfg.switch_remove').replace('{n}', n)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
              {problem && <p role="alert" className="mt-0.5 text-[10px] text-err">{t(problem)}</p>}
            </div>
          );
        })}
        <button type="button" data-testid="switch-add" disabled={cases.length >= MAX_CASES} onClick={() => onCasesChange([...cases, ''])} className={addCls}>
          <Plus size={12} aria-hidden="true" />{t('builder.cfg.switch_add')}
        </button>
        <p className="text-[10px] leading-relaxed text-muted-foreground">{t('builder.cfg.switch_hint')}</p>
      </fieldset>
    </div>
  );
};
