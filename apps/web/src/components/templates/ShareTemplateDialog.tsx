import { useEffect, useId, useState } from 'react';
import { Copy } from 'lucide-react';
import { getTemplate, previewShare, shareWorkflow, type TemplateDetail, type TemplatePreview, type TemplateVisibility } from '../../api/templates.api';
import { nodeLabel } from '../../lib/nodeLabels';
import { NODE_SCHEMAS } from '../../lib/nodeSchemas';
import { useAuthStore } from '../../store/useAuthStore';
import { useI18nStore } from '../../store/useI18nStore';
import { TemplateDialog } from './TemplateDialog';
import { dialogBtn, dialogField, dialogPrimaryBtn } from './templateStyles';

const VISIBILITIES: TemplateVisibility[] = ['PRIVATE', 'UNLISTED', 'PUBLIC'];

interface ShareTemplateDialogProps {
  workflowId: string;
  defaultName: string;
  /** Canvas display names by node id, so removed fields name the step the user sees. */
  nodeNames: Record<string, string>;
  onClose: () => void;
}

export function ShareTemplateDialog({ workflowId, defaultName, nodeNames, onClose }: ShareTemplateDialogProps) {
  const { t } = useI18nStore();
  const profile = useAuthStore((state) => state.user);
  const ids = { name: useId(), description: useId(), author: useId() };
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [authorName, setAuthorName] = useState(profile?.displayName?.trim() || profile?.name || '');
  const [visibility, setVisibility] = useState<TemplateVisibility>('PRIVATE');
  const [reviewed, setReviewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shared, setShared] = useState<TemplateDetail | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  // Esc, backdrop and Cancel are ignored while the save request is in flight.
  const close = () => {
    if (!saving) onClose();
  };

  useEffect(() => {
    let cancelled = false;
    previewShare(workflowId)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        const existing = result.existing;
        if (existing) {
          setName(existing.name);
          setDescription(existing.description ?? '');
          setAuthorName(existing.authorName ?? '');
          setVisibility(existing.visibility);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : t('tpl.share.preview_failed'));
      });
    return () => {
      cancelled = true;
    };
    // The preview is a snapshot of the saved draft; run it once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  const typeOf = (nodeId: string) => preview?.definition?.nodes?.find((node) => node.id === nodeId)?.type ?? '';
  const stepName = (nodeId: string) => nodeNames[nodeId] || (typeOf(nodeId) ? nodeLabel(typeOf(nodeId), t) : nodeId);
  const fieldName = (nodeId: string, field: string) => NODE_SCHEMAS[typeOf(nodeId)]?.properties?.[field]?.title ?? field;

  const needsReview = (preview?.warnings.length ?? 0) > 0;
  const canSave = preview !== null && name.trim() !== '' && (!needsReview || reviewed) && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      let result = await shareWorkflow(workflowId, {
        name: name.trim(),
        description: description.trim() || undefined,
        authorName: authorName.trim() || undefined,
        visibility,
      });
      // The code is what the owner needs next; fetch the detail if the save response omitted it.
      if (!result.shareCode) result = await getTemplate(result.id).catch(() => result);
      setShared(result);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t('tpl.share.failed'));
    } finally {
      setSaving(false);
    }
  };

  const copy = async (kind: 'code' | 'link', text: string) => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setCopyFailed(false);
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 2000);
    } catch {
      setCopyFailed(true);
    }
  };

  if (shared) {
    const code = shared.shareCode ?? '';
    const link = `${window.location.origin}/workflows/new?code=${encodeURIComponent(code)}`;
    return (
      <TemplateDialog title={t('tpl.share.done_title')} onClose={close} testId="share-template-dialog">
        <div className="space-y-3">
          {code ? (
          <div>
            <p className="text-[11px] font-medium text-text-2">{t('tpl.share.code')}</p>
            <div className="mt-1 flex items-center gap-2">
              <code data-testid="share-template-code" className="rounded-md border border-border bg-muted px-2.5 py-1.5 font-mono text-sm tracking-widest">{code}</code>
              <button type="button" data-autofocus data-testid="share-template-copy-code" onClick={() => void copy('code', code)} className={dialogBtn}>
                <Copy size={12} aria-hidden="true" />
                <span>{copied === 'code' ? t('tpl.copied') : t('tpl.copy_code')}</span>
              </button>
            </div>
          </div>
          ) : null}
          {copyFailed ? <p role="alert" className="text-xs text-err">{t('tpl.action_failed')}</p> : null}
          {code && shared.visibility !== 'PRIVATE' ? (
            <div>
              <p className="text-[11px] font-medium text-text-2">{t('tpl.share.link')}</p>
              <div className="mt-1 flex items-center gap-2">
                <input readOnly aria-label={t('tpl.share.link')} value={link} data-testid="share-template-link" className={`${dialogField} font-mono`} onFocus={(event) => event.currentTarget.select()} />
                <button type="button" onClick={() => void copy('link', link)} className={`${dialogBtn} shrink-0`}>
                  <Copy size={12} aria-hidden="true" />
                  <span>{copied === 'link' ? t('tpl.copied') : t('tpl.copy_code')}</span>
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex justify-end pt-1">
            <button type="button" onClick={onClose} className={dialogPrimaryBtn}>{t('tpl.share.close')}</button>
          </div>
        </div>
      </TemplateDialog>
    );
  }

  return (
    <TemplateDialog title={t('tpl.share.title')} onClose={close} testId="share-template-dialog">
      {loadError ? <p role="alert" className="text-xs text-err">{loadError}</p> : null}
      {!preview && !loadError ? <p role="status" className="text-xs text-muted-foreground">{t('tpl.share.loading')}</p> : null}
      {preview ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div>
            <label htmlFor={ids.name} className="mb-1 block text-[11px] font-medium text-text-2">{t('tpl.share.name')}</label>
            <input id={ids.name} data-autofocus data-testid="share-template-name" value={name} maxLength={255} onChange={(event) => setName(event.target.value)} className={dialogField} />
          </div>
          <div>
            <label htmlFor={ids.description} className="mb-1 block text-[11px] font-medium text-text-2">{t('tpl.share.description')}</label>
            <textarea id={ids.description} rows={3} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} className={dialogField} />
          </div>
          <div>
            <label htmlFor={ids.author} className="mb-1 block text-[11px] font-medium text-text-2">{t('tpl.share.author')}</label>
            <input id={ids.author} data-testid="share-template-author" value={authorName} maxLength={120} onChange={(event) => setAuthorName(event.target.value)} className={dialogField} />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[11px] font-medium text-text-2">{t('tpl.share.visibility')}</legend>
            {VISIBILITIES.map((value) => (
              <label key={value} className="flex items-start gap-2 text-xs text-foreground">
                <input type="radio" name="template-visibility" value={value} checked={visibility === value} onChange={() => setVisibility(value)} className="mt-0.5" />
                <span>
                  <span className="font-medium">{t(`tpl.visibility.${value}`)}</span>
                  <span className="block text-[11px] text-muted-foreground">{t(`tpl.visibility_hint.${value}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {preview.removedFields.length > 0 ? (
            <div data-testid="share-template-removed" className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
              <p className="font-medium text-foreground">{t('tpl.share.removed_title')}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text-2">
                {preview.removedFields.map((item) => (
                  <li key={`${item.nodeId}.${item.field}`}>{stepName(item.nodeId)}: {fieldName(item.nodeId, item.field)}</li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-muted-foreground">{t('tpl.share.removed_hint')}</p>
            </div>
          ) : null}

          {needsReview ? (
            <div data-testid="share-template-warnings" className="rounded-md border border-warn/30 bg-warn-bg p-2.5 text-xs text-warn">
              <p className="font-medium">{t('tpl.share.warnings_title')}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {preview.warnings.map((item) => (
                  <li key={`${item.nodeId}.${item.field}.${item.reason}`}>
                    {stepName(item.nodeId)}: {fieldName(item.nodeId, item.field)} {t(`tpl.warn.${item.reason}`)}
                  </li>
                ))}
              </ul>
              <label className="mt-2 flex items-center gap-2 font-medium text-foreground">
                <input type="checkbox" data-testid="share-template-reviewed" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
                <span>{t('tpl.share.reviewed')}</span>
              </label>
            </div>
          ) : null}

          {saveError ? <p role="alert" className="text-xs text-err">{saveError}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={close} disabled={saving} className={dialogBtn}>{t('tpl.cancel')}</button>
            <button type="submit" data-testid="share-template-submit" disabled={!canSave} className={dialogPrimaryBtn}>
              {saving ? t('tpl.share.saving') : preview.existing ? t('tpl.share.update') : t('tpl.share.submit')}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={dialogBtn}>{t('tpl.cancel')}</button>
        </div>
      )}
    </TemplateDialog>
  );
}
