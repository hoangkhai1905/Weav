const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { createSseParser } = require('./assistant.sse.ts');
const {
  mapAssistantFrame,
  mapConversationList,
  mapConversationDetail,
} = require('./assistant.mapper.ts');

const SSE =
  'event: conversation\ndata: {"conversationId":"c1"}\n\n' +
  'event: delta\ndata: {"text":"Hel"}\n\n' +
  'event: delta\r\ndata: {"text":"lo"}\r\n\r\n' +
  ': keepalive\n\n' +
  'event: tool_call\ndata: {"name":"list_workflows","arguments":{"a":1}}\n\n' +
  'event: tool_result\ndata: {"name":"list_workflows","ok":true}\n\n' +
  'event: done\ndata: {}\n\n';

function parseAll(chunks) {
  const events = [];
  const parser = createSseParser((frame) => {
    const event = mapAssistantFrame(frame);
    if (event) events.push(event);
  });
  for (const chunk of chunks) parser.push(chunk);
  parser.flush();
  return events;
}

test('parses the whole body at once (fallback path)', () => {
  const events = parseAll([SSE]);
  assert.deepEqual(
    events.map((e) => e.type),
    ['conversation', 'delta', 'delta', 'tool_call', 'tool_result', 'done'],
  );
  assert.equal(events[0].conversationId, 'c1');
  assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Hello');
});

test('streaming in arbitrary chunks (even splitting CRLF) gives the same events', () => {
  const whole = parseAll([SSE]);
  for (const size of [1, 3, 7, 50]) {
    const chunks = [];
    for (let i = 0; i < SSE.length; i += size) chunks.push(SSE.slice(i, i + size));
    assert.deepEqual(parseAll(chunks), whole, `chunk size ${size}`);
  }
});

test('maps draft, error and ignores unknown events; bad JSON becomes an error event', () => {
  const draft = mapAssistantFrame({
    event: 'draft',
    data: JSON.stringify({
      name: 'Flow',
      definition: {
        schemaVersion: '1.0',
        nodes: [{ id: 'n1', type: 'trigger.manual', config: {} }],
        edges: [],
      },
      layout: { n1: { x: 1, y: 2 } },
    }),
  });
  assert.equal(draft.type, 'draft');
  assert.deepEqual(draft.draft.layout, { n1: { x: 1, y: 2 } });
  assert.deepEqual(
    mapAssistantFrame({ event: 'error', data: '{"code":"AI_BUSY","message":"busy"}' }),
    { type: 'error', code: 'AI_BUSY', message: 'busy' },
  );
  assert.equal(mapAssistantFrame({ event: 'ping', data: '{}' }), null);
  assert.equal(mapAssistantFrame({ event: 'delta', data: '{oops' }).code, 'INVALID_STREAM');
});

test('maps conversation list and message history', () => {
  const list = mapConversationList({
    items: [{ conversationId: 'c1', title: 'T', createdAt: 'a', updatedAt: 'b' }],
  });
  assert.equal(list[0].title, 'T');
  const detail = mapConversationDetail({
    conversationId: 'c1',
    workspaceId: 'w1',
    title: 'T',
    messages: [
      { role: 'user', content: 'hi', createdAt: 'a' },
      { role: 'assistant', content: 'yo', createdAt: 'b' },
    ],
  });
  assert.deepEqual(detail.messages.map((m) => m.role), ['user', 'assistant']);
  assert.throws(
    () =>
      mapConversationDetail({
        conversationId: 'c',
        workspaceId: 'w',
        title: 'T',
        messages: [{ role: 'system', content: '', createdAt: 'a' }],
      }),
    /role/,
  );
});
