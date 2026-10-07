import { useEffect, useId, useState } from 'react';
import { useI18nStore } from '../../store/useI18nStore';

const MAX_BYTES = 32 * 1024;

export function OutputSchemaEditor({ value, legacyDescription, onChange }: {
  value: unknown;
  legacyDescription?: string;
  onChange: (schema: Record<string, unknown>) => void;
}) {
  const { t } = useI18nStore();
  const id = useId();
  const [draft, setDraft] = useState(() => (value ? JSON.stringify(value, null, 2) : ''));
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resyncs the editable draft when a newly selected node provides another schema
  useEffect(() => { setDraft(value ? JSON.stringify(value, null, 2) : ''); }, [value]);

  const commit = () => {
    if (new TextEncoder().encode(draft).length > MAX_BYTES) return setError(t('builder.cfg.schema_too_large'));
    try {
      const parsed: unknown = JSON.parse(draft);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || (parsed as { type?: unknown }).type !== 'object') {
        return setError(t('builder.cfg.schema_root'));
      }
      setError(null);
      onChange(parsed as Record<string, unknown>);
    } catch {
      setError(t('builder.cfg.schema_invalid'));
    }
  };

  return (
    <div className="space-y-1">
      {legacyDescription ? (
        <p className="text-[11px] text-muted-foreground">{t('builder.cfg.schema_legacy')}{legacyDescription}</p>
      ) : null}
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.cfg.schema_label')}</label>
      <textarea id={id} data-notemplate rows={8} spellCheck={false} value={draft} aria-invalid={error !== null}
        onChange={(event) => setDraft(event.target.value)} onBlur={commit}
        className="w-full resize-y rounded border border-border bg-subtle px-2.5 py-1.5 font-mono text-xs text-foreground" />
      {error ? <p role="alert" className="text-[11px] text-err">{error}</p> : null}
    </div>
  );
}
