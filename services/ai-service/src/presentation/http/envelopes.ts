import { z } from 'zod';

const codePoints = (max: number) =>
  z
    .string()
    .min(1)
    .refine((s) => [...s].length <= max);
// Per-request provider selection (BYOK). Strict: nothing like a base URL can ride along.
const llm = z
  .strictObject({
    provider: z.enum(['OPENAI', 'ANTHROPIC', 'GEMINI']),
    apiKey: z
      .string()
      .min(1)
      .max(512)
      .refine((k) => [...k].every((c) => c > '\x1f' && c !== '\x7f')),
    model: z
      .string()
      .regex(/^[A-Za-z0-9._:/-]{1,100}$/)
      .optional(),
  })
  .optional();
const base = { requestId: z.uuid(), workspaceId: z.uuid() };

export const ENVELOPES = {
  extract: z.strictObject({
    ...base,
    operation: z.literal('extract'),
    llm,
    text: codePoints(50_000),
    outputSchema: z.record(z.string(), z.unknown()),
    instructions: codePoints(2_000).optional(),
  }),
  classify: z.strictObject({
    ...base,
    operation: z.literal('classify'),
    llm,
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
    llm,
    text: codePoints(50_000),
    maxLength: z.number().int().min(1).max(5_000),
  }),
  prompt: z.strictObject({
    ...base,
    operation: z.literal('prompt'),
    llm,
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
