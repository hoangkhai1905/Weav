import { useId, useState } from 'react';
import { WorkflowApiError } from '../../api/workflow-v1.api';
import { getTemplateByCode, type TemplateDetail } from '../../api/templates.api';
import { useI18nStore } from '../../store/useI18nStore';
import { TemplateDialog } from './TemplateDialog';
import { TemplatePreviewDialog } from './TemplatePreviewDialog';
import { dialogBtn, dialogField, dialogPrimaryBtn } from './templateStyles';

interface EnterCodeDialogProps {
  initialCode?: string;
  onClose: () => void;
  onUse: (template: TemplateDetail) => Promise<void>;
}

/** Step 1: type a share code. Step 2 (found): the preview dialog takes over. */
export function EnterCodeDialog({ initialCode = '', onClose, onUse }: EnterCodeDialogProps) {
  const { t } = useI18nStore();
  const inputId = useId();
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<TemplateDetail | null>(null);

  if (found) return <TemplatePreviewDialog template={found} onClose={onClose} onUse={() => onUse(found)} />;

  const find = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setFound(await getTemplateByCode(code));
    } catch (cause) {
      setError(cause instanceof WorkflowApiError && cause.status === 404
        ? t('tpl.code_not_found')
        : cause instanceof Error ? cause.message : t('tpl.code_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TemplateDialog title={t('tpl.code_title')} onClose={onClose} testId="enter-code-dialog">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void find();
        }}
      >
        <div>
          <label htmlFor={inputId} className="mb-1 block text-[11px] font-medium text-text-2">{t('tpl.code_label')}</label>
          <input
            id={inputId}
            data-autofocus
            data-testid="template-code-input"
            value={code}
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            placeholder="WV7K-3M9Q"
            onChange={(event) => setCode(event.target.value)}
            className={`${dialogField} font-mono uppercase`}
          />
        </div>
        {error ? <p role="alert" data-testid="template-code-error" className="text-xs text-err">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={dialogBtn}>{t('tpl.cancel')}</button>
          <button type="submit" disabled={busy || !code.trim()} className={dialogPrimaryBtn}>
            {busy ? t('tpl.loading') : t('tpl.code_find')}
          </button>
        </div>
      </form>
    </TemplateDialog>
  );
}
