import { z } from 'zod';

export interface Capability {
  type: string;
  configFields: string[];
}

const nodeId = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const codePoints = (max: number) => z.string().min(1).refine((s) => [...s].length <= max);

export function generationResultSchema(capabilities: Capability[]) {
  const fields = new Map(capabilities.map((c) => [c.type, new Set(c.configFields)]));
  const node = z.object({ id: nodeId, type: z.string(), config: z.record(z.string(), z.unknown()) })
    .refine((n) => fields.has(n.type) && Object.keys(n.config).every((k) => fields.get(n.type)!.has(k)));
  const intent = z.object({
    name: codePoints(120),
    nodes: z.array(node).min(2).max(20).refine((ns) => new Set(ns.map((n) => n.id)).size === ns.length),
    edges: z.array(z.object({ from: nodeId, to: nodeId, port: z.enum(['true', 'false']).optional() })).min(1).max(40),
  });
  return z.discriminatedUnion('status', [
    z.object({ status: z.literal('ready'), intent }),
    z.object({
      status: z.literal('needs_input'),
      questions: z.array(z.object({ code: z.enum(['URL', 'SCHEDULE', 'TIMEZONE', 'VALUE']), field: z.string().min(1).max(200) })).min(1).max(10),
    }),
    z.object({
      status: z.literal('unsupported'),
      reasons: z.array(z.object({ code: z.enum(['CAPABILITY_UNAVAILABLE', 'OUT_OF_SCOPE', 'AMBIGUOUS_REQUEST']) })).min(1).max(5),
    }),
  ]);
}

export type GenerationResult = z.infer<ReturnType<typeof generationResultSchema>>;
