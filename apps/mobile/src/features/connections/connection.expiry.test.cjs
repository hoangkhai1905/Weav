const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { credentialExpiry } = require('./connection.expiry.ts');

const NOW = new Date('2026-10-08T10:00:00Z');

test('classifies a credential by how soon it expires', () => {
  assert.equal(credentialExpiry(null, NOW), 'none');
  assert.equal(credentialExpiry('not a date', NOW), 'none');
  assert.equal(credentialExpiry('2026-10-08T09:59:59Z', NOW), 'expired');
  assert.equal(credentialExpiry('2026-10-08T10:00:00Z', NOW), 'expired');
  assert.equal(credentialExpiry('2026-10-09T10:00:00Z', NOW), 'soon');
  assert.equal(credentialExpiry('2026-10-15T10:00:00Z', NOW), 'soon');
  assert.equal(credentialExpiry('2026-10-15T10:00:01Z', NOW), 'ok');
  assert.equal(credentialExpiry('2026-10-30T10:00:00Z', NOW, 30), 'soon');
});
