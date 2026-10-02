const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getSafeNotificationRoute,
  createNotificationTargetNavigator,
} = require('./notification.target.ts');

const workspaceId = '00000000-0000-4000-8000-000000000020';
const workflowId = '00000000-0000-4000-8000-000000000030';
const executionId = '00000000-0000-4000-8000-000000000040';
const connectionId = '00000000-0000-4000-8000-000000000050';
const scope = { userId: 'user-a', generation: 8 };

function notification(target, eventType = 'workflow.completed') {
  return { id: '00000000-0000-4000-8000-000000000010', eventType, target };
}

test('maps only validated catalog targets to fixed Expo routes', () => {
  assert.equal(
    getSafeNotificationRoute(notification({ kind: 'WORKFLOW', workspaceId, workflowId }).target),
    `/(app)/workflows/${workflowId}`,
  );
  assert.equal(
    getSafeNotificationRoute(notification({ kind: 'EXECUTION', workspaceId, executionId }).target),
    `/(app)/executions/${executionId}`,
  );
  assert.equal(getSafeNotificationRoute({ kind: 'WORKSPACE', workspaceId }), '/(app)/workspace');
  assert.equal(
    getSafeNotificationRoute({ kind: 'CONNECTION', workspaceId, connectionId }),
    '/(app)/connections',
  );
  assert.equal(getSafeNotificationRoute({ kind: 'SECURITY_SETTINGS' }), '/(app)/settings');
  assert.equal(getSafeNotificationRoute({ kind: 'NONE' }), null);
  assert.equal(getSafeNotificationRoute({ kind: 'WORKFLOW', workspaceId, workflowId: 'x' }), null);
  assert.equal(getSafeNotificationRoute({ kind: 'CUSTOM_URL', url: 'https://attacker.invalid' }), null);
});

test('authorizes membership and refreshes all visible workspaces before selecting/navigating', async () => {
  const calls = [];
  const navigator = createNotificationTargetNavigator({
    isSessionCurrent: (captured) => captured.userId === scope.userId && captured.generation === scope.generation,
    authorizeWorkspace: async (id) => {
      calls.push(['authorize', id]);
      return { id };
    },
    loadWorkspaces: async () => ({ items: [{ id: workspaceId }], page: 0, size: 1, totalElements: 1, totalPages: 1 }),
    selectWorkspace: (id) => calls.push(['select', id]),
    clearDestinationCache: (target) => calls.push(['clear', target.kind]),
    navigate: (path) => calls.push(['navigate', path]),
  });
  const result = await navigator.navigate(
    notification({ kind: 'WORKFLOW', workspaceId, workflowId }),
    scope,
  );
  assert.equal(result, 'navigated');
  assert.deepEqual(calls, [
    ['authorize', workspaceId],
    ['select', workspaceId],
    ['clear', 'WORKFLOW'],
    ['navigate', `/(app)/workflows/${workflowId}`],
  ]);
});

test('does not navigate to inaccessible, absent, removed, or stale-session targets', async () => {
  const navigations = [];
  let workspaceList = { items: [], page: 0, size: 0, totalElements: 0, totalPages: 0 };
  const navigator = createNotificationTargetNavigator({
    isSessionCurrent: (captured) => captured.generation === scope.generation,
    authorizeWorkspace: async (id) => ({ id }),
    loadWorkspaces: async () => workspaceList,
    selectWorkspace: () => {},
    clearDestinationCache: () => {},
    navigate: (path) => navigations.push(path),
  });

  assert.equal(
    await navigator.navigate(notification({ kind: 'WORKSPACE', workspaceId }), scope),
    'unavailable',
  );
  workspaceList = { items: [{ id: workspaceId }], page: 0, size: 1, totalElements: 1, totalPages: 1 };
  assert.equal(
    await navigator.navigate(notification({ kind: 'WORKSPACE', workspaceId }, 'workspace.member_removed'), scope),
    'ignored',
  );
  assert.equal(
    await navigator.navigate(notification({ kind: 'SECURITY_SETTINGS' }), { ...scope, generation: 7 }),
    'stale',
  );
  assert.deepEqual(navigations, []);
});

test('a newer tap supersedes an in-flight authorization and prevents its navigation', async () => {
  let finishAuthorization;
  const navigations = [];
  const navigator = createNotificationTargetNavigator({
    isSessionCurrent: () => true,
    authorizeWorkspace: (id, signal) => new Promise((resolve) => {
      finishAuthorization = () => resolve({ id, signal });
    }),
    loadWorkspaces: async () => ({ items: [{ id: workspaceId }], page: 0, size: 1, totalElements: 1, totalPages: 1 }),
    selectWorkspace: () => {},
    clearDestinationCache: () => {},
    navigate: (path) => navigations.push(path),
  });
  const first = navigator.navigate(notification({ kind: 'WORKFLOW', workspaceId, workflowId }), scope);
  const second = await navigator.navigate(notification({ kind: 'SECURITY_SETTINGS' }), scope);
  finishAuthorization();
  assert.equal(second, 'navigated');
  assert.equal(await first, 'superseded');
  assert.deepEqual(navigations, ['/(app)/settings']);
});
