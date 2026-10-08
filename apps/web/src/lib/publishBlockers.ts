import type { Edge, Node } from '@xyflow/react';
import { isValidPath } from './mappingGrammar';

// Client-side mirror of the publish rules in workflow-service DefinitionValidator (graph, mappings, ordering
// operands, required AI fields, absolute URL). Only rules the validator really has are checked here.

type Translate = (key: string) => string;
const withId = (t: Translate, key: string, id: string) => t(key).replace('{id}', id);
const isTrigger = (node: Node) => String(node.data?.nodeType ?? '').startsWith('trigger.');
const hasDelimiter = (value: string) => value.includes('{{') || value.includes('}}');
const configOf = (node: Node) => (node.data?.config ?? {}) as Record<string, unknown>;

type Expression = { node: string } | { ok: true } | { ok: false };

/** The `{{ ... }}` expressions of a text, or null when the braces are unbalanced (MappingResolver.expressions). */
function expressionsOf(text: string): string[] | null {
  const found: string[] = [];
  let cursor = 0;
  for (;;) {
    const start = text.indexOf('{{', cursor);
    const strayClose = text.indexOf('}}', cursor);
    if (strayClose >= 0 && (start < 0 || strayClose < start)) return null;
    if (start < 0) return found;
    const end = text.indexOf('}}', start + 2);
    const nested = text.indexOf('{{', start + 2);
    if (end < 0 || (nested >= 0 && nested < end)) return null;
    found.push(text.slice(start + 2, end).trim());
    cursor = end + 2;
  }
}

function parseExpression(expression: string, ids: string[]): Expression {
  if (expression === 'trigger.input' || expression === 'variables') return { ok: true };
  if (expression.startsWith('trigger.input.')) return { ok: isValidPath(expression.slice('trigger.input.'.length)) };
  if (expression.startsWith('variables.')) return { ok: isValidPath(expression.slice('variables.'.length)) };
  if (!expression.startsWith('nodes.')) return { ok: false };
  const rest = expression.slice('nodes.'.length);
  for (const id of ids) {
    if (rest === `${id}.output`) return { node: id };
    if (rest.startsWith(`${id}.output.`)) return isValidPath(rest.slice(id.length + '.output.'.length)) ? { node: id } : { ok: false };
  }
  // Unknown step: the server reports "The referenced node does not exist".
  return { ok: false };
}

function collectStrings(value: unknown, out: string[]) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, out));
}

/** Steps (ids) from which `target` can be reached: the only ones a mapping may read. */
function ancestorsOf(target: string, edges: Edge[]): Set<string> {
  const seen = new Set<string>();
  const queue = [target];
  while (queue.length) {
    const current = queue.shift() as string;
    edges.filter((edge) => edge.target === current).forEach((edge) => {
      if (!seen.has(edge.source)) { seen.add(edge.source); queue.push(edge.source); }
    });
  }
  return seen;
}

const ORDERING = new Set(['gt', 'gte', 'lt', 'lte']);
const orderingOperandBad = (value: unknown) => !(typeof value === 'number' || (typeof value === 'string' && hasDelimiter(value)));

/** Conditions of a logic.condition in either form, for the ordering-operand rule. */
function conditionItems(config: Record<string, unknown>): Array<{ operator?: unknown; left?: unknown; right?: unknown }> {
  if (Array.isArray(config.conditions)) return config.conditions as Array<{ operator?: unknown; left?: unknown; right?: unknown }>;
  return [{ operator: config.operator, left: config.left, right: config.right }];
}

/** Rules of DefinitionValidator.validatePublishGraph, validateMappings and validatePublishFieldValues. */
export function definitionBlockers(nodes: Node[], edges: Edge[], t: Translate): string[] {
  const blockers = new Set<string>();
  const ids = nodes.map((node) => node.id).sort((a, b) => b.length - a.length);
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // D1: any trigger starts a workflow; a manual trigger is not required, but there can be only one.
  if (!nodes.some(isTrigger)) blockers.add(t('builder.blocker.no_trigger'));
  if (nodes.filter((node) => node.data?.nodeType === 'trigger.manual').length > 1) blockers.add(t('builder.blocker.multiple_manual'));

  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    if (isTrigger(target)) blockers.add(withId(t, 'builder.blocker.trigger_incoming', target.id));
    const type = String(source.data?.nodeType ?? '');
    const port = edge.sourceHandle || null; // '' counts as no port
    if (type === 'logic.switch') {
      const cases = Array.isArray(configOf(source).cases) ? (configOf(source).cases as unknown[]) : [];
      if (port === null || (port !== 'default' && !cases.includes(port))) blockers.add(withId(t, 'builder.blocker.port_switch', source.id));
    } else if (type === 'logic.condition') {
      if (port !== 'true' && port !== 'false') blockers.add(withId(t, 'builder.blocker.port_condition', source.id));
    } else if (port !== null) {
      blockers.add(withId(t, 'builder.blocker.port_plain', source.id));
    }
  }

  // Cycle: Kahn's algorithm over the edges between known steps.
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  edges.forEach((edge) => { if (indegree.has(edge.source) && indegree.has(edge.target)) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1); });
  const ready = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length) {
    const current = ready.shift() as string;
    visited += 1;
    edges.filter((edge) => edge.source === current && indegree.has(edge.target)).forEach((edge) => {
      const left = (indegree.get(edge.target) ?? 1) - 1;
      indegree.set(edge.target, left);
      if (left === 0) ready.push(edge.target);
    });
  }
  if (visited < nodes.length) blockers.add(t('builder.blocker.cycle'));

  for (const node of nodes) {
    const type = String(node.data?.nodeType ?? '');
    const config = configOf(node);

    // Mappings: well-formed, and only to steps that run before this one.
    const strings: string[] = [];
    Object.entries(config).forEach(([field, value]) => { if (!(type === 'ai.extract' && field === 'outputSchema')) collectStrings(value, strings); });
    const ancestors = ancestorsOf(node.id, edges);
    for (const text of strings) {
      if (!hasDelimiter(text)) continue;
      const expressions = expressionsOf(text);
      if (!expressions) { blockers.add(withId(t, 'builder.blocker.mapping', node.id)); continue; }
      for (const expression of expressions) {
        const parsed = parseExpression(expression, ids);
        if ('node' in parsed) {
          if (parsed.node === node.id || !ancestors.has(parsed.node)) blockers.add(withId(t, 'builder.blocker.mapping_upstream', node.id));
        } else if (!parsed.ok) {
          blockers.add(withId(t, 'builder.blocker.mapping', node.id));
        }
      }
    }

    if (type === 'logic.condition') {
      const bad = conditionItems(config).some((item) => typeof item.operator === 'string' && ORDERING.has(item.operator)
        && (orderingOperandBad(item.left) || orderingOperandBad(item.right)));
      if (bad) blockers.add(withId(t, 'builder.blocker.numeric', node.id));
    }
    // Required text of the AI steps (schema `required` + non-empty).
    const required: Record<string, string> = { 'ai.extract': 'text', 'ai.classify': 'content', 'ai.summarize': 'inputText' };
    if (required[type] && !String(config[required[type]] ?? '').trim()) blockers.add(withId(t, `builder.blocker.${type.replace('.', '_')}`, node.id));
    if (type === 'http.request' && typeof config.url === 'string' && config.url.trim() && !hasDelimiter(config.url)) {
      // Lenient on purpose: the server uses Java URI, which accepts things `new URL` rejects (a port above 65535).
      if (!/^https?:\/\/[^/?#\s:@]+/i.test(config.url.trim())) blockers.add(withId(t, 'builder.blocker.http_url', node.id));
    }
  }
  return [...blockers];
}
