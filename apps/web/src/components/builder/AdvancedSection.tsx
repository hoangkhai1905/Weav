import React from 'react';
import { useI18nStore } from '../../store/useI18nStore';

interface AdvancedSectionProps { count: number; defaultOpen: boolean; testId?: string; children: React.ReactNode }

/** Optional extra fields, folded away until needed. `defaultOpen` only applies to the first render of a mounted step. */
export const AdvancedSection: React.FC<AdvancedSectionProps> = ({ count, defaultOpen, testId, children }) => {
  const { t } = useI18nStore();
  if (count === 0) return null;
  return (
    <details open={defaultOpen || undefined} data-testid={testId} className="rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-foreground">
        {t('builder.cfg.more_options').replace('{count}', String(count))}
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3">{children}</div>
    </details>
  );
};
