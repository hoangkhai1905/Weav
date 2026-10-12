import type { FormatSyntax } from '../../lib/formatInsert';
import type { PreviewNode } from '../../lib/formatPreview';

// Browsers keep typed spaces as non-breaking spaces in contenteditable.
const NBSP = new RegExp(String.fromCharCode(160), 'g');
// Telegram MarkdownV2 rejects a message with any of these unescaped in plain text.
const MDV2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;

type Mark = 'b' | 'i' | 'u' | 's' | 'code';
const MARK_OF: Record<string, Mark> = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', CODE: 'code' };
// Markdown flavours: what each receiver uses around a mark (a missing mark is written as plain text).
const MARKS: Record<'markdown' | 'slack' | 'teams' | 'telegramMarkdown', Partial<Record<Mark, string>>> = {
  markdown: { b: '**', i: '*', u: '__', s: '~~', code: '`' },
  slack: { b: '*', i: '_', s: '~', code: '`' },
  teams: { b: '**', i: '_' },
  telegramMarkdown: { b: '*', i: '_', u: '__', s: '~', code: '`' },
};

/** DOM nodes for the editor from a parsed message; `textNodes` turns text into text nodes and variable chips. */
export function buildRich(nodes: PreviewNode[], syntax: FormatSyntax, textNodes: (text: string) => Node[]): Node[] {
  return nodes.flatMap((node) => {
    if (typeof node === 'string') {
      // Source line breaks between HTML tags are layout only; an email shows <br> as the break.
      if (syntax === 'html' && !node.trim() && node.includes('\n')) return [];
      return textNodes(node);
    }
    const element = document.createElement(node.tag);
    if (node.tag === 'a' && node.href) element.setAttribute('href', node.href);
    element.append(...buildRich(node.children, syntax, textNodes));
    return [element];
  });
}

/** The editor's content written back in the receiver's syntax; chips become their `{{ ... }}` mapping again. */
export function serializeRich(root: Node, syntax: FormatSyntax): string {
  const html = syntax === 'html' || syntax === 'telegramHtml';
  const newline = syntax === 'html' ? '<br>' : '\n';
  const marks = html ? null : MARKS[syntax as keyof typeof MARKS];
  const text = (value: string) => {
    const plain = value.replace(NBSP, ' ');
    if (html) return plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return syntax === 'telegramMarkdown' ? plain.replace(MDV2_SPECIAL, '\\$&') : plain;
  };

  const walk = (parent: Node): string => {
    let out = '';
    parent.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += text(child.textContent ?? '');
        return;
      }
      if (!(child instanceof HTMLElement)) return;
      if (child.dataset.mapping) {
        out += child.dataset.mapping;
        return;
      }
      const tag = child.tagName;
      if (tag === 'BR') {
        // A trailing <br> only keeps the last empty line visible; it is not content.
        if (child !== parent.lastChild || parent !== root) out += newline;
        return;
      }
      const mark = MARK_OF[tag];
      if (mark) {
        const inner = walk(child);
        if (!inner) return;
        if (html) out += `<${mark}>${inner}</${mark}>`;
        else out += marks?.[mark] ? `${marks[mark]}${inner}${marks[mark]}` : inner;
        return;
      }
      if (tag === 'A') {
        const href = child.getAttribute('href') ?? '';
        const inner = walk(child);
        if (!href) out += inner;
        else if (html) out += `<a href="${href.replace(/"/g, '&quot;')}">${inner}</a>`;
        else if (syntax === 'slack') out += `<${href}|${inner}>`;
        else out += `[${inner}](${href})`;
        return;
      }
      if (tag === 'UL' || tag === 'OL') {
        const items = [...child.children].filter((item) => item.tagName === 'LI').map((item) => walk(item));
        const name = tag.toLowerCase();
        if (syntax === 'html') {
          out += `<${name}>${items.map((item) => `<li>${item}</li>`).join('')}</${name}>`;
          return;
        }
        // Chat apps: one "- item" line each (escaped for MarkdownV2), starting on a line of its own.
        const bullet = (index: number) => (tag === 'OL' ? `${index + 1}.` : '-');
        const marker = (index: number) => (syntax === 'telegramMarkdown' ? bullet(index).replace(MDV2_SPECIAL, '\\$&') : bullet(index));
        if (out && !out.endsWith('\n')) out += '\n';
        out += `${items.map((item, index) => `${marker(index)} ${item}`).join('\n')}\n`;
        return;
      }
      // A line the browser wrapped in its own block (lists, pasted text).
      if (tag === 'DIV' || tag === 'P') {
        if (out && !out.endsWith(newline) && !out.endsWith('\n')) out += newline;
        out += walk(child);
        return;
      }
      out += walk(child);
    });
    return out;
  };

  const out = walk(root);
  return html ? out : out.replace(/\n$/, '');
}
