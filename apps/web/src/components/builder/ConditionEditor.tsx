import React from 'react';
import { Plus, X } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';

const inputCls = 'w-full min-w-0 rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';
const addCls = 'mt-1.5 inline-flex items-center gap-1 rounded text-[11px] font-medium text-run hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';

const CONDITION_OPERATORS = [
  { value: 'eq', labelKey: 'builder.cfg.op_eq' },
  { value: 'ne', labelKey: 'builder.cfg.op_ne' },
  { value: 'gt', labelKey: 'builder.cfg.op_gt' },
  { value: 'gte', labelKey: 'builder.cfg.op_gte' },
  { value: 'lt', labelKey: 'builder.cfg.op_lt' },
  { value: 'lte', labelKey: 'builder.cfg.op_lte' },
] as const;

const MAX_CONDITIONS = 10;
const ORDERING = new Set(['gt', 'gte', 'lt', 'lte']);

type Condition = { left?: unknown; operator?: string; right?: unknown };

/** Ordering operators need numbers (DefinitionValidator NUMERIC_OPERAND_REQUIRED): a numeric literal is saved as one. */
const operand = (value: unknown, operator: string | undefined): unknown =>
  ORDERING.has(operator ?? '') && typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : value;

const withOperator = (condition: Condition, operator: string): Condition => ({
  left: operand(condition.left, operator),
  operator,
  right: operand(condition.right, operator),
});

interface ConditionEditorProps {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
}

/**
 * logic.condition has two exclusive forms (CONDITION_FORM_CONFLICT when mixed): single {left, operator, right}
 * or multi {combinator, conditions[1..10]}. Switching clears the other form's keys.
 */
export const ConditionEditor: React.FC<ConditionEditorProps> = ({ config, onChange }) => {
  const { t } = useI18nStore();
  const multi = config.conditions !== undefined || config.combinator !== undefined;
  const conditions: Condition[] = multi
    ? (Array.isArray(config.conditions) ? config.conditions as Condition[] : [])
    : [{ left: config.left, operator: String(config.operator ?? 'eq'), right: config.right }];

  const setConditions = (next: Condition[]) => {
    if (multi) onChange({ conditions: next });
    else onChange({ left: next[0].left, operator: next[0].operator, right: next[0].right });
  };
  const update = (index: number, patch: Condition) =>
    setConditions(conditions.map((condition, i) => {
      if (i !== index) return condition;
      const merged = { ...condition, ...patch };
      return withOperator(merged, String(merged.operator ?? 'eq'));
    }));
  const setMode = (toMulti: boolean) => {
    if (toMulti === multi) return;
    const first = conditions[0] ?? { left: '', operator: 'eq', right: '' };
    onChange(toMulti
      ? { left: undefined, operator: undefined, right: undefined, combinator: 'and', conditions: [first] }
      : { combinator: undefined, conditions: undefined, left: first.left ?? '', operator: first.operator ?? 'eq', right: first.right ?? '' });
  };

  return (
    <div data-testid="condition-config" className="space-y-3">
      <div role="radiogroup" aria-label={t('builder.cfg.cond_mode')} className="grid grid-cols-2 gap-1 rounded-md bg-subtle p-0.5">
        {[false, true].map((option) => (
          <button
            key={String(option)}
            type="button"
            role="radio"
            aria-checked={multi === option}
            data-testid={option ? 'condition-mode-multi' : 'condition-mode-single'}
            onClick={() => setMode(option)}
            className={`rounded px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${multi === option ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t(option ? 'builder.cfg.cond_mode_multi' : 'builder.cfg.cond_mode_single')}
          </button>
        ))}
      </div>

      {multi && (
        <div>
          <label htmlFor="condition-combinator" className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.cond_combinator')}</label>
          <select id="condition-combinator" data-testid="condition-combinator" value={String(config.combinator ?? 'and')} onChange={(event) => onChange({ combinator: event.target.value })} className={inputCls}>
            <option value="and">{t('builder.cfg.cond_and')}</option>
            <option value="or">{t('builder.cfg.cond_or')}</option>
          </select>
        </div>
      )}

      {conditions.map((condition, index) => {
        const suffix = multi ? `-${index}` : '';
        return (
          <fieldset key={index} data-testid="condition-row" aria-label={multi ? t('builder.cfg.cond_item').replace('{n}', String(index + 1)) : undefined} className={multi ? 'space-y-2 rounded-md border border-border p-2' : 'space-y-3'}>
            {multi && (
              <div className="flex items-center justify-between">
                <span aria-hidden="true" className="text-[11px] font-semibold text-text-2">{t('builder.cfg.cond_item').replace('{n}', String(index + 1))}</span>
                <button
                  type="button"
                  onClick={() => setConditions(conditions.filter((_, i) => i !== index))}
                  disabled={conditions.length === 1}
                  aria-label={t('builder.cfg.cond_remove').replace('{n}', String(index + 1))}
                  title={t('builder.cfg.cond_remove').replace('{n}', String(index + 1))}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            )}
            <div>
              <label htmlFor={`condition-left${suffix}`} className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.cond_left')}</label>
              <input id={`condition-left${suffix}`} data-testid="condition-left" value={String(condition.left ?? '')} placeholder="{{ trigger.input.email }}" onChange={(event) => update(index, { left: event.target.value })} className={`${inputCls} font-mono`} />
            </div>
            <div>
              <label htmlFor={`condition-operator${suffix}`} className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.cond_operator')}</label>
              <select id={`condition-operator${suffix}`} data-testid="condition-operator" value={String(condition.operator ?? 'eq')} onChange={(event) => update(index, { operator: event.target.value })} className={inputCls}>
                {CONDITION_OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{t(operator.labelKey)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`condition-right${suffix}`} className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.cond_right')}</label>
              <input id={`condition-right${suffix}`} data-testid="condition-right" value={String(condition.right ?? '')} placeholder="500 or {{ variables.threshold }}" onChange={(event) => update(index, { right: event.target.value })} className={`${inputCls} font-mono`} />
            </div>
          </fieldset>
        );
      })}

      {multi && (
        <button type="button" data-testid="condition-add" disabled={conditions.length >= MAX_CONDITIONS} onClick={() => setConditions([...conditions, { left: '', operator: 'eq', right: '' }])} className={addCls}>
          <Plus size={12} aria-hidden="true" />{t('builder.cfg.cond_add')}
        </button>
      )}
      <p className="text-[10px] leading-relaxed text-muted-foreground">{t('builder.cfg.cond_hint')}</p>
    </div>
  );
};
