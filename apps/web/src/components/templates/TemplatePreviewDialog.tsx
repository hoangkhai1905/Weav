import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { nodeLabel } from '../../lib/nodeLabels';
import { useI18nStore } from '../../store/useI18nStore';
import type { TemplateDetail } from '../../api/templates.api';
import { TemplateDialog } from './TemplateDialog';
import { connectionCount, dialogBtn, dialogPrimaryBtn, nodeDot } from './templateStyles';

interface TemplatePreviewDialogProps {
  template: TemplateDetail;
  onClose: () => void;
  /** Copies the template into the active workspace; the page opens the builder when it resolves. */
  onUse: () => Promise<void>;
}

export function TemplatePreviewDialog({ template, onClose, onUse }: TemplatePreviewDialogProps) {
  const { t } = useI18nStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per step (not per type), so two e-mail steps count twice.
  const types = template.definition?.nodes?.map((node) => node.type) ?? template.nodeTypes;
  const reselect = connectionCount(types);

  const use = async () => {
    setBusy(true);
    setError(null);
    try {
      await onUse();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tpl.use_failed'));
      setBusy(false);
    }
  };

  return (
    <TemplateDialog title={template.name} onClose={onClose} testId="template-preview-dialog">
      <div className="space-y-3">
        {template.authorName ? (
          <p className="text-xs text-muted-foreground">{t('tpl.by_author').replace('{name}', template.authorName)}</p>
        ) : null}
        {template.description ? <p className="text-sm leading-relaxed text-foreground">{template.description}</p> : null}
        <div>
          <h3 className="mb-1 text-[11px] font-medium text-text-2">{t('tpl.preview.steps')}</h3>
          <ol data-testid="template-preview-nodes" className="space-y-1">
            {types.map((type, index) => (
              <li key={`${type}-${index}`} className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${nodeDot(type)}`} />
                <span>{nodeLabel(type, t)}</span>
              </li>
            ))}
          </ol>
        </div>
        {reselect > 0 ? (
          <p data-testid="template-preview-reselect" className="text-xs text-warn">
            {t('tpl.reselect').replace('{n}', String(reselect))}
          </p>
        ) : null}
        {error ? <p role="alert" className="text-xs text-err">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className={dialogBtn}>{t('tpl.cancel')}</button>
          <button type="button" data-testid="template-preview-use" data-autofocus onClick={() => void use()} disabled={busy} className={dialogPrimaryBtn}>
            <span>{busy ? t('tpl.using') : t('tpl.use')}</span>
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
    </TemplateDialog>
  );
}
