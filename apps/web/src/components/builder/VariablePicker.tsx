import React, { useId, useState } from 'react';
import { Braces } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import { isValidPath, mappingOf, pathLabel, type VariableGroup } from '../../lib/variablePaths';

interface VariablePickerProps {
  groups: VariableGroup[];
  insert: (text: string) => boolean;
}

export const VariablePicker: React.FC<VariablePickerProps> = ({ groups, insert }) => {
  const { t } = useI18nStore();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string }>({ ok: true, text: '' });
  const [key, setKey] = useState('');
  const panelId = useId();
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();
  const add = (group: VariableGroup, path: string) => {
    const text = mappingOf(group, path);
    setNotice(insert(text) ? { ok: true, text: t('builder.var.inserted').replace('{text}', text) } : { ok: false, text: t('builder.var.no_target') });
  };
  const keyOk = isValidPath(key);

  return (
    <div data-variable-picker data-testid="variable-picker" className="rounded-md border border-border bg-subtle">
      <button
        type="button"
        data-testid="variable-picker-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-text-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Braces size={13} aria-hidden="true" />{t('builder.var.insert')}
      </button>
      {open && (
        <div id={panelId} role="group" aria-label={t('builder.var.title')} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} className="space-y-2 border-t border-border p-2.5">
          <p className="text-[10px] leading-relaxed text-muted-foreground">{t('builder.var.hint')}</p>
          <p role="status" aria-live="polite" className={`text-[10px] font-medium ${notice.ok ? 'text-ok' : 'text-warn'}`}>{notice.text}</p>
          {groups.length === 0 && <p className="text-[10px] text-muted-foreground">{t('builder.var.empty')}</p>}
          {groups.map((group) => (
            <div key={group.key} role="group" aria-label={group.label}>
              <p className="mb-1 text-[10px] font-semibold text-text-2">{group.label}</p>
              <div className="flex flex-wrap gap-1">
                {group.paths.map((path) => {
                  const friendly = pathLabel(group, path, t);
                  return (
                    <button
                      key={path}
                      type="button"
                      data-testid="variable-option"
                      data-path={path}
                      onMouseDown={keepFocus}
                      onClick={() => add(group, path)}
                      title={mappingOf(group, path)}
                      className="flex flex-col items-start rounded border border-border-strong bg-card px-1.5 py-0.5 text-left text-[10px] text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {friendly && <span className="font-medium">{friendly}</span>}
                      <span className={friendly ? 'font-mono text-[9px] text-muted-foreground' : 'font-mono'}>{path}</span>
                    </button>
                  );
                })}
              </div>
              {group.freeForm && (
                <div className="mt-1 flex items-center gap-1">
                  <input
                    aria-label={t('builder.var.trigger_key')}
                    data-testid="variable-trigger-key"
                    data-notemplate
                    value={key}
                    placeholder={t('builder.var.trigger_key')}
                    onChange={(event) => setKey(event.target.value.trim())}
                    className="min-w-0 flex-1 rounded border border-border-strong bg-card px-2 py-1 font-mono text-[10px] text-foreground"
                  />
                  <button
                    type="button"
                    data-testid="variable-trigger-add"
                    disabled={!keyOk}
                    onMouseDown={keepFocus}
                    onClick={() => add(group, key)}
                    className="rounded border border-border-strong px-1.5 py-1 text-[10px] font-medium text-text-2 hover:text-foreground disabled:opacity-40"
                  >
                    {t('builder.var.trigger_key_add')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
