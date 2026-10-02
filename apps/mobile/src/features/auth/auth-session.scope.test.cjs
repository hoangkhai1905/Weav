const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { useAuthStore } = require('../../stores/auth.store.ts');
const {
  captureAuthSessionScope,
  isAuthSessionScopeCurrent,
} = require('./auth-session.scope.ts');

test('fences a same-user replacement session and logout with a generation', () => {
  const store = useAuthStore.getState();
  store.clearAuthSession();
  store.setAuthSession(
    { id: 'scope-user', name: 'Test', email: 'test@example.invalid' },
    { accessToken: 'fixture-one', refreshToken: 'fixture-refresh-one' },
  );
  const first = captureAuthSessionScope();
  assert.equal(isAuthSessionScopeCurrent(first), true);

  useAuthStore.getState().setAuthSession(
    { id: 'scope-user', name: 'Test', email: 'test@example.invalid' },
    { accessToken: 'fixture-two', refreshToken: 'fixture-refresh-two' },
  );
  assert.equal(isAuthSessionScopeCurrent(first), false);
  const second = captureAuthSessionScope();
  assert.equal(second.userId, first.userId);
  assert.notEqual(second.generation, first.generation);

  useAuthStore.getState().clearAuthSession();
  assert.equal(isAuthSessionScopeCurrent(second), false);
});
