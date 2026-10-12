import React from 'react';
import { Eye } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import type { FormatSyntax } from '../../lib/formatInsert';
import { formatPreview, type PreviewNode } from '../../lib/formatPreview';
import { describeMapping, type VariableGroup } from '../../lib/variablePaths';

const VARIABLE = /\{\{\s*([^{}]+?)\s*\}\}/g;

const TAG_CLASS: Record<string, string> = {
  b: 'font-semibold',
  i: 'italic',
  u: 'underline',
  s: 'line-through',
  ul: 'my-1 list-disc pl-4',
  ol: 'my-1 list-decimal pl-4',
  p: 'my-1',
  code: 'rounded bg-muted px-1 font-mono text-[11px]',
  pre: 'my-1 whitespace-pre-wrap rounded bg-muted p-1.5 font-mono text-[11px]',
  blockquote: 'my-1 border-l-2 border-border-strong pl-2 text-text-2',
};

interface FormatPreviewProps {
  syntax: FormatSyntax;
  text: string;
  groups: VariableGroup[];
}

/** How the receiver will show a formatted message, rendered from a whitelisted tree (never as raw HTML). */
export const FormatPreview: React.FC<FormatPreviewProps> = ({ syntax, text, groups }) => {
  const { t } = useI18nStore();

  // Variables are filled in when the step runs, so the preview shows them as named chips.
  const renderText = (value: string, key: string) => {
    const parts: React.ReactNode[] = [];
    let at = 0;
    for (const match of value.matchAll(VARIABLE)) {
      if (match.index > at) parts.push(value.slice(at, match.index));
      const info = describeMapping(match[1].trim(), groups, t);
      parts.push(
        <span key={`${key}-v${match.index}`} title={info.title} className="mx-0.5 rounded border border-run/30 bg-run-bg px-1 text-[10px] font-medium not-italic text-run">
          {info.label}
        </span>,
      );
      at = match.index + match[0].length;
    }
    if (at < value.length) parts.push(value.slice(at));
    return parts;
  };

  const render = (nodes: PreviewNode[], key: string): React.ReactNode[] =>
    nodes.map((node, index) => {
      const childKey = `${key}-${index}`;
      if (typeof node === 'string') return <React.Fragment key={childKey}>{renderText(node, childKey)}</React.Fragment>;
      if (node.tag === 'br') return <br key={childKey} />;
      const children = render(node.children, childKey);
      if (node.tag === 'a') {
        return node.href && /^https?:\/\//i.test(node.href)
          ? <a key={childKey} href={node.href} target="_blank" rel="noreferrer" className="text-run underline">{children}</a>
          : <span key={childKey} className="text-run underline">{children}</span>;
      }
      return React.createElement(node.tag, { key: childKey, className: TAG_CLASS[node.tag] }, children);
    });

  if (!text.trim()) return null;
  // An HTML email collapses typed line breaks like a browser does; chat apps keep them.
  const whitespace = syntax === 'html' ? 'whitespace-normal' : 'whitespace-pre-wrap';
  return (
    <div data-testid="format-preview" className="mt-1 rounded-md border border-dashed border-border bg-subtle px-2.5 py-2">
      <p className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Eye size={11} aria-hidden="true" />{t('builder.format.preview')}
      </p>
      <div className={`break-words text-xs leading-5 text-foreground ${whitespace}`}>{render(formatPreview(syntax, text), 'p')}</div>
    </div>
  );
};
