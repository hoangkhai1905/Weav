const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createWorkspaceInput,
  canSubmitWorkspaceMutation,
  canManageWorkspaceMember,
  isWorkspaceMutationScopeCurrent,
  isWorkspaceMemberMutationScopeCurrent,
  validateMemberEmail,
  mergeWorkspaceList,
  validateWorkspaceName,
} = require('./workspace.mutations.ts');

const workspace = (id, name = id) => ({
  id,
  name,
  createdBy: 'user-a',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

test('matches the Gateway name contract for optional create and required rename', () => {
  assert.equal(validateWorkspaceName('', false), null);
  assert.equal(validateWorkspaceName('  ', false), null);
  assert.equal(validateWorkspaceName('  ', true), 'Workspace name is required.');
  assert.equal(validateWorkspaceName('x'.repeat(256), true), 'Workspace name must be 255 characters or fewer.');
  assert.deepEqual(createWorkspaceInput('  '), {});
  assert.deepEqual(createWorkspaceInput('  New workspace  '), { name: 'New workspace' });
});

test('ignores late mutation results after authentication scope changes', () => {
  assert.equal(isWorkspaceMutationScopeCurrent('user-a', 'user-a', true), true);
  assert.equal(isWorkspaceMutationScopeCurrent('user-a', 'user-b', true), false);
  assert.equal(isWorkspaceMutationScopeCurrent('user-a', null, false), false);
});

test('blocks a second submit while the mutation or submit handler is in flight', () => {
  assert.equal(canSubmitWorkspaceMutation(false, false), true);
  assert.equal(canSubmitWorkspaceMutation(true, false), false);
  assert.equal(canSubmitWorkspaceMutation(false, true), false);
});

test('validates the add-member email contract and gates only loaded owner rows', () => {
  assert.equal(validateMemberEmail('member@example.com'), null);
  assert.equal(validateMemberEmail(''), 'Member email is required.');
  assert.equal(validateMemberEmail('not-an-email'), 'Enter a valid member email.');
  assert.equal(validateMemberEmail('x'.repeat(321) + '@example.com'), 'Member email must be 320 characters or fewer.');
  assert.equal(canManageWorkspaceMember({ role: 'OWNER' }), true);
  assert.equal(canManageWorkspaceMember({ role: 'MEMBER' }), false);
  assert.equal(canManageWorkspaceMember(undefined), false);
});

test('rejects late member mutation results after account or workspace scope changes', () => {
  assert.equal(isWorkspaceMemberMutationScopeCurrent('user-a', 'workspace-a', 'user-a', 'workspace-a', true), true);
  assert.equal(isWorkspaceMemberMutationScopeCurrent('user-a', 'workspace-a', 'user-b', 'workspace-a', true), false);
  assert.equal(isWorkspaceMemberMutationScopeCurrent('user-a', 'workspace-a', 'user-a', 'workspace-b', true), false);
  assert.equal(isWorkspaceMemberMutationScopeCurrent('user-a', 'workspace-a', null, null, false), false);
});

test('merges the response workspace while preserving its real ID', () => {
  const original = workspace('workspace-a', 'Old name');
  const renamed = { ...original, name: 'New name', updatedAt: '2026-09-02T00:00:00Z' };
  const created = workspace('workspace-created', 'Created');

  assert.deepEqual(mergeWorkspaceList([original], renamed), [renamed]);
  assert.deepEqual(mergeWorkspaceList([original], created), [original, created]);
  assert.equal(mergeWorkspaceList([original], renamed)[0].id, 'workspace-a');
});
