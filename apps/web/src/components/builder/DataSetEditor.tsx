import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';

const fieldCls = 'min-w-0 rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';
const addCls = 'mt-1.5 inline-flex items-center gap-1 rounded text-[11px] font-medium text-run hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';

type RowType = 'text' | 'number' | 'boolean' | 'mapping' | 'raw';
/** `value` is the text shown in the input ('true'/'false' for Yes/No); `raw` is an untouched object, array or null. */
type Row = { key: string; type: RowType; value: string; raw?: unknown };

const NUMBER = /^-?\d+(\.\d+)?$/;
const TYPES: Exclude<RowType, 'raw'>[] = ['text', 'number', 'boolean', 'mapping'];

const toRow = (key: string, item: unknown): Row => {
  if (typeof item === 'number') return { key, type: 'number', value: String(item) };
  if (typeof item === 'boolean') return { key, type: 'boolean', value: String(item) };
  if (typeof item === 'string') return { key, type: item.includes('{{') ? 'mapping' : 'text', value: item };
  return { key, type: 'raw', value: JSON.stringify(item), raw: item };
};

const invalidNumber = (row: Row) => row.type === 'number' && !NUMBER.test(row.value.trim());

const toSaved = (row: Row): unknown => {
  if (row.type === 'raw') return row.raw;
  if (row.type === 'number') return Number(row.value);
  return row.type === 'boolean' ? row.value === 'true' : row.value;
};

// DefinitionValidator.validateDataSetFields: 1-100 fields, names of 1-128 non-blank characters.
const MAX_FIELDS = 100;

interface DataSetEditorProps {
  value: unknown;
  /** Receives the `fields` object (or mapping string); `undefined` removes it. */
  onChange: (fields: unknown) => void;
}

/**
 * data.set `fields`: name → typed value (text, number, yes/no, or a `{{ }}` mapping from an earlier step).
 * Rows live in local state because a blank or repeated name cannot exist in the saved object; only named
 * rows are saved, a repeated name is flagged, and a number that is not a number is flagged and left out of
 * the saved object until fixed. Objects/arrays from an existing config are shown read-only and saved unchanged.
 * Mount with `key={nodeId}` so switching steps reloads the rows.
 */
export const DataSetEditor: React.FC<DataSetEditorProps> = ({ value, onChange }) => {
  const { t } = useI18nStore();
  const mapping = typeof value === 'string';
  const [rows, setRows] = useState<Row[]>(() =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>).map(([key, item]) => toRow(key, item))
      : [],
  );
  const save = (next: Row[]) => {
    setRows(next);
    const saved = next.filter((row) => row.key.trim() && !invalidNumber(row));
    onChange(Object.fromEntries(saved.map((row) => [row.key.trim(), toSaved(row)])));
  };
  const update = (index: number, patch: Partial<Row>) => save(rows.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const changeType = (index: number, type: RowType) => update(index, { type, value: type === 'boolean' ? 'true' : rows[index].value });

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
              <div key={index} className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <input
                    aria-label={t('builder.cfg.data_set_name').replace('{n}', n)}
                    aria-invalid={duplicate}
                    data-testid="data-set-key"
                    maxLength={128}
                    value={row.key}
                    placeholder={t('builder.cfg.data_set_name_placeholder')}
                    onChange={(event) => update(index, { key: event.target.value })}
                    className={`${fieldCls} w-28 shrink-0`}
                  />
                  {row.type === 'raw' ? (
                    <span data-testid="data-set-advanced" className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{t('builder.cfg.data_set_advanced')}</span>
                  ) : (
                    <select
                      aria-label={t('builder.cfg.data_set_type').replace('{n}', n)}
                      data-testid="data-set-type"
                      value={row.type}
                      onChange={(event) => changeType(index, event.target.value as RowType)}
                      className={`${fieldCls} min-w-0 flex-1`}
                    >
                      {TYPES.map((type) => <option key={type} value={type}>{t(`builder.cfg.data_set_type_${type}`)}</option>)}
                    </select>
                  )}
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
                {row.type === 'boolean' ? (
                  <select aria-label={t('builder.cfg.data_set_value').replace('{n}', n)} data-testid="data-set-value" value={row.value} onChange={(event) => update(index, { value: event.target.value })} className={`${fieldCls} w-full`}>
                    <option value="true">{t('builder.cfg.data_set_true')}</option>
                    <option value="false">{t('builder.cfg.data_set_false')}</option>
                  </select>
                ) : row.type === 'raw' ? (
                  <code data-testid="data-set-value" className={`${fieldCls} block w-full truncate bg-subtle font-mono text-muted-foreground`}>{row.value}</code>
                ) : (
                  <input
                    aria-label={t('builder.cfg.data_set_value').replace('{n}', n)}
                    aria-invalid={invalidNumber(row) || undefined}
                    data-testid="data-set-value"
                    inputMode={row.type === 'number' ? 'decimal' : undefined}
                    value={row.value}
                    placeholder={row.type === 'mapping' ? '{{ trigger.input.email }}' : t(`builder.cfg.data_set_${row.type}_placeholder`)}
                    onChange={(event) => update(index, { value: event.target.value })}
                    className={`${fieldCls} w-full ${row.type === 'mapping' ? 'font-mono' : ''}`}
                  />
                )}
                {row.type === 'mapping' && <p className="text-[10px] leading-relaxed text-muted-foreground">{t('builder.cfg.data_set_mapping_hint')}</p>}
                {invalidNumber(row) && <p role="alert" className="text-[10px] text-err">{t('builder.cfg.data_set_number_invalid')}</p>}
                {duplicate && <p role="alert" className="text-[10px] text-err">{t('builder.cfg.data_set_duplicate')}</p>}
              </div>
            );
          })}
          <button type="button" data-testid="data-set-add" disabled={rows.length >= MAX_FIELDS} onClick={() => save([...rows, { key: '', type: 'text', value: '' }])} className={addCls}>
            <Plus size={12} aria-hidden="true" />{t('builder.cfg.data_set_add')}
          </button>
        </>
      )}
      <p className="text-[10px] leading-relaxed text-muted-foreground">{t('builder.cfg.data_set_hint')}</p>
    </div>
  );
};
