import React from 'react';
import { useI18nStore } from '../../store/useI18nStore';
import { pathLabel, suggestedData, type VariableGroup } from '../../lib/variablePaths';

interface DataSuggestionsProps {
  groups: VariableGroup[];
  value: unknown;
  onChange: (next: string) => void;
  /** Multi-line fields get each insert on its own line; single-line ones are separated by a space. */
  multiline?: boolean;
}

/** One-click inserts of the data people most often use (OCR text, message received, email subject…), appended to a field. */
export const DataSuggestions: React.FC<DataSuggestionsProps> = ({ groups, value, onChange, multiline }) => {
  const { t } = useI18nStore();
  const items = suggestedData(groups);
  if (!items.length) return null;
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return (
    <div data-testid="data-suggestions" className="mt-1 flex flex-wrap items-center gap-1">
      <span className="text-[10px] text-muted-foreground">{t('builder.var.suggest')}</span>
      {items.map((item) => (
        <button
          key={item.mapping}
          type="button"
          data-testid="data-suggestion"
          data-path={item.path}
          title={`${item.group.label}: ${item.mapping}`}
          onClick={() => onChange(`${text}${text && !/\s$/.test(text) ? (multiline ? '\n' : ' ') : ''}${item.mapping}`)}
          className="rounded border border-border-strong bg-card px-1.5 py-0.5 text-[10px] font-medium text-text-2 hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          + {pathLabel(item.group, item.path, t) ?? item.path}
        </button>
      ))}
    </div>
  );
};
