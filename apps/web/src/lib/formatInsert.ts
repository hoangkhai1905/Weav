/** Message formats a send-step understands: what a toolbar button writes depends on it. */
export type FormatSyntax = 'html' | 'telegramHtml' | 'telegramMarkdown' | 'markdown' | 'slack';
export type FormatAction = 'bold' | 'italic' | 'link' | 'list' | 'lineBreak';

/** Text to put where the selection was: `inner` is what stays selected afterwards (empty: caret goes after `before`). */
export interface FormatResult {
  before: string;
  inner: string;
  after: string;
}

const PAIRS: Record<FormatSyntax, Record<'bold' | 'italic', [string, string]>> = {
  html: { bold: ['<b>', '</b>'], italic: ['<i>', '</i>'] },
  telegramHtml: { bold: ['<b>', '</b>'], italic: ['<i>', '</i>'] },
  telegramMarkdown: { bold: ['*', '*'], italic: ['_', '_'] },
  markdown: { bold: ['**', '**'], italic: ['*', '*'] },
  slack: { bold: ['*', '*'], italic: ['_', '_'] },
};

const URL_ONLY = /^https?:\/\/\S+$/;

/**
 * Wraps the selected text (or `placeholder` when nothing is selected) in the syntax of `syntax`.
 * Pure: the caller replaces the selection with before + inner + after. Text such as `{{ ... }}` inside the
 * selection is carried through unchanged.
 */
export function formatInsert(syntax: FormatSyntax, action: FormatAction, selected: string, placeholder: string): FormatResult {
  const text = selected || placeholder;
  if (action === 'bold' || action === 'italic') {
    const [open, close] = PAIRS[syntax][action];
    return { before: open, inner: text, after: close };
  }
  if (action === 'lineBreak') return { before: `${selected}<br>\n`, inner: '', after: '' };
  if (action === 'list') {
    const items = text.split(/\r?\n/).filter((line) => line.trim() !== '');
    return { before: '<ul>\n<li>', inner: items.join('</li>\n<li>'), after: '</li>\n</ul>' };
  }
  // link: a selected web address becomes the target, any other selection becomes the link text.
  const isUrl = URL_ONLY.test(selected.trim());
  const url = isUrl ? selected.trim() : 'https://';
  const label = isUrl ? selected.trim() : text;
  if (syntax === 'html' || syntax === 'telegramHtml') return { before: `<a href="${url}">`, inner: label, after: '</a>' };
  if (syntax === 'slack') return { before: `<${url}|`, inner: label, after: '>' };
  return { before: '[', inner: label, after: `](${url})` };
}
