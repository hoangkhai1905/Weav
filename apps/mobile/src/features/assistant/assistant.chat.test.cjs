const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { applyAssistantEvent, EMPTY_REPLY, parseInline, parseMessage } = require('./assistant.chat.ts');

test('stream events build the reply in order', () => {
  const events = [
    { type: 'conversation', conversationId: 'c1' },
    { type: 'tool_call', name: 'list_failed', arguments: {} },
    { type: 'tool_result', name: 'list_failed', ok: true },
    { type: 'delta', text: 'Co ' },
    { type: 'delta', text: '2 loi.' },
    { type: 'done' },
  ];
  let s = EMPTY_REPLY;
  const seenTools = [];
  for (const e of events) {
    s = applyAssistantEvent(s, e);
    seenTools.push(s.tool);
  }
  assert.deepEqual(seenTools, [null, 'list_failed', null, null, null, null]);
  assert.equal(s.conversationId, 'c1');
  assert.equal(s.text, 'Co 2 loi.');
  assert.equal(s.done, true);
  assert.equal(s.error, null);
});

test('an error event keeps the text so far and records the code', () => {
  let s = applyAssistantEvent(EMPTY_REPLY, { type: 'delta', text: 'abc' });
  s = applyAssistantEvent(s, { type: 'error', code: 'AI_UNAVAILABLE', message: 'x' });
  assert.equal(s.text, 'abc');
  assert.deepEqual(s.error, { code: 'AI_UNAVAILABLE', message: 'x' });
  assert.equal(s.done, false);
});

test('inline formatting: bold and code only, unmatched markers stay literal', () => {
  assert.deepEqual(parseInline('a **b** c `d` e'), [
    { text: 'a ' },
    { text: 'b', bold: true },
    { text: ' c ' },
    { text: 'd', code: true },
    { text: ' e' },
  ]);
  assert.deepEqual(parseInline('2 ** 3 and `open'), [{ text: '2 ** 3 and `open' }]);
  assert.deepEqual(parseInline(''), []);
});

test('lines: bullets, numbers, headings stripped, blank lines dropped', () => {
  const lines = parseMessage('# Ket qua\n\n- **A** loi\n* B\n1. Buoc mot\nxong');
  assert.deepEqual(lines.map((l) => l.marker), [null, '•', '•', '1.', null]);
  assert.deepEqual(lines[0].segments, [{ text: 'Ket qua' }]);
  assert.deepEqual(lines[1].segments, [{ text: 'A', bold: true }, { text: ' loi' }]);
});
