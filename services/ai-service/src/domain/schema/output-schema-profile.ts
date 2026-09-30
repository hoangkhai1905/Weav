import Ajv2020 from 'ajv/dist/2020';
import { isPlainObject } from '../errors';

const ALLOWED = new Set(['type', 'properties', 'required', 'items', 'enum', 'description', 'additionalProperties']);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const FORBIDDEN_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
export const SCHEMA_LIMITS = { maxBytes: 32 * 1024, maxNodes: 256, maxDepth: 8 } as const;

const isType = (v: unknown) => typeof v === 'string' && TYPES.has(v);
const isScalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Spec §3 profile. Keep in lockstep with Workflow OutputSchemaPolicy.java; both run the shared fixture. */
export function checkOutputSchema(schema: unknown): boolean {
  if (!isPlainObject(schema) || schema.type !== 'object') return false;
  if (Buffer.byteLength(JSON.stringify(schema), 'utf8') > SCHEMA_LIMITS.maxBytes) return false;
  let nodes = 0;
  const stack: Array<[unknown, number]> = [[schema, 1]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    if (!isPlainObject(node) || !('type' in node)) return false;
    if (++nodes > SCHEMA_LIMITS.maxNodes || depth > SCHEMA_LIMITS.maxDepth) return false;
    for (const [keyword, value] of Object.entries(node)) {
      if (!ALLOWED.has(keyword)) return false;
      switch (keyword) {
        case 'type':
          if (!(isType(value) || (Array.isArray(value) && value.length > 0 && value.every(isType)))) return false;
          break;
        case 'description':
          if (typeof value !== 'string' || value.length > 1000) return false;
          break;
        case 'additionalProperties':
          if (typeof value !== 'boolean') return false;
          break;
        case 'required':
          if (!Array.isArray(value) || !value.every((n) => typeof n === 'string') || new Set(value).size !== value.length) return false;
          break;
        case 'enum':
          if (!Array.isArray(value) || value.length === 0 || value.length > 100 || !value.every(isScalar)) return false;
          break;
        case 'items':
          stack.push([value, depth + 1]);
          break;
        case 'properties':
          if (!isPlainObject(value)) return false;
          for (const [name, child] of Object.entries(value)) {
            if (name.length === 0 || name.length > 64 || FORBIDDEN_NAMES.has(name)) return false;
            stack.push([child, depth + 1]);
          }
          break;
      }
    }
  }
  return true;
}

/** Validates a model result and removes undeclared properties in place. A fresh Ajv per call keeps Ajv's schema cache from growing per request. */
export function matchesOutputSchema(schema: object, value: unknown): boolean {
  const ajv = new Ajv2020({ strict: true, allErrors: false, removeAdditional: 'all', useDefaults: false, coerceTypes: false });
  return ajv.compile(schema)(value) === true;
}
