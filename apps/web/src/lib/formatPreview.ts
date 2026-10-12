import type { FormatSyntax } from './formatInsert';

/** A safe preview tree: only these tags ever reach the DOM, and text is always text. */
export type PreviewTag = 'b' | 'i' | 'u' | 's' | 'a' | 'br' | 'ul' | 'ol' | 'li' | 'p' | 'code' | 'pre' | 'blockquote';
export type PreviewNode = string | { tag: PreviewTag; href?: string; children: PreviewNode[] };

const HTML_TAGS: Record<string, PreviewTag> = {
  b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', ins: 'u', s: 's', strike: 's', del: 's',
  a: 'a', br: 'br', ul: 'ul', ol: 'ol', li: 'li', p: 'p', div: 'p', code: 'code', pre: 'pre', blockquote: 'blockquote',
};
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (text: string) =>
  text.replace(/&(#\d+|[a-z]+);/gi, (whole, name: string) =>
    name.startsWith('#') ? String.fromCodePoint(Number(name.slice(1))) : ENTITIES[name.toLowerCase()] ?? whole);

/** Only web addresses (or a {{ variable }} that will become one) are kept as link targets. */
const safeHref = (href: string) => (/^https?:\/\//i.test(href) || /^\{\{[^}]*\}\}/.test(href) ? href : undefined);

function parseHtml(text: string): PreviewNode[] {
  const root: PreviewNode[] = [];
  const stack: { tag: PreviewTag; node: Exclude<PreviewNode, string> }[] = [];
  const target = () => (stack.length ? stack[stack.length - 1].node.children : root);
  let at = 0;
  for (const match of text.matchAll(/<(\/?)([a-z]+)\b([^>]*)>/gi)) {
    const tag = HTML_TAGS[match[2].toLowerCase()];
    if (!tag) continue; // unknown tags stay visible as text, the way a strict receiver would show the problem
    if (match.index > at) target().push(decode(text.slice(at, match.index)));
    at = match.index + match[0].length;
    if (tag === 'br') {
      target().push({ tag, children: [] });
    } else if (match[1]) {
      const index = stack.map((entry) => entry.tag).lastIndexOf(tag);
      if (index >= 0) stack.length = index;
    } else {
      const href = tag === 'a' ? safeHref(decode(/href\s*=\s*["']([^"']*)["']/i.exec(match[3])?.[1] ?? '')) : undefined;
      const node = { tag, href, children: [] as PreviewNode[] };
      target().push(node);
      stack.push({ tag, node });
    }
  }
  if (at < text.length) target().push(decode(text.slice(at)));
  return root;
}

type Rule = { pattern: RegExp; build: (match: RegExpExecArray) => PreviewNode };
const wrap = (tag: PreviewTag, syntax: FormatSyntax) => (match: RegExpExecArray): PreviewNode => ({ tag, children: inline(syntax, match[1]) });
const mdLink = (syntax: FormatSyntax) => (match: RegExpExecArray): PreviewNode => ({ tag: 'a', href: safeHref(match[2]), children: inline(syntax, match[1]) });
// [text](target): the target is a web address or a {{ variable }} (which may hold spaces).
const MD_LINK = /\[([^\]\n]+)\]\(((?:\{\{[^}]*\}\}|[^)\s])+)\)/;
const code: Rule ={ pattern: /`([^`\n]+)`/, build: (match) => ({ tag: 'code', children: [match[1]] }) };

// Order matters: longer markers first so ** wins over * at the same position.
const INLINE_RULES: Partial<Record<FormatSyntax, (syntax: FormatSyntax) => Rule[]>> = {
  markdown: (syntax) => [
    code,
    { pattern: MD_LINK, build: mdLink(syntax) },
    { pattern: /\*\*(.+?)\*\*/, build: wrap('b', syntax) },
    { pattern: /__(.+?)__/, build: wrap('u', syntax) },
    { pattern: /~~(.+?)~~/, build: wrap('s', syntax) },
    { pattern: /\*([^*\n]+)\*/, build: wrap('i', syntax) },
    { pattern: /_([^_\n]+)_/, build: wrap('i', syntax) },
  ],
  teams: (syntax) => [
    { pattern: MD_LINK, build: mdLink(syntax) },
    { pattern: /\*\*(.+?)\*\*/, build: wrap('b', syntax) },
    { pattern: /\*([^*\n]+)\*/, build: wrap('i', syntax) },
    { pattern: /_([^_\n]+)_/, build: wrap('i', syntax) },
  ],
  slack: (syntax) => [
    code,
    { pattern: /<(https?:\/\/[^|>\s]+)\|([^>]+)>/, build: (match) => ({ tag: 'a', href: match[1], children: inline(syntax, match[2]) }) },
    { pattern: /<(https?:\/\/[^>\s]+)>/, build: (match) => ({ tag: 'a', href: match[1], children: [match[1]] }) },
    { pattern: /\*([^*\n]+)\*/, build: wrap('b', syntax) },
    { pattern: /_([^_\n]+)_/, build: wrap('i', syntax) },
    { pattern: /~([^~\n]+)~/, build: wrap('s', syntax) },
  ],
  telegramMarkdown: (syntax) => [
    code,
    { pattern: MD_LINK, build: mdLink(syntax) },
    { pattern: /\*([^*\n]+)\*/, build: wrap('b', syntax) },
    { pattern: /__(.+?)__/, build: wrap('u', syntax) },
    { pattern: /_([^_\n]+)_/, build: wrap('i', syntax) },
    { pattern: /~([^~\n]+)~/, build: wrap('s', syntax) },
  ],
};

/** True when `index` falls inside a {{ variable }}: paths often contain _ or *, which are never markup there. */
const insideVariable = (text: string, index: number) => {
  const open = text.lastIndexOf('{{', index);
  return open >= 0 && text.lastIndexOf('}}', index) < open && text.indexOf('}}', index) >= 0;
};

/** Inline Markdown-like markup: the earliest match of any rule wins, and the text around it is parsed again. */
function inline(syntax: FormatSyntax, text: string): PreviewNode[] {
  const rules = INLINE_RULES[syntax]?.(syntax) ?? [];
  let best: { match: RegExpExecArray; rule: Rule } | null = null;
  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (match && !insideVariable(text, match.index) && (!best || match.index < best.match.index)) best = { match, rule };
  }
  if (!best) return text ? [syntax === 'telegramMarkdown' ? text.replace(/\\(.)/g, '$1') : text] : [];
  const { match, rule } = best;
  return [...inline(syntax, text.slice(0, match.index)), rule.build(match), ...inline(syntax, text.slice(match.index + match[0].length))];
}

const LIST_ITEM = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/;

/** Markdown-like text: "- item" / "1. item" lines become lists where the receiver supports them; other lines keep their breaks. */
function parseMarkdown(syntax: FormatSyntax, text: string): PreviewNode[] {
  const lists = syntax === 'markdown' || syntax === 'teams';
  const lines = text.split('\n');
  const out: PreviewNode[] = [];
  let list: Exclude<PreviewNode, string> | null = null;
  lines.forEach((line, index) => {
    const item = lists ? LIST_ITEM.exec(line) : null;
    if (item) {
      const tag = item[1] ? 'ul' : 'ol';
      if (!list || list.tag !== tag) out.push((list = { tag, children: [] }));
      list.children.push({ tag: 'li', children: inline(syntax, item[3]) });
      return;
    }
    list = null;
    out.push(...inline(syntax, line));
    // A list is a block of its own, so the line before it needs no break.
    const next = lines[index + 1];
    if (next !== undefined && !(lists && LIST_ITEM.test(next))) out.push({ tag: 'br', children: [] });
  });
  return out;
}

// Tags the visual editor can write back unchanged; anything else (tables, images, styles, comments) is code only.
const EDITABLE_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'a', 'br', 'ul', 'ol', 'li', 'code']);

/** True when the visual editor can show `text` and save it back without losing anything the author wrote. */
export function richEditable(syntax: FormatSyntax, text: string): boolean {
  if (syntax !== 'html' && syntax !== 'telegramHtml') return true;
  if (/<[!?]/.test(text)) return false;
  for (const match of text.matchAll(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    if (!EDITABLE_TAGS.has(tag)) return false;
    const attrs = match[2].replace(/\/\s*$/, '').trim();
    if (attrs && !(tag === 'a' && /^href\s*=\s*("[^"]*"|'[^']*')$/i.test(attrs))) return false;
  }
  return true;
}

/** What the receiver will show for `text` written in `syntax`, as a tree that is safe to render. */
export function formatPreview(syntax: FormatSyntax, text: string): PreviewNode[] {
  return syntax === 'html' || syntax === 'telegramHtml' ? parseHtml(text) : parseMarkdown(syntax, text);
}
