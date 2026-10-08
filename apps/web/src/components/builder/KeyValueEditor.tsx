import React, { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import { isCredentialKey } from '../../lib/mappingGrammar';

const inputCls = 'min-w-0 rounded-md border border-border-strong bg-card px-2 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';

interface Row {
  id: number;
  key: string;
  value: string;
  /** A value that is not plain text (nested object, number...): shown read-only and saved unchanged. */
  raw?: unknown;
}

interface KeyValueEditorProps {
  label: string;
  testId: string;
  value: unknown;
  /** Rows with an empty or credential-like name are not saved. */
  onChange: (value: Record<string, unknown>) => void;
}

// Row ids only need to be unique and stable while the editor is mounted.
let rowSeq = 0;

/** Name/value rows saved as a flat object (HTTP headers, query). Mount it with `key` = the step id. */
export const KeyValueEditor: React.FC<KeyValueEditorProps> = ({ label, testId, value, onChange }) => {
  const { t } = useI18nStore();
  const focusId = useRef<number | null>(null);
  const [rows, setRows] = useState<Row[]>(() => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>).map(([key, item]) => (
        typeof item === 'string' ? { id: ++rowSeq, key, value: item } : { id: ++rowSeq, key, value: JSON.stringify(item), raw: item }
      ))
      : []
  ));
  useEffect(() => {
    if (focusId.current === null) return;
    document.getElementById(`${testId}-key-${focusId.current}`)?.focus();
    focusId.current = null;
  });

  // A whole-object mapping ("{{ nodes.x.output.headers }}") cannot be edited as rows: show it as it is.
  if (typeof value === 'string') {
    return (
      <div data-testid={testId} className="space-y-1">
        <p className="text-[11px] font-medium text-text-2">{label}</p>
        <code className="block truncate rounded border border-border bg-subtle px-2 py-1.5 font-mono text-[10px] text-muted-foreground">{value}</code>
      </div>
    );
  }

  const save = (next: Row[]) => {
    setRows(next);
    onChange(Object.fromEntries(next
      .filter((row) => row.key.trim() !== '' && !isCredentialKey(row.key))
      .map((row) => [row.key.trim(), 'raw' in row ? row.raw : row.value])));
  };
  const update = (id: number, patch: Partial<Row>) => save(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const names = rows.map((row) => row.key.trim().toLowerCase());

  return (
    <fieldset data-testid={testId} className="space-y-1.5">
      <legend className="mb-1 block text-[11px] font-medium text-text-2">{label}</legend>
      {rows.map((row, index) => {
        const name = row.key.trim();
        const credential = name !== '' && isCredentialKey(name);
        const duplicate = name !== '' && names.indexOf(name.toLowerCase()) !== index;
        const problem = credential ? t('builder.cfg.kv_credential') : duplicate ? t('builder.cfg.kv_duplicate') : undefined;
        return (
          <div key={row.id}>
            <div className="flex items-center gap-1.5">
              <input
                id={`${testId}-key-${row.id}`}
                aria-label={`${label}: ${t('builder.cfg.kv_name')} ${index + 1}`}
                aria-invalid={Boolean(problem)}
                aria-describedby={problem ? `${testId}-problem-${row.id}` : undefined}
                data-testid={`${testId}-key`}
                data-notemplate
                value={row.key}
                onChange={(event) => update(row.id, { key: event.target.value })}
                className={`${inputCls} w-28 shrink-0 font-mono`}
              />
              {'raw' in row ? (
                <code data-testid={`${testId}-value`} className="min-w-0 flex-1 truncate rounded border border-border bg-subtle px-2 py-1.5 font-mono text-[10px] text-muted-foreground">{row.value}</code>
              ) : (
                <input
                  aria-label={`${label}: ${t('builder.cfg.kv_value')} ${index + 1}`}
                  data-testid={`${testId}-value`}
                  value={row.value}
                  onChange={(event) => update(row.id, { value: event.target.value })}
                  className={`${inputCls} flex-1 font-mono`}
                />
              )}
              <button
                type="button"
                onClick={() => save(rows.filter((item) => item.id !== row.id))}
                aria-label={t('builder.cfg.kv_remove').replace('{n}', String(index + 1))}
                title={t('builder.cfg.kv_remove').replace('{n}', String(index + 1))}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
            {problem && <p id={`${testId}-problem-${row.id}`} role="alert" className="mt-0.5 text-[10px] text-err">{problem}</p>}
          </div>
        );
      })}
      <button
        type="button"
        data-testid={`${testId}-add`}
        onClick={() => {
          const id = ++rowSeq;
          focusId.current = id;
          setRows([...rows, { id, key: '', value: '' }]);
        }}
        className="flex items-center gap-1 rounded text-[11px] font-medium text-run hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus size={12} aria-hidden="true" />{t('builder.cfg.kv_add')}
      </button>
    </fieldset>
  );
};
