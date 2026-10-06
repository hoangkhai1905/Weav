import { type ReactNode, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X, RefreshCw } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string | ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info' | 'success';
  loading?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Xác nhận',
  cancelText = 'Hủy bỏ',
  variant = 'danger',
  loading = false,
}: ConfirmModalProps) {
  const { t } = useI18nStore();
  const titleId = useId();
  const descriptionId = useId();
  const getVariantStyles = () => {
    switch (variant) {
      case 'danger':
        return {
          icon: <AlertTriangle size={24} className="text-err" />,
          iconBg: 'bg-err-bg border-err-border',
          btnBg: 'bg-err border-err text-background hover:brightness-95',
        };
      case 'warning':
        return {
          icon: <AlertTriangle size={24} className="text-warn" />,
          iconBg: 'bg-warn-bg border-warn/30',
          btnBg: 'bg-warn border-warn text-background hover:brightness-95',
        };
      case 'success':
        return {
          icon: <CheckCircle2 size={24} className="text-ok" />,
          iconBg: 'bg-ok-bg border-ok/30',
          btnBg: 'bg-ok border-ok text-background hover:brightness-95',
        };
      case 'info':
      default:
        return {
          icon: <Info size={24} className="text-run" />,
          iconBg: 'bg-run-bg border-run/30',
          btnBg: 'bg-primary border-primary text-primary-foreground hover:bg-primary-hover',
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
          {/* Backdrop Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-foreground/60 backdrop-blur-sm"
          />

          {/* Modal Content Card */}
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 15 }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onKeyDown={(event) => { if (event.key === 'Escape' && !loading) onClose(); }}
            className="w-full max-w-md bg-card border border-border rounded-lg p-6 shadow-pop relative z-10 space-y-5"
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="absolute top-4 right-4 p-1.5 rounded-md text-muted-foreground hover:text-text-2 hover:bg-subtle transition-colors cursor-pointer"
            >
              <X size={16} aria-hidden="true" />
            </button>

            {/* Header with Icon */}
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-2xl border ${styles.iconBg} shrink-0`}>
                {styles.icon}
              </div>
              <div className="space-y-1 pr-6">
                <h3 id={titleId} className="text-base font-extrabold text-foreground leading-snug">
                  {title}
                </h3>
                <div id={descriptionId} className="text-xs text-muted-foreground leading-relaxed">
                  {description}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                type="button"
                autoFocus
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 bg-subtle hover:bg-muted text-text-2 border border-border rounded-md text-xs font-bold transition-all cursor-pointer shadow-sm"
              >
                {cancelText}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className={`px-4 py-2 text-xs font-bold rounded-md shadow-md border transition-all flex items-center gap-2 cursor-pointer ${styles.btnBg}`}
              >
                {loading ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>{t('common.processing')}</span>
                  </>
                ) : (
                  <span>{confirmText}</span>
                )}
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
