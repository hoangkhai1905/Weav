import { AiError } from '../errors';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const decoder = new TextDecoder('utf-8', { fatal: true });

/** JSON.parse plus fatal UTF-8, prototype-key rejection, finite numbers, bounded depth. Duplicate keys are not detected (spec §4). */
export function parseStrictJson(bytes: Uint8Array, maxDepth: number): unknown {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes), (key, v: unknown) => {
      if (FORBIDDEN_KEYS.has(key) || (typeof v === 'number' && !Number.isFinite(v))) {
        throw new AiError('INVALID_REQUEST');
      }
      return v;
    });
  } catch {
    throw new AiError('INVALID_REQUEST');
  }
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    if (typeof node !== 'object' || node === null) continue;
    if (depth > maxDepth) throw new AiError('INVALID_REQUEST');
    for (const child of Object.values(node)) stack.push([child, depth + 1]);
  }
  return value;
}
