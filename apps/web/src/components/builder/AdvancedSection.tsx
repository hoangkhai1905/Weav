import React, { useState } from 'react';
import { useI18nStore } from '../../store/useI18nStore';

interface AdvancedSectionProps { count: number; defaultOpen: boolean; testId?: string; children: React.ReactNode }

/** Optional extra fields, folded away until needed. `defaultOpen` is the initial state and opens the section when it turns true; it never closes one the user opened. */
export const AdvancedSection: React.FC<AdvancedSectionProps> = ({ count, defaultOpen, testId, children }) => {
  const { t } = useI18nStore();
  const [open, setOpen] = useState(defaultOpen);
  // Opens when a value or error appears (state adjusted during render; an effect would trip react-hooks/set-state-in-effect).
  const [seen, setSeen] = useState(defaultOpen);
  if (seen !== defaultOpen) { setSeen(defaultOpen); if (defaultOpen) setOpen(true); }
  if (count === 0) return null;
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} data-testid={testId} className="rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-foreground">
        {t('builder.cfg.more_options').replace('{count}', String(count))}
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3">{children}</div>
    </details>
  );
};
