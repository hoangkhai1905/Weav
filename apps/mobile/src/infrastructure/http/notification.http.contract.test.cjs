const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildNotificationListRequest,
  buildNotificationUnreadCountRequest,
  buildNotificationReadRequest,
  buildNotificationReadAllRequest,
} = require('./notification.http.contract.ts');

test('builds the Gateway list request with cursor pagination and filters', () => {
  const signal = new AbortController().signal;
  assert.deepEqual(
    buildNotificationListRequest(
      { limit: 5, cursor: 'cursor-2', unreadOnly: true },
      signal,
    ),
    {
      url: '/api/notifications',
      params: { limit: 5, cursor: 'cursor-2', unreadOnly: true },
      signal,
    },
  );
});

test('builds unread, read-one and read-all requests on the existing routes', () => {
  const signal = new AbortController().signal;
  assert.deepEqual(
    buildNotificationUnreadCountRequest(signal),
    { url: '/api/notifications/unread-count', signal },
  );
  assert.deepEqual(buildNotificationReadRequest('id/with-slash'), {
    method: 'PATCH',
    url: '/api/notifications/id%2Fwith-slash/read',
  });
  assert.deepEqual(buildNotificationReadAllRequest(), {
    method: 'POST',
    url: '/api/notifications/read-all',
  });
});
