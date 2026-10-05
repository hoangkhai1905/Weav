import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

interface TypedConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** Bullet list describing what will happen. */
  consequences: ReactNode[];
  /** The exact phrase the user must type to enable the destructive action. */
  phrase: string;
  phraseLabel: ReactNode;
  confirmText: string;
  cancelText: string;
  closeLabel: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

/** Destructive confirmation (role=alertdialog) that requires typing a phrase. */
export function TypedConfirmDialog(props: TypedConfirmDialogProps) {
  return <AnimatePresence>{props.isOpen && <TypedConfirmDialogBody {...props} />}</AnimatePresence>;
}

/** Mounted only while open, so the typed phrase resets every time. */
function TypedConfirmDialogBody({
  title,
  consequences,
  phrase,
  phraseLabel,
  confirmText,
  cancelText,
  closeLabel,
  loading = false,
  onClose,
  onConfirm,
}: TypedConfirmDialogProps) {
  const titleId = useId();
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();
  const matches = typed.trim().toLowerCase() === phrase.trim().toLowerCase();

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[18vh]">
          <motion.button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.15 }}
            className="absolute inset-0 cursor-default border-0 bg-foreground/30"
          />
          <motion.section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            className="relative w-full max-w-[480px] rounded-lg border border-border bg-card p-5 text-card-foreground shadow-pop"
          >
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <ul className="mt-3 list-disc space-y-1 pl-[18px] text-[13px] leading-relaxed text-text-2">
              {consequences.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
            <label className="mt-3.5 block">
              <span className="mb-1.5 block text-xs font-medium text-text-2">{phraseLabel}</span>
              <input
                ref={inputRef}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={phrase}
                autoComplete="off"
                className="h-8 w-full rounded-md border border-border-strong bg-card px-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 items-center rounded-md border border-border-strong bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                {cancelText}
              </button>
              <button
                type="button"
                disabled={!matches || loading}
                onClick={() => void onConfirm()}
                className="inline-flex h-8 items-center rounded-md border border-err bg-err px-3 text-[13px] font-medium text-background transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirmText}
              </button>
            </div>
          </motion.section>
        </div>
  );
}
