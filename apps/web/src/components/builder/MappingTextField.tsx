import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Braces } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import { FormatToolbar } from './FormatToolbar';
import { FormatPreview } from './FormatPreview';
import { formatInsert, type FormatAction, type FormatSyntax } from '../../lib/formatInsert';
import { formatPreview, richEditable } from '../../lib/formatPreview';
import { buildRich, serializeRich } from './richText';
import { DataMenu } from './DataMenu';
import { describeMapping, mappingFieldInserts, type VariableGroup } from '../../lib/variablePaths';

interface MappingTextFieldProps {
  id: string;
  /** Id of the visible label (a <label for> does not focus a contenteditable). */
  labelledBy?: string;
  describedBy?: string;
  required?: boolean;
  /** Accessible name when there is no visible label of its own. */
  ariaLabel?: string;
  value: string;
  onChange: (next: string) => void;
  /** Data the trigger and earlier steps hand over: names the chips, fills the "+ Data" menu, flags unknown data. */
  groups: VariableGroup[];
  multiline?: boolean;
  placeholder?: string;
  testId?: string;
  /** Classes for the outer wrapper, for example `min-w-0 flex-1` inside a row. */
  className?: string;
  /**
   * Format buttons above the field that write `syntax`; `onUse` (first use) may switch the step to a formatted mode and
   * return a short note. `rich`: the step's mode shows formatting, so the field is edited visually, with a "</> code"
   * switch to the source for people who want it.
   */
  format?: { syntax: FormatSyntax; actions: FormatAction[]; onUse?: () => string | void; rich?: boolean };
}

// Browsers keep typed spaces as non-breaking spaces in contenteditable.
const NBSP = new RegExp(String.fromCharCode(160), 'g');
const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const HAS_TOKEN = /\{\{\s*[^{}]+?\s*\}\}/;
const CHIP = 'mx-0.5 inline-flex select-none items-center gap-1 rounded border px-1.5 align-baseline text-xs font-medium leading-5';
const CHIP_OK = `${CHIP} border-transparent bg-run-bg text-run`;
const CHIP_UNKNOWN = `${CHIP} border-warn/40 bg-warn-bg text-warn`;

/**
 * A text field that shows each `{{ ... }}` as a chip with a friendly name ("Text read") and an × to remove it,
 * while the saved value stays the plain mapping string. A "+ Data" menu under the field inserts data from the
 * steps before at the caret; typing, pasting and "Insert variable" also work, and a mapping typed or pasted by
 * hand turns into a chip when the field loses focus.
 */
export const MappingTextField: React.FC<MappingTextFieldProps> = ({ id, labelledBy, describedBy, required, ariaLabel, value, onChange, groups, multiline, placeholder, testId, className, format }) => {
  const { t } = useI18nStore();
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [formatNote, setFormatNote] = useState('');
  // Source code instead of the visual editor: chosen by the user, or forced when the visual editor would lose markup.
  const [codeMode, setCodeMode] = useState(() => Boolean(format?.rich) && !richEditable(format!.syntax, value));
  const rich = Boolean(format?.rich) && !codeMode;
  const emitted = useRef<string | null>(null);
  // Whether the field's DOM currently holds the visual editor (formatting elements) or plain text and chips.
  const shownRich = useRef<boolean | null>(null);
  // Where the caret was last inside this field: a menu or "Insert variable" takes focus away, so the live selection is gone.
  const caret = useRef<Range | null>(null);
  // Latest props for DOM handlers and the registered insert, which outlive a single render.
  const live = useRef({ groups, t, onChange, format, rich });
  useLayoutEffect(() => {
    live.current = { groups, t, onChange, format, rich };
  });

  const chip = (inner: string) => {
    const info = describeMapping(inner, live.current.groups, live.current.t);
    const span = document.createElement('span');
    span.contentEditable = 'false';
    span.dataset.mapping = `{{ ${inner} }}`;
    span.dataset.testid = 'mapping-chip';
    span.title = info.title;
    span.className = info.known ? CHIP_OK : CHIP_UNKNOWN;
    span.append(info.label);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.tabIndex = -1;
    remove.dataset.chipRemove = '';
    remove.setAttribute('aria-label', `${live.current.t('builder.var.remove')}: ${info.label}`);
    remove.className = 'leading-none opacity-60 hover:opacity-100';
    remove.textContent = '×';
    span.append(remove);
    return span;
  };

  const nodesFor = (text: string): Node[] => {
    const nodes: Node[] = [];
    let at = 0;
    for (const match of text.matchAll(TOKEN)) {
      if (match.index > at) nodes.push(document.createTextNode(text.slice(at, match.index)));
      nodes.push(chip(match[1].trim()));
      at = match.index + match[0].length;
    }
    if (at < text.length) nodes.push(document.createTextNode(text.slice(at)));
    return nodes;
  };

  const render = (text: string) => {
    const syntax = live.current.format?.syntax;
    ref.current?.replaceChildren(...(live.current.rich && syntax ? buildRich(formatPreview(syntax, text), syntax, nodesFor) : nodesFor(text)));
  };

  const serialize = (root: Node | null = ref.current): string => {
    const syntax = live.current.format?.syntax;
    if (live.current.rich && syntax && root && root === ref.current) return serializeRich(root, syntax);
    let out = '';
    const walk = (parent: Node) => parent.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) out += (child.textContent ?? '').replace(NBSP, ' ');
      else if (child instanceof HTMLElement && child.dataset.mapping) out += child.dataset.mapping;
      else if (child instanceof HTMLElement && child.tagName === 'BR') {
        // A trailing <br> only keeps the last empty line visible; it is not content.
        if (child !== parent.lastChild || parent !== ref.current) out += '\n';
      } else if (child instanceof HTMLElement) {
        if (child.tagName === 'DIV' && out && !out.endsWith('\n')) out += '\n';
        walk(child);
      }
    });
    if (root) walk(root);
    return multiline ? out : out.replace(/\n/g, ' ');
  };

  const emit = () => {
    const next = serialize();
    // Keep the field truly empty so the placeholder shows again.
    if (next === '' && ref.current?.childNodes.length) ref.current.replaceChildren();
    emitted.current = next;
    live.current.onChange(next);
  };

  /** Inserts `text` (chips for its mappings) at the remembered caret, else at the end of the field. */
  const insert = (text: string) => {
    const el = ref.current;
    if (!el) return;
    const selection = window.getSelection();
    // The remembered caret, unless the field was rebuilt since (its nodes are gone): then the end of the field.
    let range = caret.current && el.contains(caret.current.startContainer) ? caret.current : null;
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.deleteContents();
    const nodes = nodesFor(text);
    const fragment = document.createDocumentFragment();
    fragment.append(...nodes);
    range.insertNode(fragment);
    const last = nodes[nodes.length - 1];
    el.focus();
    if (last && selection) {
      const after = document.createRange();
      after.setStartAfter(last);
      after.collapse(true);
      selection.removeAllRanges();
      selection.addRange(after);
      caret.current = after.cloneRange();
    }
    emit();
  };
  /** A format button: formats the selection visually, or (source code) wraps it in the syntax. */
  const applyFormat = (action: FormatAction) => {
    const el = ref.current;
    const current = live.current.format;
    if (!el || !current) return;
    if (codeMode) {
      applySource(action);
      return;
    }
    if (!live.current.rich) {
      // First format in a plain step (text email, Telegram without a parse mode): switch the step, then edit visually.
      setFormatNote(current.onUse?.() || '');
      live.current.rich = true;
      shownRich.current = true;
      // Typed line breaks would collapse in an HTML email, so they become <br> first.
      if (current.syntax === 'html') {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const texts: Text[] = [];
        while (walker.nextNode()) texts.push(walker.currentNode as Text);
        texts.filter((node) => node.data.includes('\n')).forEach((node) => {
          const parts = node.data.split('\n');
          node.replaceWith(...parts.flatMap((part, index) => (index ? [document.createElement('br'), part] : [part])));
        });
      }
    }
    el.focus();
    const selection = window.getSelection();
    if (selection && caret.current && el.contains(caret.current.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(caret.current);
    }
    document.execCommand('styleWithCSS', false, 'false');
    if (action === 'bold') document.execCommand('bold');
    else if (action === 'italic') document.execCommand('italic');
    else if (action === 'list') document.execCommand('insertUnorderedList');
    else if (action === 'lineBreak') document.execCommand('insertLineBreak');
    else if (selection) {
      const selected = selection.toString().trim();
      const url = /^https?:\/\/\S+$/.test(selected) ? selected : window.prompt(live.current.t('builder.format.link_prompt'), 'https://')?.trim();
      if (!url || !/^https?:\/\/\S+$/.test(url)) return;
      if (selection.isCollapsed) {
        // Nothing selected: the address itself becomes the link text.
        document.execCommand('insertText', false, url);
        const { focusNode, focusOffset } = selection;
        if (focusNode && focusOffset >= url.length) selection.setBaseAndExtent(focusNode, focusOffset - url.length, focusNode, focusOffset);
      }
      document.execCommand('createLink', false, url);
    }
    emit();
  };

  /** Source code: wraps the selected text (or a sample word) in the syntax of this field's format and keeps it selected. */
  const applySource = (action: FormatAction) => {
    const el = ref.current;
    const current = live.current.format;
    if (!el || !current) return;
    let range = caret.current && el.contains(caret.current.startContainer) ? caret.current : null;
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    const { before, inner, after } = formatInsert(current.syntax, action, serialize(range.cloneContents()), live.current.t('builder.format.sample'));
    range.deleteContents();
    const innerNodes = nodesFor(inner);
    if (!innerNodes.length) innerNodes.push(document.createTextNode(''));
    const nodes = [...nodesFor(before), ...innerNodes, ...nodesFor(after)];
    const fragment = document.createDocumentFragment();
    fragment.append(...nodes);
    range.insertNode(fragment);
    el.focus();
    const selection = window.getSelection();
    if (selection) {
      const picked = document.createRange();
      if (inner) {
        picked.setStartBefore(innerNodes[0]);
        picked.setEndAfter(innerNodes[innerNodes.length - 1]);
      } else {
        picked.setStartAfter(nodes[nodes.length - 1]);
        picked.collapse(true);
      }
      selection.removeAllRanges();
      selection.addRange(picked);
      caret.current = picked.cloneRange();
    }
    emit();
    setFormatNote(current.onUse?.() || '');
  };

  const insertRef = useRef(insert);
  useLayoutEffect(() => {
    insertRef.current = insert;
  });

  // Rebuild the field only when the value changed from outside (another step, a quick insert) or the editor switched
  // between visual and source, never while typing.
  useLayoutEffect(() => {
    if (value !== emitted.current || shownRich.current !== rich) {
      render(value);
      emitted.current = value;
      shownRich.current = rich;
    }
  });

  const toggleCode = () => {
    if (codeMode && format && !richEditable(format.syntax, value)) {
      setFormatNote(t('builder.format.code_only'));
      return;
    }
    setFormatNote('');
    setCodeMode(!codeMode);
  };

  // Chip names follow the steps before; refresh them when those change and the user is not typing here.
  const groupsKey = groups.map((group) => `${group.key}:${group.label}:${group.paths.join(',')}`).join('|');
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) render(emitted.current ?? value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the earlier steps change
  }, [groupsKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const remember = () => {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      if (range && el.contains(range.commonAncestorContainer)) caret.current = range.cloneRange();
    };
    document.addEventListener('selectionchange', remember);
    mappingFieldInserts.set(el, (text) => insertRef.current(text));
    return () => {
      document.removeEventListener('selectionchange', remember);
      mappingFieldInserts.delete(el);
    };
  }, []);

  // The "+ Data" menu closes on a click outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const pick = (mapping: string) => {
    insert(mapping);
    setMenuOpen(false);
  };
  // Keeps the caret in the field while the toggle is pressed.
  const keepCaret = (event: React.MouseEvent) => event.preventDefault();

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* With a format toolbar, toolbar and text share one bordered box (design); a plain field keeps its own border. */}
      <div className={format ? 'rounded-lg border border-border-strong bg-card focus-within:ring-2 focus-within:ring-ring' : undefined}>
      {format && (
        <FormatToolbar
          // Enter already breaks the line in the visual editor.
          actions={rich ? format.actions.filter((action) => action !== 'lineBreak') : format.actions}
          onAction={applyFormat}
          code={format.rich ? { label: format.syntax === 'html' || format.syntax === 'telegramHtml' ? 'HTML' : 'Markdown', active: codeMode, onToggle: toggleCode } : undefined}
        />
      )}
      {format && formatNote && <p data-testid="format-note" className="px-2.5 pt-1.5 text-xs leading-relaxed text-muted-foreground">{formatNote}</p>}
      <div
        ref={ref}
        id={id}
        role="textbox"
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        aria-multiline={multiline ? 'true' : 'false'}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        aria-label={ariaLabel}
        aria-placeholder={placeholder}
        data-mapping-field
        data-testid={testId}
        data-placeholder={placeholder}
        data-value={value}
        spellCheck={false}
        onInput={emit}
        // Turn a {{ ... }} typed or pasted by hand into a chip; otherwise leave the nodes (and the remembered caret) alone.
        onBlur={() => {
          const el = ref.current;
          if (!el) return;
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let typed = false;
          while (!typed && walker.nextNode()) typed = HAS_TOKEN.test(walker.currentNode.textContent ?? '');
          if (typed) render(serialize());
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          // In a visual list, Enter starts the next item (and leaves the list on an empty one), as in any editor.
          if (rich && window.getSelection()?.anchorNode?.parentElement?.closest('li')) return;
          event.preventDefault();
          if (multiline) document.execCommand('insertLineBreak');
        }}
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, multiline ? text : text.replace(/\r?\n/g, ' '));
        }}
        onMouseDown={(event) => {
          // Keep the caret where it is when removing a chip.
          if ((event.target as HTMLElement).closest('[data-chip-remove]')) event.preventDefault();
        }}
        onClick={(event) => {
          const remove = (event.target as HTMLElement).closest('[data-chip-remove]');
          if (!remove) return;
          remove.closest('[data-mapping]')?.remove();
          emit();
        }}
        className={`w-full cursor-text bg-card px-2.5 py-1.5 text-[13px] leading-7 text-foreground outline-none ${format ? 'rounded-b-lg' : 'rounded-md border border-border-strong hover:border-muted-foreground focus:ring-2 focus:ring-ring'} empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] ${multiline ? `min-h-[6rem] break-words ${rich && format?.syntax === 'html' ? 'whitespace-normal' : 'whitespace-pre-wrap'}` : 'min-h-[2rem] overflow-x-auto whitespace-pre'} [&_a]:text-run [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5`}
      />
      </div>
      <div ref={menuRef} className="mt-1 flex justify-end">
        <button
          type="button"
          data-testid="mapping-data-toggle"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onMouseDown={keepCaret}
          onClick={() => setMenuOpen(!menuOpen)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong bg-card px-2.5 text-xs font-medium text-foreground hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Braces size={14} strokeWidth={1.75} aria-hidden="true" />{t('builder.var.add_data')}
        </button>
        {menuOpen && <DataMenu groups={groups} onPick={pick} onClose={() => setMenuOpen(false)} />}
      </div>
      {format?.rich && codeMode && <FormatPreview syntax={format.syntax} text={value} groups={groups} />}
    </div>
  );
};
