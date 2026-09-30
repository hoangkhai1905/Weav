const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  CHANGE_PASSWORD_PATH,
  buildChangePasswordRequest,
  assertChangePasswordResponse,
  mapChangePasswordError,
} = require('./password.http.contract.ts');

test('builds the authenticated change-password request with the actual contract fields', () => {
  assert.deepEqual(
    buildChangePasswordRequest('current-secret', 'replacement-secret'),
    {
      method: 'POST',
      url: CHANGE_PASSWORD_PATH,
      data: {
        currentPassword: 'current-secret',
        newPassword: 'replacement-secret',
      },
    },
  );
  assert.equal(CHANGE_PASSWORD_PATH, '/api/auth/change-password');
});

test('maps change-password failures without exposing credentials', () => {
  assert.deepEqual(mapChangePasswordError(400), {
    code: 'VALIDATION_FAILED',
    message: 'Password must be between 8 and 72 characters.',
    status: 400,
  });
  assert.deepEqual(mapChangePasswordError(401), {
    code: 'UNAUTHORIZED',
    message: 'Current password is incorrect or the session is no longer valid.',
    status: 401,
  });
  assert.deepEqual(mapChangePasswordError(429), {
    code: 'RATE_LIMITED',
    message: 'Too many password-change attempts. Please try again later.',
    status: 429,
  });
  assert.deepEqual(mapChangePasswordError(), {
    code: 'PASSWORD_CHANGE_ERROR',
    message: 'Password change service unavailable. Please try again.',
  });
});

test('accepts only the contract 204 response as a successful password change', () => {
  assert.doesNotThrow(() => assertChangePasswordResponse(204));
  assert.throws(
    () => assertChangePasswordResponse(200),
    (error) => error.code === 'PASSWORD_CHANGE_ERROR' && error.status === 200,
  );
});
