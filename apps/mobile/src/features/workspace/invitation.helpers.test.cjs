const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const {
  invitationErrorKey,
  invitationListIsStale,
  isUserNotFound,
  onlyCodeDigits,
} = require('./invitation.helpers.ts');

test('error codes map to friendly keys', () => {
  const key = (code, status, phase = 'manage') => invitationErrorKey({ code, status }, phase);
  assert.equal(key('USER_EXISTS', 409, 'invite'), 'inv.err.userExists');
  assert.equal(key('USER_INACTIVE', 409, 'invite'), 'inv.err.userInactive');
  assert.equal(key('INVITATION_EXISTS', 409, 'invite'), 'inv.err.exists');
  assert.equal(key('INVITATION_LIMIT', 429, 'invite'), 'inv.err.limit');
  assert.equal(key('INVITATION_RESEND_TOO_SOON', 429), 'inv.err.resendTooSoon');
  assert.equal(key('INVITATION_GONE', 410, 'respond'), 'inv.err.gone');
  assert.equal(key('INVITATION_NOT_PENDING', 409, 'respond'), 'inv.err.gone');
  assert.equal(key('INVITATION_NOT_FOUND', 404, 'respond'), 'inv.err.gone');
  assert.equal(key('EMAIL_NOT_VERIFIED', 409, 'respond'), 'inv.err.notVerified');
});

test('status fallbacks, network errors and the wrong-code case', () => {
  assert.equal(invitationErrorKey({ code: 'TOO_MANY_REQUESTS', status: 429 }, 'invite'), 'inv.err.tooMany');
  assert.equal(invitationErrorKey({ code: 'X', status: 410 }, 'respond'), 'inv.err.gone');
  assert.equal(invitationErrorKey({ code: 'FORBIDDEN', status: 403 }, 'manage'), 'ui.error.FORBIDDEN');
  assert.equal(invitationErrorKey({ code: 'VALIDATION_FAILED', status: 400 }, 'verify'), 'inv.err.badCode');
  assert.equal(invitationErrorKey({ code: 'VALIDATION_FAILED', status: 400 }, 'invite'), 'inv.err.generic');
  assert.equal(invitationErrorKey({ status: 500 }, 'respond'), 'inv.err.generic');
  assert.equal(invitationErrorKey({ code: 'NETWORK_ERROR' }, 'respond'), 'au.err.network');
  assert.equal(invitationErrorKey({ code: 'INVALID_RESPONSE' }, 'respond'), 'inv.err.generic');
  assert.equal(invitationErrorKey(null, 'respond'), 'au.err.network');
});

test('only 404 USER_NOT_FOUND offers the e-mail invitation', () => {
  assert.equal(isUserNotFound({ code: 'USER_NOT_FOUND', status: 404 }), true);
  assert.equal(isUserNotFound({ code: 'WORKSPACE_NOT_FOUND', status: 404 }), false);
  assert.equal(isUserNotFound({ code: 'USER_NOT_FOUND', status: 409 }), false);
  assert.equal(isUserNotFound(undefined), false);
});

test('stale-list detection and code typing', () => {
  assert.equal(invitationListIsStale({ code: 'INVITATION_GONE', status: 410 }), true);
  assert.equal(invitationListIsStale({ code: 'EMAIL_NOT_VERIFIED', status: 409 }), true);
  assert.equal(invitationListIsStale({ code: 'INTERNAL_ERROR', status: 500 }), false);
  assert.equal(invitationListIsStale({ code: 'NETWORK_ERROR' }), false);
  assert.equal(onlyCodeDigits(' 12 34-56789'), '123456');
  assert.equal(onlyCodeDigits('abc'), '');
});
