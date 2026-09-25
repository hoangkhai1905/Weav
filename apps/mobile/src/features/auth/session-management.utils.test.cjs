const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAuthSessionScopeCurrent,
} = require('./session-management.utils.ts');

test('accepts late session work only for the captured authenticated account and refresh session', () => {
  assert.equal(
    isAuthSessionScopeCurrent('user-a', 'refresh-a', 'user-a', 'refresh-a', true),
    true,
  );
  assert.equal(
    isAuthSessionScopeCurrent('user-a', 'refresh-a', 'user-b', 'refresh-b', true),
    false,
  );
  assert.equal(
    isAuthSessionScopeCurrent('user-a', 'refresh-a', null, null, false),
    false,
  );
  assert.equal(
    isAuthSessionScopeCurrent('user-a', 'refresh-a', 'user-a', 'refresh-new', true),
    false,
  );
});
