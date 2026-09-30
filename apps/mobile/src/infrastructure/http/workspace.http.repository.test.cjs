const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildWorkspaceRequest,
  mapMemberPage,
  mapWorkspacePage,
} = require('./workspace.http.contract.ts');

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function page(items, overrides = {}) {
  return {
    items,
    page: 0,
    size: 100,
    totalElements: items.length,
    totalPages: 1,
    ...overrides,
  };
}

test('lists workspaces through the Gateway with a captured bearer token and maps page metadata', () => {
  const config = buildWorkspaceRequest(
    '/api/v1/workspaces',
    { page: 0, size: 100 },
    'access-token-for-test',
  );
  const result = mapWorkspacePage(page([
    {
      id: WORKSPACE_ID,
      name: 'Operations',
      createdBy: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-02T00:00:00Z',
    },
  ], { totalElements: 2, totalPages: 2 }));

  assert.equal(config.url, '/api/v1/workspaces');
  assert.deepEqual(config.params, { page: 0, size: 100 });
  assert.equal(config.headers.Authorization, 'Bearer access-token-for-test');
  assert.equal(result.items[0].id, WORKSPACE_ID);
  assert.equal(result.items[0].name, 'Operations');
  assert.equal(result.totalPages, 2);
  assert.equal(result.totalElements, 2);
});

test('reads members through the selected workspace route and maps userId/displayName', () => {
  const config = buildWorkspaceRequest(
    `/api/v1/workspaces/${WORKSPACE_ID}/members`,
    { page: 0, size: 100 },
    'access-token-for-test',
  );
  const result = mapMemberPage(page([
    {
      userId: '33333333-3333-4333-8333-333333333333',
      email: 'member@example.com',
      displayName: null,
      active: true,
      role: 'MEMBER',
      canPublishWorkflow: false,
      canManageWorkflowState: false,
      joinedAt: '2026-09-03T00:00:00Z',
      updatedAt: '2026-09-03T00:00:00Z',
    },
  ]));

  assert.equal(config.url, `/api/v1/workspaces/${WORKSPACE_ID}/members`);
  assert.deepEqual(config.params, { page: 0, size: 100 });
  assert.equal(result.items[0].id, '33333333-3333-4333-8333-333333333333');
  assert.equal(result.items[0].name, 'member@example.com');
  assert.equal(result.items[0].email, 'member@example.com');
  assert.equal(result.items[0].role, 'MEMBER');
});

test('does not manufacture an Authorization header without an explicit token', () => {
  const config = buildWorkspaceRequest('/api/v1/workspaces', { page: 0, size: 100 }, null);

  assert.equal(config.headers, undefined);
});
