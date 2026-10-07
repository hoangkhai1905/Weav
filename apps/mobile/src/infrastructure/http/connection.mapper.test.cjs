const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { mapConnectionList, mapConnectionTestOutcome } = require('./connection.mapper.ts');

const dto = (overrides = {}) => ({
  id: 'c1',
  workspaceId: 'w1',
  createdBy: 'u1',
  name: 'Sheets',
  provider: 'GOOGLE_SHEETS',
  authType: 'OAUTH2',
  status: 'INVALID',
  config: null,
  hasCredential: true,
  credentialExpiresAt: null,
  lastVerifiedAt: '2026-09-01T00:00:00Z',
  canManage: true,
  canAttach: false,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...overrides,
});

test('maps the bare-array connection list', () => {
  const [item] = mapConnectionList([dto()]);
  assert.equal(item.provider, 'GOOGLE_SHEETS');
  assert.equal(item.status, 'INVALID');
  assert.equal(item.config, null);
  assert.equal(item.canAttach, false);
  assert.throws(() => mapConnectionList({ items: [] }), /connections/);
  assert.throws(() => mapConnectionList([dto({ status: 'CONNECTED' })]), /status/);
});

test('maps all three test outcomes including DEPENDENCY_FAILURE', () => {
  for (const outcome of ['VERIFIED', 'AUTH_INVALID', 'DEPENDENCY_FAILURE']) {
    assert.equal(mapConnectionTestOutcome({ outcome }), outcome);
  }
  assert.throws(() => mapConnectionTestOutcome({ outcome: 'OK' }), /outcome/);
});
