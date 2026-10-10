import React, { useEffect, useRef } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { nodeOutputPaths } from './constants/nodeCatalog';
export { isValidPath } from './mappingGrammar';

export interface VariableGroup {
  key: string;
  /** Group label: the step's display name (steps) or a trigger title. */
  label: string;
  /** Mapping prefix: `trigger.input` or `nodes.<id>.output`. */
  prefix: string;
  paths: string[];
  /** Node types behind the group, used to look up friendly path names. */
  nodeTypes: string[];
  /** Trigger input that has no fixed keys (manual, webhook): the user types the key. */
  freeForm?: boolean;
}

const FREE_FORM_TRIGGERS = new Set(['trigger.manual', 'trigger.webhook']);

/** Paths that hold a whole stored file (Telegram photo/document, Drive download, first email attachment). */
const FILE_PATHS = new Set(['file', 'attachments[0]']);

export const mappingOf = (group: VariableGroup, path: string) => `{{ ${group.prefix}.${path} }}`;

/** Friendly name of `path` (`builder.var.path.<nodeType>.<path>`), or undefined when none is defined. */
export const pathLabel = (group: VariableGroup, path: string, t: (key: string) => string): string | undefined => {
  for (const type of group.nodeTypes) {
    const key = `builder.var.path.${type}.${path}`;
    const text = t(key);
    if (text !== key) return text;
  }
  return undefined;
};

/** Files earlier steps produce, as mappings a file source (OCR) can take as is. */
export const fileSources = (groups: VariableGroup[]) =>
  groups.flatMap((group) => group.paths.filter((path) => FILE_PATHS.has(path)).map((path) => ({ group, path, mapping: mappingOf(group, path) })));

/**
 * The trigger and the steps that run BEFORE `selectedId` (reachable backwards through edges): the server
 * rejects a mapping to any other step (DefinitionValidator). `stepLabel` names a step (defaults to its id).
 */
export function upstreamGroups(
  nodes: Node[], edges: Pick<Edge, 'source' | 'target'>[], selectedId: string, triggerLabel: string,
  stepLabel: (node: Node) => string = (node) => node.id,
): VariableGroup[] {
  const parents = new Map<string, string[]>();
  edges.forEach((edge) => parents.set(edge.target, [...(parents.get(edge.target) ?? []), edge.source]));
  const seen = new Set<string>();
  const queue = [...(parents.get(selectedId) ?? [])];
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id) || id === selectedId) continue;
    seen.add(id);
    queue.push(...(parents.get(id) ?? []));
  }
  const upstream = nodes.filter((node) => seen.has(node.id));
  const config = (node: Node) => (node.data?.config ?? {}) as Record<string, unknown>;
  const groups: VariableGroup[] = [];
  const triggers = upstream.filter((node) => String(node.data?.nodeType ?? '').startsWith('trigger.'));
  if (triggers.length) {
    const paths = [...new Set(triggers.flatMap((node) => nodeOutputPaths(String(node.data?.nodeType), config(node))))];
    groups.push({
      key: 'trigger',
      label: triggerLabel,
      prefix: 'trigger.input',
      paths,
      nodeTypes: triggers.map((node) => String(node.data?.nodeType)),
      freeForm: triggers.some((node) => FREE_FORM_TRIGGERS.has(String(node.data?.nodeType))),
    });
  }
  upstream
    .filter((node) => !String(node.data?.nodeType ?? '').startsWith('trigger.'))
    .forEach((node) => {
      const type = String(node.data?.nodeType);
      groups.push({ key: node.id, label: stepLabel(node), prefix: `nodes.${node.id}.output`, paths: nodeOutputPaths(type, config(node)), nodeTypes: [type] });
    });
  return groups;
}

type TextField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Remembers the text field the user last focused inside the inspector, so the picker can insert there
 * (the picker's own buttons do not take focus away). Fields that are never mapped opt out with `data-notemplate`.
 */
export function useFieldTarget(resetKey: unknown) {
  const target = useRef<TextField | null>(null);
  // A field of the previously selected step must not receive an insert meant for this one.
  useEffect(() => { target.current = null; }, [resetKey]);
  const onFocusCapture = (event: React.FocusEvent) => {
    const el = event.target;
    const isText = (el instanceof HTMLInputElement && (el.type === 'text' || el.type === '')) || el instanceof HTMLTextAreaElement;
    if (isText && !el.readOnly && el.dataset.notemplate === undefined && !el.closest('[data-variable-picker]')) target.current = el;
  };
  /** Inserts at the cursor (replacing the selection); false when there is no field to insert into. */
  const insert = (text: string): boolean => {
    const el = target.current;
    if (!el || !el.isConnected) return false;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    // Go through the native setter so React's controlled onChange sees the edit.
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, el.value.slice(0, start) + text + el.value.slice(end));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
    return true;
  };
  return { onFocusCapture, insert };
}
