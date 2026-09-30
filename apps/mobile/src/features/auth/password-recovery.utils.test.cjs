const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validatePasswordRecovery,
  createPasswordRecoverySubmissionGate,
  isPasswordRecoveryFlowCurrent,
} = require('./password-recovery.utils.ts');

test('validates email, six-digit OTP, password bounds and confirmation', () => {
  assert.deepEqual(
    validatePasswordRecovery({
      email: 'person@example.com',
      code: '123456',
      newPassword: 'replacement-password',
      confirmPassword: 'replacement-password',
    }),
    {},
  );
  assert.deepEqual(
    validatePasswordRecovery({ email: '', code: '12', newPassword: 'short', confirmPassword: 'different' }),
    {
      email: 'Email is required.',
      code: 'Enter the 6-digit verification code.',
      newPassword: 'New password must be between 8 and 72 characters.',
      confirmPassword: 'New passwords do not match.',
    },
  );
  assert.equal(
    validatePasswordRecovery({
      email: 'not-an-email',
      code: 'abcdef',
      newPassword: 'a'.repeat(73),
      confirmPassword: 'a'.repeat(73),
    }).email,
    'Enter a valid email address.',
  );
});

test('blocks duplicate recovery mutations until the first finishes', () => {
  const gate = createPasswordRecoverySubmissionGate();
  assert.equal(gate.tryStart(), true);
  assert.equal(gate.tryStart(), false);
  gate.finish();
  assert.equal(gate.tryStart(), true);
});

test('rejects stale or unmounted recovery responses', () => {
  assert.equal(isPasswordRecoveryFlowCurrent(3, 3, true), true);
  assert.equal(isPasswordRecoveryFlowCurrent(3, 4, true), false);
  assert.equal(isPasswordRecoveryFlowCurrent(3, 3, false), false);
});
