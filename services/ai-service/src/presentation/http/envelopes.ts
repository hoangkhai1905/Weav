import { z } from 'zod';

const codePoints = (max: number) =>
  z
    .string()
    .min(1)
    .refine((s) => [...s].length <= max);
const base = { requestId: z.uuid(), workspaceId: z.uuid() };

export const ENVELOPES = {
  extract: z.strictObject({
    ...base,
    operation: z.literal('extract'),
    text: codePoints(50_000),
    outputSchema: z.record(z.string(), z.unknown()),
    instructions: codePoints(2_000).optional(),
  }),
  classify: z.strictObject({
    ...base,
    operation: z.literal('classify'),
    text: codePoints(50_000),
    categories: z
      .array(codePoints(100))
      .min(2)
      .max(50)
      .refine((c) => new Set(c).size === c.length),
  }),
  summarize: z.strictObject({
    ...base,
    operation: z.literal('summarize'),
    text: codePoints(50_000),
    maxLength: z.number().int().min(1).max(5_000),
  }),
  prompt: z.strictObject({
    ...base,
    operation: z.literal('prompt'),
    prompt: codePoints(50_000).refine((s) => s.trim() !== ''),
    instructions: codePoints(2_000).optional(),
    maxLength: z.number().int().min(1).max(5_000).default(1_000),
  }),
  generate: z.strictObject({
    ...base,
    operation: z.literal('generate'),
    prompt: codePoints(4_000),
    timezone: z.string().min(1).max(64).optional(),
    capabilities: z
      .array(
        z.strictObject({
          type: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
          configFields: z.array(z.string().min(1).max(64)).max(32),
        }),
      )
      .min(1)
      .max(40),
  }),
} as const;

export type Operation = keyof typeof ENVELOPES;
export const isOperation = (v: string): v is Operation =>
  Object.hasOwn(ENVELOPES, v);
