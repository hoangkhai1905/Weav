import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useI18nStore } from '../../store/useI18nStore';
import { describeMapping, mappingFieldInserts, type VariableGroup } from '../../lib/variablePaths';

interface MappingTextFieldProps {
  id: string;
  /** Id of the visible label (a <label for> does not focus a contenteditable). */
  labelledBy: string;
  value: string;
  onChange: (next: string) => void;
  /** Data the trigger and earlier steps hand over: names the chips and flags data no step provides. */
  groups: VariableGroup[];
  multiline?: boolean;
  placeholder?: string;
}

// Browsers keep typed spaces as non-breaking spaces in contenteditable.
const NBSP = new RegExp(String.fromCharCode(160), 'g');
const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const HAS_TOKEN = /\{\{\s*[^{}]+?\s*\}\}/;
const CHIP = 'mx-0.5 inline-flex select-none items-center gap-1 rounded border px-1.5 align-baseline text-[11px] font-medium leading-5';
const CHIP_OK = `${CHIP} border-run/30 bg-run-bg text-run`;
const CHIP_UNKNOWN = `${CHIP} border-warn/40 bg-warn-bg text-warn`;

/**
 * A text field that shows each `{{ ... }}` as a chip with a friendly name ("Text read") and an × to remove it,
 * while the saved value stays the plain mapping string. Typing, pasting and "Insert variable" all work; a
 * mapping typed or pasted by hand turns into a chip when the field loses focus.
 */
export const MappingTextField: React.FC<MappingTextFieldProps> = ({ id, labelledBy, value, onChange, groups, multiline, placeholder }) => {
  const { t } = useI18nStore();
  const ref = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  // Where the caret was last inside this field: "Insert variable" takes focus away, so the live selection is gone.
  const caret = useRef<Range | null>(null);
  // Latest props for DOM handlers and the registered insert, which outlive a single render.
  const live = useRef({ groups, t, onChange });
  useLayoutEffect(() => {
    live.current = { groups, t, onChange };
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

  const render = (text: string) => ref.current?.replaceChildren(...nodesFor(text));

  const serialize = (): string => {
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
    if (ref.current) walk(ref.current);
    return multiline ? out : out.replace(/\n/g, ' ');
  };

  const emit = () => {
    const next = serialize();
    // Keep the field truly empty so the placeholder shows again.
    if (next === '' && ref.current?.childNodes.length) ref.current.replaceChildren();
    emitted.current = next;
    live.current.onChange(next);
  };

  // Rebuild the chips only when the value changed from outside (another step, a quick insert), never while typing.
  useLayoutEffect(() => {
    if (value !== emitted.current) {
      render(value);
      emitted.current = value;
    }
  });

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
    mappingFieldInserts.set(el, (text) => {
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
    });
    return () => {
      document.removeEventListener('selectionchange', remember);
      mappingFieldInserts.delete(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the insert reads live props through refs
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      role="textbox"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      aria-multiline={multiline ? 'true' : 'false'}
      aria-labelledby={labelledBy}
      aria-placeholder={placeholder}
      data-mapping-field
      data-placeholder={placeholder}
      data-value={value}
      spellCheck={false}
      onInput={emit}
      // Turn a {{ ... }} typed or pasted by hand into a chip; otherwise leave the nodes (and the remembered caret) alone.
      onBlur={() => {
        const typed = [...(ref.current?.childNodes ?? [])].some((node) => node.nodeType === Node.TEXT_NODE && HAS_TOKEN.test(node.textContent ?? ''));
        if (typed) render(serialize());
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
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
      className={`w-full cursor-text rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs leading-6 text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] ${multiline ? 'min-h-[6rem] whitespace-pre-wrap break-words' : 'min-h-[2rem] overflow-x-auto whitespace-pre'}`}
    />
  );
};
