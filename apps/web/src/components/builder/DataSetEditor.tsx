import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';

const fieldCls = 'min-w-0 rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';
const addCls = 'mt-1.5 inline-flex items-center gap-1 rounded text-[11px] font-medium text-run hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';

type Row = { key: string; value: string };

// DefinitionValidator.validateDataSetFields: 1-100 fields, names of 1-128 non-blank characters.
const MAX_FIELDS = 100;

interface DataSetEditorProps {
  value: unknown;
  /** Receives the `fields` object (or mapping string); `undefined` removes it. */
  onChange: (fields: unknown) => void;
}

/**
 * data.set `fields`: name → literal or mapping. Rows live in local state because a blank or repeated
 * name cannot exist in the saved object; only named rows are saved and a repeated name is flagged.
 * Mount with `key={nodeId}` so switching steps reloads the rows.
 */
export const DataSetEditor: React.FC<DataSetEditorProps> = ({ value, onChange }) => {
  const { t } = useI18nStore();
  const mapping = typeof value === 'string';
  const [rows, setRows] = useState<Row[]>(() =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>).map(([key, item]) => ({ key, value: typeof item === 'string' ? item : JSON.stringify(item) }))
      : [],
  );
  const save = (next: Row[]) => {
    setRows(next);
    const named = next.filter((row) => row.key.trim());
    onChange(Object.fromEntries(named.map((row) => [row.key.trim(), row.value])));
  };

  return (
    <div data-testid="data-set-config" className="space-y-2">
      <span className="block text-[11px] font-medium text-text-2">{t('builder.field.data.set.fields')}</span>
      <select
        aria-label={t('builder.cfg.data_set_mode')}
        data-testid="data-set-mode"
        value={mapping ? 'mapping' : 'list'}
        onChange={(event) => (event.target.value === 'mapping' ? onChange('') : save(rows))}
        className={`${fieldCls} w-full`}
      >
        <option value="list">{t('builder.cfg.data_set_mode_list')}</option>
        <option value="mapping">{t('builder.cfg.data_set_mode_mapping')}</option>
      </select>
      {mapping ? (
        <input
          aria-label={t('builder.cfg.data_set_mapping')}
          data-testid="data-set-mapping"
          value={value as string}
          placeholder="{{ nodes.lookup.output.rows[0] }}"
          onChange={(event) => onChange(event.target.value)}
          className={`${fieldCls} w-full font-mono`}
        />
      ) : (
        <>
          {rows.map((row, index) => {
            const n = String(index + 1);
            const duplicate = row.key.trim() !== '' && rows.findIndex((other) => other.key.trim() === row.key.trim()) !== index;
            return (
              <div key={index}>
                <div className="flex items-center gap-1.5">
                  <input
                    aria-label={t('builder.cfg.data_set_name').replace('{n}', n)}
                    aria-invalid={duplicate}
                    data-testid="data-set-key"
                    maxLength={128}
                    value={row.key}
                    placeholder={t('builder.cfg.data_set_name_placeholder')}
                    onChange={(event) => save(rows.map((item, i) => (i === index ? { ...item, key: event.target.value } : item)))}
                    className={`${fieldCls} w-28 shrink-0`}
                  />
                  <input
                    aria-label={t('builder.cfg.data_set_value').replace('{n}', n)}
                    data-testid="data-set-value"
                    value={row.value}
                    placeholder="{{ trigger.input.email }}"
                    onChange={(event) => save(rows.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))}
                    className={`${fieldCls} w-full font-mono`}
                  />
                  <button
                    type="button"
                    onClick={() => save(rows.filter((_, i) => i !== index))}
                    aria-label={t('builder.cfg.data_set_remove').replace('{n}', n)}
                    title={t('builder.cfg.data_set_remove').replace('{n}', n)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
                {duplicate && <p role="alert" className="mt-0.5 text-[10px] text-err">{t('builder.cfg.data_set_duplicate')}</p>}
              </div>
            );
          })}
          <button type="button" data-testid="data-set-add" disabled={rows.length >= MAX_FIELDS} onClick={() => save([...rows, { key: '', value: '' }])} className={addCls}>
            <Plus size={12} aria-hidden="true" />{t('builder.cfg.data_set_add')}
          </button>
        </>
      )}
      <p className="text-[10px] leading-relaxed text-muted-foreground">{t('builder.cfg.data_set_hint')}</p>
    </div>
  );
};
