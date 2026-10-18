import React, { useState } from 'react';
import { useI18nStore } from '../../store/useI18nStore';
import { isValidPath, mappingOf, outputLabel, RUN_PATHS, searchKey, type VariableGroup } from '../../lib/variablePaths';

interface DataMenuProps {
  /** Data the trigger and earlier steps hand over, nearest step first. */
  groups: VariableGroup[];
  /** Receives the mapping to insert (`{{ ... }}`). */
  onPick: (mapping: string) => void;
  onClose: () => void;
}

/** The search box only earns its place once the list is long. */
const SEARCH_MIN_ITEMS = 9;
const itemCls = 'flex w-full items-start rounded px-2 py-1 text-left text-[11px] text-foreground hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const headingCls = 'px-2 pb-0.5 text-[10px] font-semibold text-text-2';
// Keeps the caret in the field while a menu item is pressed.
const keepCaret = (event: React.MouseEvent) => event.preventDefault();

/** The "Insert data" menu: earlier steps nearest first, then "Other" (time, run, workflow); searchable when long. */
export const DataMenu: React.FC<DataMenuProps> = ({ groups, onPick, onClose }) => {
  const { t } = useI18nStore();
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const sections = [
    ...groups.map((group) => ({
      key: group.key,
      heading: group.label,
      freeForm: group.freeForm ? group : undefined,
      items: group.paths.map((path) => ({ path, label: outputLabel(group, path, t), mapping: mappingOf(group, path) })),
    })),
    {
      key: '__other',
      heading: t('builder.var.other'),
      freeForm: undefined,
      items: RUN_PATHS.map(({ path, labelKey }) => ({ path, label: t(labelKey), mapping: `{{ ${path} }}` })),
    },
  ];
  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  const needle = searchKey(query.trim());
  const typedName = name.trim();
  const nameOk = isValidPath(typedName);

  return (
    <div
      role="menu"
      data-testid="mapping-data-menu"
      onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
      className="absolute right-0 top-full z-30 mt-1 max-h-72 w-72 max-w-full space-y-2 overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-pop"
    >
      {groups.length === 0 && <p className="px-2 text-xs text-muted-foreground">{t('builder.var.empty')}</p>}
      {total >= SEARCH_MIN_ITEMS && (
        <input
          type="search"
          aria-label={t('builder.var.search')}
          placeholder={t('builder.var.search')}
          data-notemplate
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded border border-border-strong bg-card px-2 py-1 text-xs text-foreground"
        />
      )}
      {needle && sections.every((section) => !section.items.some((item) => searchKey(item.label).includes(needle))) && (
        <p className="px-2 text-xs text-muted-foreground">{t('builder.var.no_match')}</p>
      )}
      {sections.map((section) => {
        const items = section.items.filter((item) => !needle || searchKey(item.label).includes(needle));
        if (!items.length && !(section.freeForm && !needle)) return null;
        return (
          <div key={section.key} data-testid="mapping-data-group">
            <p className={headingCls}>{section.heading}</p>
            {items.map((item) => (
              <button key={item.path} type="button" role="menuitem" data-testid="mapping-data-item" data-path={item.path} onMouseDown={keepCaret} onClick={() => onPick(item.mapping)} className={itemCls}>
                {item.label}
              </button>
            ))}
            {section.freeForm && !needle && (
              <div className="mt-1 px-2">
                <p className="pb-0.5 text-[11px] font-medium text-foreground">{t('builder.var.named_input')}</p>
                <div className="flex items-center gap-1">
                  <input
                    aria-label={t('builder.var.named_input_hint')}
                    placeholder={t('builder.var.named_input_hint')}
                    data-notemplate
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="min-w-0 flex-1 rounded border border-border-strong bg-card px-2 py-1 font-mono text-[10px] text-foreground"
                  />
                  <button
                    type="button"
                    data-testid="mapping-data-named-add"
                    disabled={!nameOk}
                    onMouseDown={keepCaret}
                    onClick={() => onPick(mappingOf(section.freeForm as VariableGroup, typedName))}
                    className="rounded border border-border-strong px-1.5 py-1 text-[10px] font-medium text-text-2 hover:text-foreground disabled:opacity-40"
                  >
                    {t('builder.var.trigger_key_add')}
                  </button>
                </div>
                {typedName !== '' && !nameOk && <p role="alert" className="pt-0.5 text-[10px] text-warn">{t('builder.var.named_input_invalid')}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
