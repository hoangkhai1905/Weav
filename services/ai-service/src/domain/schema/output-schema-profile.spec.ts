import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkOutputSchema, matchesOutputSchema } from './output-schema-profile';

const fixture = JSON.parse(readFileSync(
  join(__dirname, '../../../../../packages/contracts/http/ai/fixtures/output-schema-profile.json'), 'utf8',
)) as { cases: Array<{ name: string; valid: boolean; schema: unknown }> };

const nested = (depth: number): Record<string, unknown> =>
  depth === 1 ? { type: 'object', properties: {} } : { type: 'object', properties: { c: nested(depth - 1) } };

describe('checkOutputSchema', () => {
  it.each(fixture.cases)('$name → $valid', ({ schema, valid }) => {
    expect(checkOutputSchema(schema)).toBe(valid);
  });
  it('enforces depth 8', () => {
    expect(checkOutputSchema(nested(8))).toBe(true);
    expect(checkOutputSchema(nested(9))).toBe(false);
  });
  it('enforces 256 schema objects', () => {
    const properties = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`p${i}`, { type: 'string' }]));
    expect(checkOutputSchema({ type: 'object', properties })).toBe(false); // root + 256 = 257
  });
  it('enforces 32 KiB', () => {
    expect(checkOutputSchema({ type: 'object', description: 'x'.repeat(33 * 1024), properties: {} })).toBe(false);
  });
});

describe('matchesOutputSchema', () => {
  const schema = { type: 'object', properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['name'] };
  it('accepts a valid value and removes undeclared properties', () => {
    const value = { name: 'An', tags: ['a'], injected: true };
    expect(matchesOutputSchema(schema, value)).toBe(true);
    expect(value).toEqual({ name: 'An', tags: ['a'] });
  });
  it('rejects a missing required field and a wrong type', () => {
    expect(matchesOutputSchema(schema, { tags: [] })).toBe(false);
    expect(matchesOutputSchema(schema, { name: 3 })).toBe(false);
  });
});
