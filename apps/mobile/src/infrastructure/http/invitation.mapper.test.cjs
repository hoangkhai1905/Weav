const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const {
  mapOwnerInvitation,
  mapOwnerInvitationList,
  mapMyInvitationList,
  mapAcceptedInvitation,
  mapEmailVerificationReceipt,
  mapEmailVerified,
} = require('./invitation.mapper.ts');

const owner = (overrides = {}) => ({
  id: 'i1',
  workspaceId: 'w1',
  email: 'a@b.co',
  status: 'PENDING',
  invitedBy: 'u1',
  createdAt: '2026-10-01T00:00:00Z',
  expiresAt: '2026-10-08T00:00:00Z',
  lastSentAt: '2026-10-01T00:00:00Z',
  ...overrides,
});

test('maps the owner list ({ items }) and every status', () => {
  const list = mapOwnerInvitationList({ items: [owner(), owner({ status: 'EXPIRED', lastSentAt: null })] });
  assert.equal(list.length, 2);
  assert.equal(list[0].email, 'a@b.co');
  assert.equal(list[1].status, 'EXPIRED');
  assert.equal(list[1].lastSentAt, null);
  for (const status of ['PENDING', 'EXPIRED', 'ACCEPTED', 'DECLINED', 'REVOKED']) {
    assert.equal(mapOwnerInvitation(owner({ status })).status, status);
  }
});

test('rejects malformed owner invitations', () => {
  assert.throws(() => mapOwnerInvitationList([owner()]), /invitations/);
  assert.throws(() => mapOwnerInvitationList({ items: 'x' }), /items/);
  assert.throws(() => mapOwnerInvitation(owner({ status: 'OPEN' })), /status/);
  assert.throws(() => mapOwnerInvitation(owner({ email: 5 })), /email/);
  assert.throws(() => mapOwnerInvitation(null), /invitation/);
});

test('maps my invitations with the email-verified flag', () => {
  const mine = { id: 'i1', workspaceId: 'w1', workspaceName: 'Team', invitedByName: 'An', expiresAt: '2026-10-08T00:00:00Z' };
  assert.deepEqual(mapMyInvitationList({ items: [mine], emailVerified: true }), { items: [mine], emailVerified: true });
  assert.deepEqual(mapMyInvitationList({ items: [], emailVerified: false }), { items: [], emailVerified: false });
  assert.throws(() => mapMyInvitationList({ items: [] }), /emailVerified/);
  assert.throws(() => mapMyInvitationList({ items: [{ ...mine, workspaceName: undefined }], emailVerified: true }), /workspaceName/);
  assert.throws(() => mapMyInvitationList({ emailVerified: true }), /items/);
});

test('maps accept, receipt and verify answers', () => {
  assert.deepEqual(mapAcceptedInvitation({ workspaceId: 'w1' }), { workspaceId: 'w1' });
  assert.throws(() => mapAcceptedInvitation({}), /workspaceId/);
  assert.deepEqual(mapEmailVerificationReceipt({ challengeId: 'c', expiresIn: 300, retryAfter: 60 }), {
    challengeId: 'c',
    expiresIn: 300,
  });
  assert.throws(() => mapEmailVerificationReceipt({ challengeId: '', expiresIn: 300 }), /challengeId/);
  assert.throws(() => mapEmailVerificationReceipt({ challengeId: 'c', expiresIn: '300' }), /expiresIn/);
  assert.doesNotThrow(() => mapEmailVerified({ purpose: 'EMAIL_VERIFICATION' }));
  assert.throws(() => mapEmailVerified({ purpose: 'PASSWORD_RESET', resetToken: 'x' }), /purpose/);
  assert.throws(() => mapEmailVerified(undefined), /emailVerified/);
});
