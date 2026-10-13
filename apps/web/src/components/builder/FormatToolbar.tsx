import React from 'react';
import { Bold, Code2, Italic, Link2, List, WrapText } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import type { FormatAction } from '../../lib/formatInsert';

const ICONS = { bold: Bold, italic: Italic, link: Link2, list: List, lineBreak: WrapText } as const;

interface FormatToolbarProps {
  actions: FormatAction[];
  onAction: (action: FormatAction) => void;
  /** "</> HTML" switch between the visual editor and the source code, for people who want to write it by hand. */
  code?: { label: string; active: boolean; onToggle: () => void };
}

/** Buttons that format the selected text of a message field, plus an optional switch to edit the source. */
export const FormatToolbar: React.FC<FormatToolbarProps> = ({ actions, onAction, code }) => {
  const { t } = useI18nStore();
  const button = 'inline-flex h-7 min-w-7 items-center justify-center rounded text-text-2 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div role="toolbar" aria-label={t('builder.format.toolbar')} data-testid="format-toolbar" className="flex items-center gap-0.5 border-b border-border p-1">
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
            className={button}
          >
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        );
      })}
      {code && (
        <button
          type="button"
          data-testid="format-code-toggle"
          aria-pressed={code.active}
          title={t(code.active ? 'builder.format.code_off' : 'builder.format.code_on')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={code.onToggle}
          className={`${button} ml-auto gap-1 px-2 font-mono text-[11px] font-medium ${code.active ? 'bg-run-bg text-run' : ''}`}
        >
          <Code2 size={14} strokeWidth={1.75} aria-hidden="true" />{code.label}
        </button>
      )}
    </div>
  );
};
