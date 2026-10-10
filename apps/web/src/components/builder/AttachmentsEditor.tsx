import React from 'react';
import { Plus, X } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import { fileSources, mappingOf, pathLabel, type VariableGroup } from '../../lib/variablePaths';
import { MappingTextField } from './MappingTextField';

const fieldCls = 'min-w-0 rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';
const inputCls = `${fieldCls} w-full font-mono`;
const addCls = 'mt-1.5 inline-flex items-center gap-1 rounded text-[11px] font-medium text-run hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';

// docs/api/week4-node-contracts.md: at most 5 usable attachments per email.
const MAX_ATTACHMENTS = 5;

type Kind = 'url' | 'fileId';
type Attachment = { url?: string; fileId?: string; filename?: string };

interface AttachmentsEditorProps {
  value: unknown;
  /** `undefined` removes `attachments` from the config. */
  onChange: (value: unknown) => void;
  /** Data from the steps before: names the chips and lists the files a file-id attachment can pick. */
  groups?: VariableGroup[];
}

/** email.send `attachments`: a list of {url|fileId, filename?} or one mapping that resolves to such a list. */
export const AttachmentsEditor: React.FC<AttachmentsEditorProps> = ({ value, onChange, groups = [] }) => {
  const { t } = useI18nStore();
  // A file-id attachment takes the stored file's id; the file name defaults to the file's own (EmailAttachmentResolver).
  const files = fileSources(groups).map((source) => ({ ...source, idMapping: mappingOf(source.group, `${source.path}.fileId`) }));
  const mapping = typeof value === 'string';
  const items: Attachment[] = Array.isArray(value) ? value as Attachment[] : [];
  const kindOf = (item: Attachment): Kind => ('fileId' in item ? 'fileId' : 'url');
  const setItems = (next: Attachment[]) => onChange(next.length ? next : undefined);
  const setItem = (index: number, kind: Kind, source: string, filename: string) =>
    setItems(items.map((item, i) => (i === index ? { [kind]: source, ...(filename ? { filename } : {}) } : item)));

  return (
    <fieldset data-testid="email-attachments" className="space-y-2">
      <legend className="mb-1 block text-[11px] font-medium text-text-2">{t('builder.field.email.send.attachments')}</legend>
      <select
        aria-label={t('builder.cfg.attach_mode')}
        data-testid="attachments-mode"
        value={mapping ? 'mapping' : 'list'}
        onChange={(event) => onChange(event.target.value === 'mapping' ? '' : undefined)}
        className={`${fieldCls} w-full`}
      >
        <option value="list">{t('builder.cfg.attach_mode_list')}</option>
        <option value="mapping">{t('builder.cfg.attach_mode_mapping')}</option>
      </select>

      {mapping ? (
        <MappingTextField
          id="attachments-mapping"
          ariaLabel={t('builder.cfg.attach_mapping')}
          testId="attachments-mapping"
          value={value as string}
          groups={groups}
          onChange={(next) => onChange(next)}
        />
      ) : (
        <>
          {items.map((item, index) => {
            const kind = kindOf(item);
            const n = String(index + 1);
            return (
              <div key={index} data-testid="attachment-row" className="space-y-1.5 rounded-md border border-border p-2">
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label={t('builder.cfg.attach_kind').replace('{n}', n)}
                    value={kind}
                    onChange={(event) => setItem(index, event.target.value as Kind, '', item.filename ?? '')}
                    className={`${fieldCls} w-28 shrink-0`}
                  >
                    <option value="url">{t('builder.cfg.attach_url')}</option>
                    <option value="fileId">{t('builder.cfg.attach_file_id')}</option>
                  </select>
                  <MappingTextField
                    id={`attachment-source-${index}`}
                    ariaLabel={t('builder.cfg.attach_source').replace('{n}', n)}
                    testId="attachment-source"
                    className="min-w-0 flex-1"
                    value={item[kind] ?? ''}
                    groups={groups}
                    placeholder={kind === 'url' ? 'https://...' : t('builder.cfg.attach_pick')}
                    onChange={(next) => setItem(index, kind, next, item.filename ?? '')}
                  />
                  <button
                    type="button"
                    onClick={() => setItems(items.filter((_, i) => i !== index))}
                    aria-label={t('builder.cfg.attach_remove').replace('{n}', n)}
                    title={t('builder.cfg.attach_remove').replace('{n}', n)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
                {kind === 'fileId' && files.length > 0 && (
                  <select
                    aria-label={`${t('builder.cfg.attach_pick')} ${n}`}
                    data-testid="attachment-file-pick"
                    value={files.find((file) => file.idMapping === item.fileId)?.idMapping ?? ''}
                    onChange={(event) => event.target.value && setItem(index, 'fileId', event.target.value, item.filename ?? '')}
                    className={`${fieldCls} w-full`}
                  >
                    <option value="">{t('builder.cfg.attach_pick')}</option>
                    {files.map((file) => (
                      <option key={file.idMapping} value={file.idMapping}>{pathLabel(file.group, file.path, t) ?? file.path} — {file.group.label}</option>
                    ))}
                  </select>
                )}
                <input
                  aria-label={t('builder.cfg.attach_filename').replace('{n}', n)}
                  data-testid="attachment-filename"
                  value={item.filename ?? ''}
                  placeholder={t('builder.cfg.attach_filename_placeholder')}
                  onChange={(event) => setItem(index, kind, item[kind] ?? '', event.target.value)}
                  className={inputCls}
                />
              </div>
            );
          })}
          <button type="button" data-testid="attachment-add" disabled={items.length >= MAX_ATTACHMENTS} onClick={() => setItems([...items, { url: '' }])} className={addCls}>
            <Plus size={12} aria-hidden="true" />{t('builder.cfg.attach_add')}
          </button>
        </>
      )}
      <p className="text-[10px] leading-relaxed text-muted-foreground">{t('builder.cfg.attach_hint')}</p>
    </fieldset>
  );
};
