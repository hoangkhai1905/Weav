const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { credentialDaysLeft, credentialExpiry } = require('./connection.expiry.ts');

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

test('counts whole days left, at least one, and zero without a valid expiry', () => {
  assert.equal(credentialDaysLeft(null, NOW), 0);
  assert.equal(credentialDaysLeft('not a date', NOW), 0);
  assert.equal(credentialDaysLeft('2026-10-08T11:00:00Z', NOW), 1);
  assert.equal(credentialDaysLeft('2026-10-09T10:00:00Z', NOW), 1);
  assert.equal(credentialDaysLeft('2026-10-09T10:00:01Z', NOW), 2);
  assert.equal(credentialDaysLeft('2026-10-01T10:00:00Z', NOW), 1);
});
