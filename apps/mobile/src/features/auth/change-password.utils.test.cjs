const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateChangePassword,
  createChangePasswordSubmissionGate,
  isChangePasswordScopeCurrent,
} = require('./change-password.utils.ts');

test('validates the Identity password bounds and confirmation without trimming submitted secrets', () => {
  assert.deepEqual(
    validateChangePassword({
      currentPassword: ' current-secret ',
      newPassword: 'replacement-secret',
      confirmPassword: 'replacement-secret',
    }),
    {},
  );
  assert.deepEqual(
    validateChangePassword({
      currentPassword: 'short',
      newPassword: 'replacement-secret',
      confirmPassword: 'different-secret',
    }),
    {
      currentPassword: 'Current password must be between 8 and 72 characters.',
      confirmPassword: 'New passwords do not match.',
    },
  );
  assert.deepEqual(
    validateChangePassword({ currentPassword: ' ', newPassword: '', confirmPassword: '' }),
    {
      currentPassword: 'Current password is required.',
      newPassword: 'New password is required.',
      confirmPassword: 'Please confirm the new password.',
    },
  );
  assert.equal(
    validateChangePassword({
      currentPassword: 'a'.repeat(8),
      newPassword: 'b'.repeat(73),
      confirmPassword: 'b'.repeat(73),
    }).newPassword,
    'New password must be between 8 and 72 characters.',
  );
});

test('blocks duplicate password mutations until the first one finishes', () => {
  const gate = createChangePasswordSubmissionGate();

  assert.equal(gate.tryStart(), true);
  assert.equal(gate.tryStart(), false);
  gate.finish();
  assert.equal(gate.tryStart(), true);
});

test('accepts a late result only for the captured authenticated session', () => {
  assert.equal(
    isChangePasswordScopeCurrent('user-a', 'refresh-a', 'user-a', 'refresh-a', true),
    true,
  );
  assert.equal(
    isChangePasswordScopeCurrent('user-a', 'refresh-a', 'user-b', 'refresh-b', true),
    false,
  );
  assert.equal(
    isChangePasswordScopeCurrent('user-a', 'refresh-a', null, null, false),
    false,
  );
  assert.equal(
    isChangePasswordScopeCurrent('user-a', 'refresh-a', 'user-a', 'refresh-new', true),
    false,
  );
});
