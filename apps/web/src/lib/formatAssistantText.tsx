import type { ReactNode } from 'react';

/**
 * Minimal assistant-reply formatting without a markdown library or raw HTML:
 * `**bold**` becomes <strong>, `` `code` `` becomes <code>; everything else (including HTML-looking
 * text and unclosed markers) stays literal text. Line breaks are kept by the caller's `whitespace-pre-wrap`.
 */
export function formatAssistantText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, index) => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="rounded bg-muted px-1 font-mono text-[0.92em]">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}
