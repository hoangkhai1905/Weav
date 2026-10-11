import React from 'react';
import { Bold, Italic, Link2, List, WrapText } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import type { FormatAction } from '../../lib/formatInsert';

const ICONS = { bold: Bold, italic: Italic, link: Link2, list: List, lineBreak: WrapText } as const;

interface FormatToolbarProps {
  actions: FormatAction[];
  onAction: (action: FormatAction) => void;
}

/** Buttons that wrap the selected text of a message field in bold, italic, a link and so on. */
export const FormatToolbar: React.FC<FormatToolbarProps> = ({ actions, onAction }) => {
  const { t } = useI18nStore();
  return (
    <div role="toolbar" aria-label={t('builder.format.toolbar')} data-testid="format-toolbar" className="mb-1 flex items-center gap-0.5">
      {actions.map((action) => {
        const Icon = ICONS[action];
        const label = t(`builder.format.${action}`);
        return (
          <button
            key={action}
            type="button"
            data-testid={`format-${action}`}
            aria-label={label}
            title={label}
            // Keeps the selection in the message field while the button is pressed.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAction(action)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-text-2 hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon size={13} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
};
