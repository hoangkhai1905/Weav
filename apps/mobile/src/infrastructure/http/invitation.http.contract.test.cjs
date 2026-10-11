const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const {
  buildCreateInvitationRequest,
  buildOwnerInvitationsRequest,
  buildRevokeInvitationRequest,
  buildResendInvitationRequest,
  buildMyInvitationsRequest,
  buildAcceptInvitationRequest,
  buildDeclineInvitationRequest,
  buildEmailVerificationRequest,
  buildVerifyEmailRequest,
} = require('./invitation.http.contract.ts');

const WS = '11111111-1111-4111-8111-111111111111';
const INV = '66666666-6666-4666-8666-666666666666';

test('owner routes: create trims the email, list/revoke/resend use uuid paths', () => {
  assert.deepEqual(buildCreateInvitationRequest(WS, '  a@b.co '), {
    method: 'POST',
    url: `/api/v1/workspaces/${WS}/invitations`,
    data: { email: 'a@b.co' },
  });
  assert.deepEqual(buildOwnerInvitationsRequest(WS), { url: `/api/v1/workspaces/${WS}/invitations` });
  assert.deepEqual(buildRevokeInvitationRequest(WS, INV), {
    method: 'DELETE',
    url: `/api/v1/workspaces/${WS}/invitations/${INV}`,
  });
  assert.deepEqual(buildResendInvitationRequest(WS, INV), {
    method: 'POST',
    url: `/api/v1/workspaces/${WS}/invitations/${INV}/resend`,
  });
});

test('owner routes reject bad ids and bad emails before any request is made', () => {
  assert.throws(() => buildCreateInvitationRequest('abc', 'a@b.co'), /workspace id/i);
  assert.throws(() => buildOwnerInvitationsRequest(''), /workspace id/i);
  assert.throws(() => buildRevokeInvitationRequest(WS, '../x'), /invitation id/i);
  assert.throws(() => buildResendInvitationRequest(WS, 'abc'), /invitation id/i);
  assert.throws(() => buildCreateInvitationRequest(WS, '   '), /email/i);
  assert.throws(() => buildCreateInvitationRequest(WS, 'a'.repeat(321)), /email/i);
});

test('invitee routes: list, accept and decline', () => {
  assert.deepEqual(buildMyInvitationsRequest(), { url: '/api/v1/invitations' });
  assert.deepEqual(buildAcceptInvitationRequest(INV), { method: 'POST', url: `/api/v1/invitations/${INV}/accept` });
  assert.deepEqual(buildDeclineInvitationRequest(INV), { method: 'POST', url: `/api/v1/invitations/${INV}/decline` });
  assert.throws(() => buildAcceptInvitationRequest('abc'), /invitation id/i);
  assert.throws(() => buildDeclineInvitationRequest(`${INV}/x`), /invitation id/i);
});

test('the abort signal is passed through when given', () => {
  const { signal } = new AbortController();
  assert.equal(buildMyInvitationsRequest(signal).signal, signal);
  assert.equal(buildAcceptInvitationRequest(INV, signal).signal, signal);
});

test('e-mail check: request body names the purpose, verify needs a 6-digit code', () => {
  assert.deepEqual(buildEmailVerificationRequest(), {
    method: 'POST',
    url: '/api/auth/otp/request',
    data: { purpose: 'EMAIL_VERIFICATION' },
  });
  assert.deepEqual(buildVerifyEmailRequest('chal', '123456'), {
    method: 'POST',
    url: '/api/auth/otp/verify',
    data: { challengeId: 'chal', code: '123456' },
  });
  assert.throws(() => buildVerifyEmailRequest('chal', '12345'), /code/i);
  assert.throws(() => buildVerifyEmailRequest('chal', '12345a'), /code/i);
  assert.throws(() => buildVerifyEmailRequest('', '123456'), /challenge/i);
});
