const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildNotificationListRequest,
  buildNotificationUnreadCountRequest,
  buildNotificationReadRequest,
  buildNotificationReadAllRequest,
} = require('./notification.http.contract.ts');

const NOTIFICATION_ID = '00000000-0000-4000-8000-000000000010';

test('builds only the v2 inbox allowlist and defaults the requested locale', () => {
  const signal = new AbortController().signal;
  assert.deepEqual(
    buildNotificationListRequest({
      limit: 5,
      cursor: 'opaque-cursor_2',
      unreadOnly: true,
      category: 'WORKSPACE',
    }, signal),
    {
      url: '/api/v2/notifications',
      params: {
        limit: 5,
        cursor: 'opaque-cursor_2',
        unreadOnly: true,
        category: 'WORKSPACE',
        locale: 'vi',
      },
      signal,
    },
  );
});

test('supports explicit locale and rejects invalid or legacy query fields', () => {
  assert.deepEqual(
    buildNotificationListRequest({ locale: 'en', category: 'SECURITY' }),
    {
      url: '/api/v2/notifications',
      params: { limit: 20, unreadOnly: false, category: 'SECURITY', locale: 'en' },
    },
  );
  assert.throws(() => buildNotificationListRequest({ status: 'SENT' }), /query/i);
  assert.throws(() => buildNotificationListRequest({ eventType: 'workflow.completed' }), /query/i);
  assert.throws(() => buildNotificationListRequest({ limit: 101 }), /query/i);
  assert.throws(() => buildNotificationListRequest({ cursor: 'x'.repeat(513) }), /query/i);
});

test('uses v2 unread/read routes, validates UUIDs, and localizes explicit read', () => {
  const signal = new AbortController().signal;
  assert.deepEqual(buildNotificationUnreadCountRequest(signal), {
    url: '/api/v2/notifications/unread-count',
    signal,
  });
  assert.deepEqual(buildNotificationReadRequest(NOTIFICATION_ID, 'en'), {
    method: 'PATCH',
    url: `/api/v2/notifications/${NOTIFICATION_ID}/read`,
    params: { locale: 'en' },
  });
  assert.deepEqual(buildNotificationReadAllRequest(), {
    method: 'POST',
    url: '/api/v2/notifications/read-all',
  });
  assert.throws(() => buildNotificationReadRequest('not-an-id', 'vi'), /id/i);
});
