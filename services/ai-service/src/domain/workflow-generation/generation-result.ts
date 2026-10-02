import { z } from 'zod';

export interface Capability {
  type: string;
  configFields: string[];
}

const nodeId = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const codePoints = (max: number) =>
  z
    .string()
    .min(1)
    .refine((s) => [...s].length <= max);

const MAX_NODE_CONFIG_BYTES = 16 * 1024;
const MAX_GRAPH_BYTES = 256 * 1024;
const bytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/** True for hosts a generated workflow must not point at (loopback, private, link-local, internal names). */
function isInternalHost(rawHost: string): boolean {
  const host = rawHost
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (host === 'localhost' || /\.(localhost|internal|local)$/.test(host))
    return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (host.includes(':')) {
    return (
      host === '::' ||
      host === '::1' ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) ||
      host.startsWith('::ffff:')
    );
  }
  return false;
}

function urlProblem(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !['http:', 'https:'].includes(url.protocol) ||
      isInternalHost(url.hostname)
    );
  } catch {
    return !value.includes('{{'); // unparsable and not a template -> reject
  }
}

/** Walks a node config; a string is screened when it looks like a URL or sits under a *url key. */
function hasBadUrl(value: unknown, key = ''): boolean {
  if (typeof value === 'string') {
    return (
      (SCHEME_URL.test(value) || /url$/i.test(key)) &&
      value !== '' &&
      urlProblem(value)
    );
  }
  if (Array.isArray(value)) return value.some((v) => hasBadUrl(v, key));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => hasBadUrl(v, k));
  }
  return false;
}

interface IntentGraph {
  nodes: { id: string; type: string; config: Record<string, unknown> }[];
  edges: { from: string; to: string }[];
}

/** AI-3: structural + safety rules the field-level schema cannot express. */
function checkGraph(intent: IntentGraph, ctx: z.RefinementCtx): void {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const ids = new Set(intent.nodes.map((n) => n.id));
  const outgoing = new Map<string, string[]>(
    intent.nodes.map((n) => [n.id, []]),
  );
  const indegree = new Map<string, number>(intent.nodes.map((n) => [n.id, 0]));
  for (const e of intent.edges) {
    if (!ids.has(e.from) || !ids.has(e.to))
      return fail('edge references an unknown node');
    outgoing.get(e.from)!.push(e.to);
    indegree.set(e.to, indegree.get(e.to)! + 1);
  }
  if (intent.nodes.filter((n) => n.type === 'trigger.manual').length !== 1)
    return fail('exactly one manual trigger is required');
  const queue = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.pop()!;
    visited++;
    for (const next of outgoing.get(id)!) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (visited !== intent.nodes.length) return fail('graph must be acyclic');
  if (intent.nodes.some((n) => bytes(n.config) > MAX_NODE_CONFIG_BYTES))
    return fail('node config too large');
  if (bytes(intent) > MAX_GRAPH_BYTES) return fail('graph too large');
  if (intent.nodes.some((n) => hasBadUrl(n.config)))
    return fail('url must be public http(s)');
}

export function generationResultSchema(capabilities: Capability[]) {
  const fields = new Map(
    capabilities.map((c) => [c.type, new Set(c.configFields)]),
  );
  const node = z
    .object({
      id: nodeId,
      type: z.string(),
      config: z.record(z.string(), z.unknown()),
    })
    .refine(
      (n) =>
        fields.has(n.type) &&
        Object.keys(n.config).every((k) => fields.get(n.type)!.has(k)),
    );
  const intent = z
    .object({
      name: codePoints(120),
      nodes: z
        .array(node)
        .min(2)
        .max(20)
        .refine((ns) => new Set(ns.map((n) => n.id)).size === ns.length),
      edges: z
        .array(
          z.object({
            from: nodeId,
            to: nodeId,
            port: z.enum(['true', 'false']).optional(),
          }),
        )
        .min(1)
        .max(40),
    })
    .superRefine(checkGraph);
  return z.discriminatedUnion('status', [
    z.object({ status: z.literal('ready'), intent }),
    z.object({
      status: z.literal('needs_input'),
      questions: z
        .array(
          z.object({
            code: z.enum(['URL', 'SCHEDULE', 'TIMEZONE', 'VALUE']),
            field: z.string().min(1).max(200),
          }),
        )
        .min(1)
        .max(10),
    }),
    z.object({
      status: z.literal('unsupported'),
      reasons: z
        .array(
          z.object({
            code: z.enum([
              'CAPABILITY_UNAVAILABLE',
              'OUT_OF_SCOPE',
              'AMBIGUOUS_REQUEST',
            ]),
          }),
        )
        .min(1)
        .max(5),
    }),
  ]);
}

export type GenerationResult = z.infer<
  ReturnType<typeof generationResultSchema>
>;
