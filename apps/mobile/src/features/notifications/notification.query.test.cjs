const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getNextNotificationCursor,
  notificationQueryKey,
} = require('./notification.query.ts');

test('stops notification pagination when the service repeats or clears its cursor', () => {
  assert.equal(
    getNextNotificationCursor(
      { items: [], nextCursor: 'cursor-2' },
      [],
      undefined,
    ),
    'cursor-2',
  );
  assert.equal(
    getNextNotificationCursor(
      { items: [], nextCursor: 'cursor-2' },
      [],
      'cursor-2',
    ),
    undefined,
  );
  assert.equal(
    getNextNotificationCursor({ items: [], nextCursor: null }, [], 'cursor-2'),
    undefined,
  );
});

test('scopes notification queries by the authenticated account', () => {
  assert.deepEqual(notificationQueryKey('user-a'), [
    'notifications',
    'user-a',
  ]);
  assert.deepEqual(notificationQueryKey('user-b'), [
    'notifications',
    'user-b',
  ]);
  assert.notDeepEqual(notificationQueryKey('user-a'), notificationQueryKey('user-b'));
  assert.deepEqual(notificationQueryKey(null), ['notifications', 'anonymous']);
});
