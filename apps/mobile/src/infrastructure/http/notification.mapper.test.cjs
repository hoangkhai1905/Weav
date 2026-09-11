const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapNotificationPage } = require('./notification.mapper.ts');

test('maps service inbox envelope to the existing mobile domain contract', () => {
  const metadata = {
    userId: 'user-1',
    provider: 'TELEGRAM',
    status: 'SENT',
    readAt: null,
    updatedAt: '2026-09-09T11:00:00Z',
    scheduledAt: null,
    sentAt: '2026-09-09T10:00:01Z',
  };
  const result = mapNotificationPage({
    items: [
      {
        ...metadata,
        id: '1',
        eventType: 'workflow.completed',
        title: 'Completed',
        message: 'Done',
        read: false,
        createdAt: '2026-09-09T10:00:00Z',
        executionId: 'execution-1',
      },
      {
        ...metadata,
        id: '2',
        eventType: 'workflow.failed',
        title: 'Failed',
        message: 'Open execution',
        read: true,
        readAt: '2026-09-09T11:01:00Z',
        createdAt: '2026-09-09T11:00:00Z',
        executionId: null,
      },
    ],
    nextCursor: null,
  });
  assert.deepEqual(result, [
    {
      ...metadata,
      id: '1',
      type: 'WORKFLOW_COMPLETED',
      title: 'Completed',
      message: 'Done',
      read: false,
      timestamp: '2026-09-09T10:00:00Z',
      createdAt: '2026-09-09T10:00:00Z',
      eventType: 'workflow.completed',
      executionId: 'execution-1',
      link: '/(app)/executions/execution-1',
    },
    {
      ...metadata,
      id: '2',
      type: 'WORKFLOW_FAILED',
      title: 'Failed',
      message: 'Open execution',
      read: true,
      readAt: '2026-09-09T11:01:00Z',
      timestamp: '2026-09-09T11:00:00Z',
      createdAt: '2026-09-09T11:00:00Z',
      eventType: 'workflow.failed',
      executionId: null,
    },
  ]);
});
test('maps an empty inbox', () =>
  assert.deepEqual(mapNotificationPage({ items: [], nextCursor: null }), []));
