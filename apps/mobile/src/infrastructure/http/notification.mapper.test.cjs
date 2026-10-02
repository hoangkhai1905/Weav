const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapNotificationPage } = require('./notification.mapper.ts');

const ids = {
  notification: '00000000-0000-4000-8000-000000000010',
  workspace: '00000000-0000-4000-8000-000000000020',
  workflow: '00000000-0000-4000-8000-000000000030',
  execution: '00000000-0000-4000-8000-000000000040',
};

function inboxItem(overrides = {}) {
  return {
    id: ids.notification,
    eventType: 'workflow.completed',
    category: 'WORKFLOW',
    severity: 'SUCCESS',
    title: 'Workflow run completed',
    message: 'The run completed successfully.',
    target: {
      kind: 'EXECUTION',
      workspaceId: ids.workspace,
      executionId: ids.execution,
    },
    workspaceId: ids.workspace,
    executionId: ids.execution,
    occurredAt: '2026-09-27T04:00:00.000Z',
    createdAt: '2026-09-27T04:01:00.000Z',
    readAt: null,
    ...overrides,
  };
}

test('maps the exact v2 inbox item without importing delivery or URL fields', () => {
  assert.deepEqual(
    mapNotificationPage({ items: [inboxItem()], nextCursor: 'opaque-cursor' }),
    {
      items: [
        {
          ...inboxItem(),
          target: {
            kind: 'EXECUTION',
            workspaceId: ids.workspace,
            executionId: ids.execution,
          },
        },
      ],
      nextCursor: 'opaque-cursor',
    },
  );
});

test('degrades unknown category/severity and malformed or mismatched targets safely', () => {
  const result = mapNotificationPage({
    items: [
      inboxItem({ category: 'FUTURE', severity: 'NOTICE', target: { kind: 'FUTURE' } }),
      inboxItem({
        eventType: 'workspace.member_removed',
        category: 'WORKSPACE',
        target: { kind: 'WORKSPACE', workspaceId: ids.workspace },
        executionId: null,
      }),
      inboxItem({
        target: { kind: 'EXECUTION', workspaceId: ids.workspace, executionId: ids.workflow },
      }),
    ],
    nextCursor: null,
  });
  assert.equal(result.items[0].category, 'UNKNOWN');
  assert.equal(result.items[0].severity, 'UNKNOWN');
  assert.deepEqual(result.items.map((item) => item.target), [
    { kind: 'NONE' },
    { kind: 'NONE' },
    { kind: 'NONE' },
  ]);
});

test('rejects malformed item identifiers and timestamps instead of rendering them', () => {
  assert.throws(
    () => mapNotificationPage({ items: [inboxItem({ id: 'not-a-uuid' })], nextCursor: null }),
    /notification response/i,
  );
  assert.throws(
    () => mapNotificationPage({ items: [inboxItem({ createdAt: 'yesterday' })], nextCursor: null }),
    /notification response/i,
  );
});

test('maps an empty v2 inbox page', () => {
  assert.deepEqual(mapNotificationPage({ items: [], nextCursor: null }), {
    items: [],
    nextCursor: null,
  });
});
