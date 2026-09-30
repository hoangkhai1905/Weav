const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { selectActiveWorkspace, useWorkspaceStore } = require('./workspace.store.ts');

const workspace = (id, name) => ({
  id,
  name,
  createdBy: 'user-a',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

afterEach(() => useWorkspaceStore.getState().clearWorkspaceSession());

test('rename refresh keeps the active workspace ID while updating its label', () => {
  useWorkspaceStore.getState().setWorkspaces([workspace('workspace-a', 'Old name')]);
  useWorkspaceStore.getState().selectWorkspace('workspace-a');
  useWorkspaceStore.getState().setWorkspaces([workspace('workspace-a', 'New name')]);

  assert.equal(useWorkspaceStore.getState().activeWorkspaceId, 'workspace-a');
  assert.equal(selectActiveWorkspace(useWorkspaceStore.getState()).name, 'New name');
});

test('create refresh can select the exact ID returned by the server', () => {
  useWorkspaceStore.getState().setWorkspaces([workspace('workspace-a', 'Existing')]);
  useWorkspaceStore.getState().setWorkspaces([
    workspace('workspace-a', 'Existing'),
    workspace('server-created-id', 'Created'),
  ]);
  useWorkspaceStore.getState().selectWorkspace('server-created-id');

  assert.equal(useWorkspaceStore.getState().activeWorkspaceId, 'server-created-id');
  assert.equal(selectActiveWorkspace(useWorkspaceStore.getState()).id, 'server-created-id');
});

test('removing the selected workspace clears its ID and keeps another accessible workspace', () => {
  useWorkspaceStore.getState().setWorkspaces([
    workspace('workspace-a', 'A'),
    workspace('workspace-b', 'B'),
  ]);
  useWorkspaceStore.getState().selectWorkspace('workspace-a');
  useWorkspaceStore.getState().removeWorkspace('workspace-a');

  assert.equal(useWorkspaceStore.getState().activeWorkspaceId, 'workspace-b');
  assert.equal(selectActiveWorkspace(useWorkspaceStore.getState()).id, 'workspace-b');
  assert.deepEqual(useWorkspaceStore.getState().workspaces.map(({ id }) => id), ['workspace-b']);
});
