const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  FORGOT_PASSWORD_PATH,
  OTP_VERIFY_PATH,
  RESET_PASSWORD_PATH,
  buildForgotPasswordRequest,
  buildVerifyOtpRequest,
  buildResetPasswordRequest,
  mapPasswordResetReceipt,
  mapPasswordResetVerification,
  assertPasswordRecoveryResponse,
  mapPasswordRecoveryError,
} = require('./password-recovery.http.contract.ts');

const CHALLENGE_ID = 'A'.repeat(43);
const RESET_TOKEN = 'B'.repeat(43);

test('builds exact public recovery routes and never sends confirm password', () => {
  assert.deepEqual(buildForgotPasswordRequest('person@example.com'), {
    method: 'POST',
    url: FORGOT_PASSWORD_PATH,
    data: { email: 'person@example.com' },
  });
  assert.deepEqual(buildVerifyOtpRequest(CHALLENGE_ID, '123456'), {
    method: 'POST',
    url: OTP_VERIFY_PATH,
    data: { challengeId: CHALLENGE_ID, code: '123456' },
  });
  assert.deepEqual(buildResetPasswordRequest(RESET_TOKEN, 'new-password'), {
    method: 'POST',
    url: RESET_PASSWORD_PATH,
    data: { resetToken: RESET_TOKEN, newPassword: 'new-password' },
  });
  assert.equal(FORGOT_PASSWORD_PATH, '/api/auth/forgot-password');
  assert.equal(OTP_VERIFY_PATH, '/api/auth/otp/verify');
  assert.equal(RESET_PASSWORD_PATH, '/api/auth/reset-password');
});

test('maps only safe receipt and password-reset verification fields', () => {
  assert.deepEqual(
    mapPasswordResetReceipt({ challengeId: CHALLENGE_ID, expiresIn: 300, retryAfter: 60 }),
    { challengeId: CHALLENGE_ID, expiresIn: 300, retryAfter: 60 },
  );
  assert.deepEqual(
    mapPasswordResetVerification({ purpose: 'PASSWORD_RESET', resetToken: RESET_TOKEN, expiresIn: 300 }),
    { purpose: 'PASSWORD_RESET', resetToken: RESET_TOKEN, expiresIn: 300 },
  );
  assert.throws(
    () => mapPasswordResetReceipt({ challengeId: CHALLENGE_ID, expiresIn: 300, retryAfter: 60, code: '123456' }),
    (error) => error.code === 'INVALID_RESPONSE',
  );
  assert.throws(
    () => mapPasswordResetVerification({ purpose: 'EMAIL_VERIFICATION', verified: true }),
    (error) => error.code === 'INVALID_RESPONSE',
  );
});

test('accepts only operation-specific success statuses', () => {
  assert.doesNotThrow(() => assertPasswordRecoveryResponse(202, 'forgot'));
  assert.doesNotThrow(() => assertPasswordRecoveryResponse(200, 'verify'));
  assert.doesNotThrow(() => assertPasswordRecoveryResponse(204, 'reset'));
  assert.throws(
    () => assertPasswordRecoveryResponse(200, 'forgot'),
    (error) => error.code === 'RECOVERY_ERROR' && error.status === 200,
  );
  assert.throws(
    () => assertPasswordRecoveryResponse(204, 'verify'),
    (error) => error.code === 'RECOVERY_ERROR' && error.status === 204,
  );
});

test('maps recovery errors without exposing email, OTP, reset token or password', () => {
  assert.equal(mapPasswordRecoveryError(400, 'verify').code, 'INVALID_OTP');
  assert.equal(mapPasswordRecoveryError(400, 'reset').code, 'INVALID_RESET');
  assert.equal(mapPasswordRecoveryError(429, 'forgot').code, 'RATE_LIMITED');
  assert.equal(mapPasswordRecoveryError(503, 'forgot').code, 'RECOVERY_UNAVAILABLE');
  const error = mapPasswordRecoveryError(undefined, 'reset');
  assert.equal(error.code, 'RECOVERY_ERROR');
  assert.equal(error.status, undefined);
  assert.equal(error.message.includes(CHALLENGE_ID), false);
  assert.equal(error.message.includes(RESET_TOKEN), false);
});
