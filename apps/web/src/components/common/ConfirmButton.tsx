import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ConfirmModal, type ConfirmModalProps } from './ConfirmModal';

export interface ConfirmButtonProps {
  children: ReactNode;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string | ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmModalProps['variant'];
  className?: string;
  titleTooltip?: string;
  disabled?: boolean;
}

export function ConfirmButton({
  children,
  onConfirm,
  title,
  description,
  confirmText,
  cancelText,
  variant = 'danger',
  className = '',
  titleTooltip,
  disabled = false,
}: ConfirmButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled) return;
    setIsOpen(true);
  };

  const handleConfirmAction = async () => {
    setLoading(true);
    try {
      await onConfirm();
      setIsOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <motion.button
        whileHover={{ scale: disabled ? 1 : 1.03 }}
        whileTap={{ scale: disabled ? 1 : 0.95 }}
        onClick={handleOpen}
        disabled={disabled}
        title={titleTooltip}
        className={className}
      >
        {children}
      </motion.button>

      <ConfirmModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onConfirm={handleConfirmAction}
        title={title}
        description={description}
        confirmText={confirmText}
        cancelText={cancelText}
        variant={variant}
        loading={loading}
      />
    </>
  );
}
