import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '../src/lib/templates/index.js';

// Client-side mirror of the parts of DefinitionValidator that matter for a draft: known node types, no unknown
// config fields, literal types and enums from the node JSON schemas, edge rules and the mapping grammar.

interface SchemaProperty { type?: string; enum?: unknown[]; oneOf?: SchemaProperty[] }
interface NodeSchema { properties: Record<string, SchemaProperty>; required: string[] }

const NODES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/workflow-schema/nodes');
const schemaOf = (type: string): NodeSchema => JSON.parse(readFileSync(resolve(NODES_DIR, `${type}.json`), 'utf8'));

// Required fields the user supplies after creating the draft (connections and personal targets).
const USER_FILLS = new Set(['connectionId', 'spreadsheetId', 'chatId', 'to']);
const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const SEGMENT = /^[A-Za-z0-9_$]+(\[\d{1,4}\])*$/;
const MAPPING = /\{\{([\s\S]*?)\}\}/g;

function jsonType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(property: SchemaProperty, value: unknown): boolean {
  if (property.oneOf) return property.oneOf.some((option) => matchesType(option, value));
  if (!property.type) return true;
  const actual = jsonType(value);
  return property.type === actual || (property.type === 'number' && actual === 'integer');
}

function* strings(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const item of value) yield* strings(item);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) yield* strings(item);
}

function ancestorsOf(template: WorkflowTemplate, nodeId: string): Set<string> {
  const found = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const current = queue.pop()!;
    for (const edge of template.edges) {
      if (edge.target === current && !found.has(edge.source)) {
        found.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  return found;
}

export function validateTemplate(template: WorkflowTemplate): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const node of template.nodes) {
    if (!ID_PATTERN.test(node.id)) problems.push(`${node.id}: id does not match ${ID_PATTERN}`);
    if (ids.has(node.id)) problems.push(`${node.id}: duplicate id`);
    ids.add(node.id);
    let schema: NodeSchema;
    try {
      schema = schemaOf(node.type);
    } catch {
      problems.push(`${node.id}: unknown node type ${node.type}`);
      continue;
    }
    for (const [key, value] of Object.entries(node.config)) {
      const property = schema.properties[key];
      if (!property) {
        problems.push(`${node.id}: unknown config field ${key}`);
        continue;
      }
      if (!matchesType(property, value)) problems.push(`${node.id}.${key}: wrong type ${jsonType(value)}`);
      if (property.enum && typeof value === 'string' && !property.enum.includes(value)) {
        problems.push(`${node.id}.${key}: ${value} not in enum`);
      }
    }
    for (const field of schema.required) {
      if (!(field in node.config) && !USER_FILLS.has(field)) problems.push(`${node.id}: required ${field} missing`);
    }
    for (const text of strings(node.config)) {
      const stripped = text.replace(MAPPING, '');
      if (stripped.includes('{{') || stripped.includes('}}')) problems.push(`${node.id}: unbalanced mapping in "${text}"`);
      for (const match of text.matchAll(MAPPING)) {
        const expression = match[1].trim();
        const trigger = expression === 'trigger.input' || expression.startsWith('trigger.input.');
        const reference = /^nodes\.([a-z][a-z0-9_]*)\.output(\..+)?$/.exec(expression);
        const path = trigger ? expression.slice('trigger.input.'.length) : reference?.[2]?.slice(1) ?? '';
        if (!trigger && !reference) {
          problems.push(`${node.id}: bad mapping "${expression}"`);
          continue;
        }
        if (path && expression !== 'trigger.input' && !path.split('.').every((segment) => SEGMENT.test(segment))) {
          problems.push(`${node.id}: bad mapping path "${expression}"`);
        }
        if (reference && (!ids.has(reference[1]) && !template.nodes.some((n) => n.id === reference[1]))) {
          problems.push(`${node.id}: mapping references missing node ${reference[1]}`);
        } else if (reference && !ancestorsOf(template, node.id).has(reference[1])) {
          problems.push(`${node.id}: mapping references non-upstream node ${reference[1]}`);
        }
      }
    }
  }

  const triggers = template.nodes.filter((node) => node.type.startsWith('trigger.'));
  if (triggers.length !== 1) problems.push(`expected exactly one trigger, found ${triggers.length}`);
  const edgeIds = new Set<string>();
  for (const edge of template.edges) {
    if (edgeIds.has(edge.id)) problems.push(`${edge.id}: duplicate edge id`);
    edgeIds.add(edge.id);
    const source = template.nodes.find((node) => node.id === edge.source);
    const target = template.nodes.find((node) => node.id === edge.target);
    if (!source || !target) {
      problems.push(`${edge.id}: dangling edge`);
      continue;
    }
    if (target.type.startsWith('trigger.')) problems.push(`${edge.id}: trigger has an incoming edge`);
    const isCondition = source.type === 'logic.condition';
    if (isCondition !== Boolean(edge.sourcePort)) problems.push(`${edge.id}: sourcePort only (and always) for condition nodes`);
  }
  for (const node of template.nodes) {
    if (!node.type.startsWith('trigger.') && !ancestorsOf(template, node.id).has(triggers[0]?.id)) {
      problems.push(`${node.id}: unreachable from the trigger`);
    }
  }
  // Cycle check: a node must never be its own ancestor.
  for (const node of template.nodes) {
    if (ancestorsOf(template, node.id).has(node.id)) problems.push(`${node.id}: cycle`);
  }
  return problems;
}

test.describe('workflow templates', () => {
  test('there are 6 to 12 templates with unique ids', () => {
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(WORKFLOW_TEMPLATES.length).toBeLessThanOrEqual(12);
    expect(new Set(WORKFLOW_TEMPLATES.map((template) => template.id)).size).toBe(WORKFLOW_TEMPLATES.length);
  });

  for (const template of WORKFLOW_TEMPLATES) {
    test(`template ${template.id} is valid`, () => {
      expect(validateTemplate(template)).toEqual([]);
    });
  }

  test('the validator rejects an unknown field and a bad mapping', () => {
    const broken: WorkflowTemplate = {
      ...WORKFLOW_TEMPLATES[0],
      nodes: [
        WORKFLOW_TEMPLATES[0].nodes[0],
        { id: 'send_reply', type: 'telegram.send_message', name: 'x', config: { text: '{{ nodes.nope.output.x }}', bogus: 1 } },
      ],
    };
    const problems = validateTemplate(broken);
    expect(problems.join('\n')).toContain('unknown config field bogus');
    expect(problems.join('\n')).toContain('missing node nope');
  });
});
