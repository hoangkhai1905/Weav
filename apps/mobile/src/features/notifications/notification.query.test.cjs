const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getNextNotificationCursor,
  notificationQueryKey,
  notificationListQueryKey,
  notificationUnreadCountQueryKey,
} = require('./notification.query.ts');

test('stops pagination for null or any previously returned opaque cursor', () => {
  assert.equal(
    getNextNotificationCursor({ items: [], nextCursor: 'cursor-3' }, [], undefined, []),
    'cursor-3',
  );
  assert.equal(
    getNextNotificationCursor(
      { items: [], nextCursor: 'cursor-1' },
      [],
      'cursor-2',
      [undefined, 'cursor-1', 'cursor-2'],
    ),
    undefined,
  );
  assert.equal(
    getNextNotificationCursor({ items: [], nextCursor: null }, [], 'cursor-2', [undefined, 'cursor-2']),
    undefined,
  );
});

test('keeps account at key index one and separates same-user auth sessions', () => {
  assert.deepEqual(notificationQueryKey('user-a', 3), ['notifications', 'user-a', 3]);
  assert.deepEqual(notificationQueryKey(null, 0), ['notifications', 'anonymous', 0]);
  assert.notDeepEqual(notificationQueryKey('user-a', 3), notificationQueryKey('user-a', 4));
  assert.notDeepEqual(notificationQueryKey('user-a', 3), notificationQueryKey('user-b', 3));
});

test('keys lists by locale and filters while keeping the unread count global', () => {
  const english = notificationListQueryKey('user-a', 3, 'en', 'WORKFLOW', false);
  const vietnamese = notificationListQueryKey('user-a', 3, 'vi', 'WORKFLOW', false);
  const unread = notificationListQueryKey('user-a', 3, 'en', 'WORKFLOW', true);
  assert.notDeepEqual(english, vietnamese);
  assert.notDeepEqual(english, unread);
  assert.deepEqual(notificationUnreadCountQueryKey('user-a', 3), [
    'notifications', 'user-a', 3, 'unread-count',
  ]);
});
