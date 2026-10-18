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

/** "firstName" -> "First name", "attachments[0]" -> "Attachments 1": the last segment of a path, never the whole path. */
const humanise = (path: string) => {
  const last = path.split('.').pop() ?? path;
  const words = last
    .replace(/\[(\d+)\]/g, (_, index) => ` ${Number(index) + 1}`)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** What a person reads for `path`: its friendly name, else the humanised last segment. */
export const outputLabel = (group: VariableGroup, path: string, t: (key: string) => string): string =>
  pathLabel(group, path, t) ?? humanise(path);

/** Lower-cased text without accents (and with đ as d), so "nguoi gui" finds "Người gửi". */
export const searchKey = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase();

/** Content people most often put in a message or prompt (`<nodeType>:<path>`), offered as one-click suggestions. */
const FEATURED_PATHS = new Set([
  'trigger.telegram:message.text', 'trigger.telegram:message.from.firstName',
  'trigger.gmail:subject', 'trigger.gmail:body', 'trigger.gmail:fromName',
  'ocr.extract:text.rawText', 'ai.summarize:summary', 'ai.classify:category', 'ai.generate:text',
  'google.drive:webViewLink',
]);

/**
 * Up to `max` featured values from earlier steps, the closest step first. With an OCR step before, the run is
 * about a photo or file: a Telegram photo carries no `message.text` (only an optional caption), so that
 * suggestion would make the run fail with a missing value and is left out.
 */
export const suggestedData = (groups: VariableGroup[], max = 4) => {
  const readsFile = groups.some((group) => group.nodeTypes.includes('ocr.extract'));
  return groups
    .flatMap((group) => group.paths
      .filter((path) => group.nodeTypes.some((type) => FEATURED_PATHS.has(`${type}:${path}`)
        && !(readsFile && type === 'trigger.telegram' && path === 'message.text')))
      .map((path) => ({ group, path, mapping: mappingOf(group, path) })))
    .slice(0, max);
};

/** W6-C3: values of the run itself; the path IS the whole expression (no prefix). */
export const RUN_PATHS: Array<{ path: string; labelKey: string }> = [
  { path: 'now', labelKey: 'builder.var.run_now' },
  { path: 'run.id', labelKey: 'builder.var.run_id' },
  { path: 'workflow.id', labelKey: 'builder.var.workflow_id' },
  { path: 'workflow.name', labelKey: 'builder.var.workflow_name' },
];

/**
 * How a `{{ inner }}` expression reads to a person: the friendly name of the data, a tooltip with its step, and whether
 * an earlier step (or the run) really provides it. A path is provided when it is a listed path or goes deeper into one
 * (`data.name` under `data`); data nothing provides reads as "gone".
 */
export const describeMapping = (inner: string, groups: VariableGroup[], t: (key: string) => string) => {
  const run = RUN_PATHS.find((item) => item.path === inner);
  if (run) return { label: t(run.labelKey), title: t('builder.var.run'), known: true };
  // Data that is not offered here (a deleted step, or one no longer before this step) reads as gone; the saved value is kept as is.
  const missing = { label: t('builder.var.missing'), title: t('builder.var.unknown'), known: false };
  const group = groups.find((item) => inner.startsWith(`${item.prefix}.`));
  if (!group) return missing;
  const path = inner.slice(group.prefix.length + 1);
  // The nearest (longest) listed path that `path` is, or extends at a segment boundary.
  const listed = group.paths
    .filter((p) => path === p || path.startsWith(`${p}.`) || path.startsWith(`${p}[`))
    .sort((a, b) => b.length - a.length)[0];
  if (listed === undefined && !group.freeForm) return missing;
  const base = listed ?? path;
  const rest = path.slice(base.length).split('.').filter(Boolean).map(humanise);
  return { label: [group.label, outputLabel(group, base, t), ...rest].join(' › '), title: group.label, known: true };
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
  // Breadth-first walk backwards: `seen` maps each earlier step to its distance from the selected one.
  const seen = new Map<string, number>();
  const queue: Array<[string, number]> = (parents.get(selectedId) ?? []).map((id) => [id, 1]);
  while (queue.length) {
    const [id, distance] = queue.shift() as [string, number];
    if (seen.has(id) || id === selectedId) continue;
    seen.set(id, distance);
    queue.push(...(parents.get(id) ?? []).map((parent): [string, number] => [parent, distance + 1]));
  }
  const upstream = nodes.filter((node) => seen.has(node.id));
  const distanceOf: Record<string, number> = {};
  const config = (node: Node) => (node.data?.config ?? {}) as Record<string, unknown>;
  const groups: VariableGroup[] = [];
  const triggers = upstream.filter((node) => String(node.data?.nodeType ?? '').startsWith('trigger.'));
  if (triggers.length) {
    const paths = [...new Set(triggers.flatMap((node) => nodeOutputPaths(String(node.data?.nodeType), config(node))))];
    distanceOf.trigger = Math.min(...triggers.map((node) => seen.get(node.id) as number));
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
      distanceOf[node.id] = seen.get(node.id) as number;
      groups.push({ key: node.id, label: stepLabel(node), prefix: `nodes.${node.id}.output`, paths: nodeOutputPaths(type, config(node)), nodeTypes: [type] });
    });
  // Nearest step first; the sort is stable, so equally close steps keep the canvas order.
  return groups.sort((a, b) => distanceOf[a.key] - distanceOf[b.key]);
}
