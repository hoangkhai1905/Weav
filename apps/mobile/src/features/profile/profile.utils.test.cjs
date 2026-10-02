const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_DISPLAY_NAME_LENGTH,
  normalizeDisplayName,
  validateDisplayName,
  isProfileScopeCurrent,
  canApplyProfileResponse,
  createProfileSubmissionGate,
} = require('./profile.utils.ts');

test('normalizes a blank display name to the contract clear value', () => {
  assert.equal(normalizeDisplayName('  '), null);
  assert.equal(normalizeDisplayName('  Ada Lovelace  '), 'Ada Lovelace');
});

test('rejects display names longer than the Identity contract limit', () => {
  assert.equal(validateDisplayName('A'.repeat(MAX_DISPLAY_NAME_LENGTH)), null);
  assert.match(
    validateDisplayName('A'.repeat(MAX_DISPLAY_NAME_LENGTH + 1)),
    /120/,
  );
});

test('accepts a profile response only for the still-authenticated account', () => {
  assert.equal(isProfileScopeCurrent('user-a', 'user-a', true), true);
  assert.equal(isProfileScopeCurrent('user-a', 'user-b', true), false);
  assert.equal(isProfileScopeCurrent('user-a', null, false), false);
  assert.equal(
    canApplyProfileResponse(
      'user-a',
      'user-a',
      true,
      { id: 'user-a', email: 'a@example.com', name: 'A' },
    ),
    true,
  );
  assert.equal(
    canApplyProfileResponse(
      'user-a',
      'user-b',
      true,
      { id: 'user-a', email: 'a@example.com', name: 'Stale' },
    ),
    false,
  );
  assert.equal(
    canApplyProfileResponse(
      'user-a',
      null,
      false,
      { id: 'user-a', email: 'a@example.com', name: 'After logout' },
    ),
    false,
  );
});

test('profile submission gate allows one mutation and blocks duplicate submit', () => {
  const gate = createProfileSubmissionGate();

  assert.equal(gate.tryStart(), true);
  assert.equal(gate.tryStart(), false);
  gate.finish();
  assert.equal(gate.tryStart(), true);
});
