import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { useWorkspaceStore } from './useWorkspaceStore.ts';

const SESSION_A = 'workspace-store-session-a';
const SESSION_B = 'workspace-store-session-b';
const WORKSPACE_A = '30000000-0000-4000-8000-000000000001';
const WORKSPACE_B = '30000000-0000-4000-8000-000000000002';
const WORKSPACE_C = '30000000-0000-4000-8000-000000000003';

const workspace = (id, name) => ({ id, name });
const state = () => useWorkspaceStore.getState();

function assertActiveWorkspaceIsVisible() {
  const { activeWorkspaceId, workspaces } = state();
  assert.ok(
    activeWorkspaceId === null || workspaces.some((item) => item.id === activeWorkspaceId),
    'activeWorkspaceId must be null or identify a visible workspace',
  );
}

afterEach(() => state().clear());

test('setWorkspaces then select keeps the canonical list and selected workspace', () => {
  const workspaces = [workspace(WORKSPACE_A, 'A'), workspace(WORKSPACE_B, 'B')];
  state().setWorkspaces(workspaces);
  assertActiveWorkspaceIsVisible();
  state().selectWorkspace(WORKSPACE_B);

  assert.deepEqual(state().canonicalWorkspaces, workspaces);
  assert.deepEqual(state().workspaces, workspaces);
  assert.equal(state().activeWorkspaceId, WORKSPACE_B);
  assertActiveWorkspaceIsVisible();
});

test('a domain mutation after list reconciliation survives selection', () => {
  const a = workspace(WORKSPACE_A, 'A');
  const b = workspace(WORKSPACE_B, 'B');
  state().reconcileWorkspaceList([a], SESSION_A);
  assertActiveWorkspaceIsVisible();
  state().setWorkspaces([a, b]);
  assertActiveWorkspaceIsVisible();
  state().selectWorkspace(WORKSPACE_B);

  assert.deepEqual(state().workspaces, [a, b]);
  assert.equal(state().activeWorkspaceId, WORKSPACE_B);
  assertActiveWorkspaceIsVisible();
});

test('renamed domain data is not reverted by a subsequent workspace selection', () => {
  const a = workspace(WORKSPACE_A, 'A');
  const b = workspace(WORKSPACE_B, 'B');
  const renamedA = workspace(WORKSPACE_A, 'A renamed');
  state().reconcileWorkspaceList([a, b], SESSION_A);
  assertActiveWorkspaceIsVisible();
  state().setWorkspaces([renamedA, b]);
  assertActiveWorkspaceIsVisible();
  state().selectWorkspace(WORKSPACE_B);

  assert.deepEqual(state().workspaces, [renamedA, b]);
  assertActiveWorkspaceIsVisible();
});

test('removing another workspace then selecting preserves the latest mutation snapshot', () => {
  const a = workspace(WORKSPACE_A, 'A');
  const b = workspace(WORKSPACE_B, 'B');
  const renamedA = workspace(WORKSPACE_A, 'A renamed');
  const created = workspace(WORKSPACE_C, 'C');
  state().reconcileWorkspaceList([a, b], SESSION_A);
  assertActiveWorkspaceIsVisible();
  state().setWorkspaces([renamedA, b, created]);
  assertActiveWorkspaceIsVisible();
  state().removeWorkspace(WORKSPACE_C);
  assertActiveWorkspaceIsVisible();
  state().selectWorkspace(WORKSPACE_B);

  assert.deepEqual(state().workspaces, [renamedA, b]);
  assertActiveWorkspaceIsVisible();
});

test('a pinned notification workspace stays temporary across domain mutations and is revoked alone', () => {
  const a = workspace(WORKSPACE_A, 'A');
  const renamedA = workspace(WORKSPACE_A, 'A renamed');
  const b = workspace(WORKSPACE_B, 'B');
  const created = workspace(WORKSPACE_C, 'C');
  state().reconcileWorkspaceList([a], SESSION_A);
  assertActiveWorkspaceIsVisible();
  state().authorizeNotificationTargetWorkspace(SESSION_A, b);
  assertActiveWorkspaceIsVisible();
  state().setWorkspaces([renamedA, b, created]);
  assertActiveWorkspaceIsVisible();

  assert.deepEqual(state().canonicalWorkspaces, [renamedA, created]);
  assert.deepEqual(state().workspaces, [renamedA, created, b]);
  assertActiveWorkspaceIsVisible();

  state().selectWorkspace(WORKSPACE_B);
  assertActiveWorkspaceIsVisible();
  state().removeWorkspace(WORKSPACE_C);
  assertActiveWorkspaceIsVisible();
  assert.deepEqual(state().canonicalWorkspaces, [renamedA]);
  assert.deepEqual(state().workspaces, [renamedA, b]);
  assertActiveWorkspaceIsVisible();

  state().selectWorkspace(WORKSPACE_A);
  assert.deepEqual(state().canonicalWorkspaces, [renamedA]);
  assert.deepEqual(state().workspaces, [renamedA]);
  assert.equal(state().notificationTargetWorkspace, null);
  assertActiveWorkspaceIsVisible();

  state().authorizeNotificationTargetWorkspace(SESSION_A, b);
  state().selectWorkspace(WORKSPACE_B);
  state().revokeNotificationTargetWorkspace(SESSION_A, WORKSPACE_B);
  assertActiveWorkspaceIsVisible();
  assert.deepEqual(state().canonicalWorkspaces, [renamedA]);
  assert.deepEqual(state().workspaces, [renamedA]);
  assert.equal(state().activeWorkspaceId, WORKSPACE_A);
  assertActiveWorkspaceIsVisible();

  state().clear();
  assert.deepEqual(state().workspaces, []);
  assert.equal(state().activeWorkspaceId, null);
  assertActiveWorkspaceIsVisible();
});

test('authorizing a workspace for a new session never leaves a stale active selection', () => {
  const oldWorkspace = workspace(WORKSPACE_A, 'Old account');
  const newWorkspace = workspace(WORKSPACE_B, 'New account');
  state().reconcileWorkspaceList([oldWorkspace], SESSION_A);
  assertActiveWorkspaceIsVisible();
  state().authorizeNotificationTargetWorkspace(SESSION_B, newWorkspace);

  assert.deepEqual(state().workspaces, [newWorkspace]);
  assertActiveWorkspaceIsVisible();
});
