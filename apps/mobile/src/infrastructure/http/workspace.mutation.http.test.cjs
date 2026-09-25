const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAddMemberRequest,
  buildCreateWorkspaceRequest,
  buildLeaveWorkspaceRequest,
  buildRemoveMemberRequest,
  buildRenameWorkspaceRequest,
  buildUpdateMemberPermissionsRequest,
  mapMemberResponse,
  mapWorkspaceResponse,
} = require('./workspace.http.contract.ts');

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

test('builds the create request with the contract body and Gateway route', () => {
  const signal = new AbortController().signal;
  assert.deepEqual(
    buildCreateWorkspaceRequest({ name: 'New workspace' }, null, signal),
    {
      method: 'POST',
      url: '/api/v1/workspaces',
      data: { name: 'New workspace' },
      signal,
    },
  );
  assert.deepEqual(buildCreateWorkspaceRequest({}, null), {
    method: 'POST',
    url: '/api/v1/workspaces',
    data: {},
  });
});

test('builds rename with the real workspace ID and maps WorkspaceResponse', () => {
  assert.deepEqual(
    buildRenameWorkspaceRequest(WORKSPACE_ID, { name: 'Renamed' }, null),
    {
      method: 'PATCH',
      url: `/api/v1/workspaces/${WORKSPACE_ID}`,
      data: { name: 'Renamed' },
    },
  );
  const mapped = mapWorkspaceResponse({
    id: WORKSPACE_ID,
    name: 'Renamed',
    createdBy: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
  });
  assert.equal(mapped.id, WORKSPACE_ID);
  assert.equal(mapped.name, 'Renamed');
  assert.equal(mapped.updatedAt, '2026-09-02T00:00:00Z');
});

test('builds member add with existing Identity email and maps MemberView', () => {
  const signal = new AbortController().signal;
  assert.deepEqual(
    buildAddMemberRequest(WORKSPACE_ID, { email: 'member@example.com' }, 'token', signal),
    {
      method: 'POST',
      url: `/api/v1/workspaces/${WORKSPACE_ID}/members`,
      data: { email: 'member@example.com' },
      headers: { Authorization: 'Bearer token' },
      signal,
    },
  );
  const mapped = mapMemberResponse({
    userId: '33333333-3333-4333-8333-333333333333',
    email: 'member@example.com',
    displayName: 'Member',
    active: true,
    role: 'MEMBER',
    canPublishWorkflow: false,
    canManageWorkflowState: true,
    joinedAt: '2026-09-03T00:00:00Z',
    updatedAt: '2026-09-03T00:00:00Z',
  });
  assert.equal(mapped.id, '33333333-3333-4333-8333-333333333333');
  assert.equal(mapped.name, 'Member');
  assert.equal(mapped.canManageWorkflowState, true);
});

test('builds permission, remove and leave routes without inventing a response body', () => {
  const targetId = '33333333-3333-4333-8333-333333333333';
  assert.deepEqual(
    buildUpdateMemberPermissionsRequest(
      WORKSPACE_ID,
      targetId,
      { canPublishWorkflow: true, canManageWorkflowState: false },
      null,
    ),
    {
      method: 'PATCH',
      url: `/api/v1/workspaces/${WORKSPACE_ID}/members/${targetId}/permissions`,
      data: { canPublishWorkflow: true, canManageWorkflowState: false },
    },
  );
  assert.deepEqual(buildRemoveMemberRequest(WORKSPACE_ID, targetId, null), {
    method: 'DELETE',
    url: `/api/v1/workspaces/${WORKSPACE_ID}/members/${targetId}`,
  });
  assert.deepEqual(buildLeaveWorkspaceRequest(WORKSPACE_ID, null), {
    method: 'DELETE',
    url: `/api/v1/workspaces/${WORKSPACE_ID}/members/me`,
  });
});
