import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useT } from '../lib/i18n';
import { btnCls } from '../lib/ui';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmText: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

const dangerBtnCls = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-err bg-err px-3 text-[13px] font-medium text-background transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export function ConfirmDialog({ open, title, description, confirmText, danger, onConfirm, onClose }: ConfirmDialogProps) {
  const t = useT();
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const close = () => !busy && onClose();
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="absolute inset-0 bg-foreground/60" onClick={close} aria-hidden="true" />
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} className="relative w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg">
        <h2 id={titleId} className="text-base font-semibold">{title}</h2>
        <div id={descId} className="mt-2 text-[13px] text-text-2">{description}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className={btnCls} onClick={close} disabled={busy}>{t('common.cancel')}</button>
          <button type="button" className={danger ? dangerBtnCls : btnCls} onClick={() => void confirm()} disabled={busy}>
            {busy && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
