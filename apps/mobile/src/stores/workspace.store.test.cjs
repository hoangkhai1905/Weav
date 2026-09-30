const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { useWorkspaceStore, selectActiveWorkspace } = require('./workspace.store.ts');

const workspace = (id, name = id) => ({
  id,
  name,
  createdBy: 'user',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

afterEach(() => {
  useWorkspaceStore.getState().clearWorkspaceSession();
});

test('account switch clears the old workspace selection before new data is applied', () => {
  useWorkspaceStore.getState().setWorkspaces([workspace('old-workspace')]);
  assert.equal(useWorkspaceStore.getState().activeWorkspaceId, 'old-workspace');

  useWorkspaceStore.getState().clearWorkspaceSession();
  assert.equal(useWorkspaceStore.getState().activeWorkspaceId, null);
  assert.equal(selectActiveWorkspace(useWorkspaceStore.getState()), null);

  useWorkspaceStore.getState().setWorkspaces([workspace('new-workspace')]);
  assert.equal(useWorkspaceStore.getState().activeWorkspaceId, 'new-workspace');
  assert.equal(selectActiveWorkspace(useWorkspaceStore.getState()).id, 'new-workspace');
});

test('invalid selection clears the active id and cannot trigger a members request', () => {
  useWorkspaceStore.getState().setWorkspaces([workspace('workspace-a')]);
  useWorkspaceStore.getState().selectWorkspace('not-in-list');

  assert.equal(useWorkspaceStore.getState().activeWorkspaceId, null);
  assert.match(useWorkspaceStore.getState().workspaceAccessError, /no longer available/i);
  assert.equal(selectActiveWorkspace(useWorkspaceStore.getState()), null);
});
