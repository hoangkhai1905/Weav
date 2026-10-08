import type { NodeExecutionResult, WorkflowEdge, WorkflowNode } from '../../types/workflow.types';

const KNOWN_TRIGGERS = new Set(['manual', 'schedule', 'webhook', 'telegram', 'gmail']);

/** "trigger.gmail" / "GMAIL" -> "gmail". */
export function triggerKey(type: string | undefined): string {
  return (type ?? '').toLowerCase().replace(/^trigger\./, '').trim();
}

/** The trigger that describes a workflow: a real (non-manual) trigger wins over a legacy manual one. */
export function primaryTrigger(types: string[] | undefined): string | undefined {
  return types?.find((type) => triggerKey(type) !== 'manual') ?? types?.[0];
}

/** Localised trigger name; an unknown type falls back to a readable form of its own name, never a raw i18n key. */
export function triggerTypeLabel(type: string | undefined, t: (key: string) => string): string {
  const key = triggerKey(type);
  if (!key) return '—';
  if (KNOWN_TRIGGERS.has(key)) return t(`runs.trigger_type.${key}`);
  const words = key.replace(/[._-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Vietnamese label of a config field named by an error's `details.field`; unknown fields keep their own name. */
export function errorFieldLabel(field: string, t: (key: string) => string): string {
  const key = `runs.field.${field}`;
  const label = t(key);
  return label === key ? field : label;
}

/** Steps in graph order (Kahn over the definition, ties by definition order); steps the definition lacks go last by start time. */
export function orderSteps(
  results: NodeExecutionResult[],
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): NodeExecutionResult[] {
  const position = new Map<string, number>();
  const indegree = new Map<string, number>();
  nodes.forEach((node, index) => {
    position.set(node.id, index);
    indegree.set(node.id, 0);
  });
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!position.has(edge.source) || !position.has(edge.target)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const rank = new Map<string, number>();
  const ready = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  while (ready.length > 0) {
    ready.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
    const id = ready.shift() as string;
    rank.set(id, rank.size);
    for (const next of outgoing.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  const started = (step: NodeExecutionResult) => Date.parse(step.startedAt) || Number.POSITIVE_INFINITY;
  return [...results].sort((a, b) => {
    const left = rank.get(a.nodeId);
    const right = rank.get(b.nodeId);
    if (left !== undefined && right !== undefined) return left - right;
    if (left !== undefined) return -1;
    if (right !== undefined) return 1;
    return started(a) - started(b) || 0;
  });
}

/** A step that did not run: skipped by the engine, or still pending in a run that already ended. */
export function stepDidNotRun(step: NodeExecutionResult, runTerminal: boolean): boolean {
  return step.skipped === true || (runTerminal && step.status === 'PENDING');
}

/** `details.field` of a stored node/run error (JSON text), or null. */
export function errorField(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const details = parsed && typeof parsed === 'object' ? (parsed as { details?: unknown }).details : null;
    const field = details && typeof details === 'object' ? (details as { field?: unknown }).field : null;
    return typeof field === 'string' && field ? field : null;
  } catch {
    return null;
  }
}

/** Localised explanation of a stored node error (JSON text) by its `code`; null when there is no code. The raw message stays in the details view. */
export function friendlyErrorMessage(raw: string | undefined, t: (key: string) => string): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { code, message } = parsed as { code?: unknown; message?: unknown };
    if (typeof code !== 'string') return null;
    // The engine words a missing reference as "... refers to a value that is missing."
    const name = code === 'MAPPING_ERROR' && typeof message === 'string' && message.includes('is missing') ? 'MAPPING_MISSING' : code;
    const key = `runs.err.${name}`;
    const text = t(key);
    return text === key ? null : text;
  } catch {
    return null;
  }
}
