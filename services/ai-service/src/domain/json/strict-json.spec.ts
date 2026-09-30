import { parseStrictJson } from './strict-json';
import { AiError } from '../errors';

const bytes = (s: string) => Buffer.from(s, 'utf8');
const code = (fn: () => unknown) => {
  try { fn(); } catch (e) { return (e as AiError).code; }
  return 'NO_ERROR';
};

describe('parseStrictJson', () => {
  it('parses nested JSON and keeps Unicode', () => {
    expect(parseStrictJson(bytes('{"a":{"b":["Tiếng Việt 👍"]}}'), 64)).toEqual({ a: { b: ['Tiếng Việt 👍'] } });
  });
  it.each(['__proto__', 'constructor', 'prototype'])('rejects the %s key at any depth', (key) => {
    expect(code(() => parseStrictJson(bytes(`{"a":{"${key}":{}}}`), 64))).toBe('INVALID_REQUEST');
  });
  it('rejects invalid UTF-8', () => {
    expect(code(() => parseStrictJson(Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x7d]), 64))).toBe('INVALID_REQUEST');
  });
  it('rejects malformed JSON and non-finite numbers', () => {
    expect(code(() => parseStrictJson(bytes('{"a":'), 64))).toBe('INVALID_REQUEST');
    expect(code(() => parseStrictJson(bytes('{"a":1e400}'), 64))).toBe('INVALID_REQUEST');
  });
  it('rejects nesting deeper than the limit', () => {
    expect(code(() => parseStrictJson(bytes('['.repeat(65) + ']'.repeat(65)), 64))).toBe('INVALID_REQUEST');
    expect(parseStrictJson(bytes('['.repeat(64) + ']'.repeat(64)), 64)).toBeDefined();
  });
  it('treats a literal {{...}} and a field named token as plain data', () => {
    expect(parseStrictJson(bytes('{"token":"{{x}}"}'), 64)).toEqual({ token: '{{x}}' });
  });
});
