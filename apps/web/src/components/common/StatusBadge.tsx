import type { ReactNode } from 'react';
import { statusBadgeClass, type StatusTone } from './statusBadgeClass';

interface StatusBadgeProps {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}

export function StatusBadge({ tone, children, className = '' }: StatusBadgeProps) {
  return <span className={`${statusBadgeClass(tone)} ${className}`}>{children}</span>;
}
