const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { commitMilestoneToastIfCurrent } = require('./milestone-toast.policy.ts');

test('emits exactly one localized milestone and refreshes only the current notification prefix', () => {
  const emitted = [];
  let refreshes = 0;
  const committed = commitMilestoneToastIfCurrent('workspace.created', {
    isCurrent: () => true,
    show: (key) => emitted.push(key),
    refreshNotifications: () => { refreshes += 1; },
  });
  assert.equal(committed, true);
  assert.deepEqual(emitted, ['workspace.created']);
  assert.equal(refreshes, 1);
});

test('suppresses toast and notification refresh after a session race', () => {
  const emitted = [];
  let refreshes = 0;
  const committed = commitMilestoneToastIfCurrent('workflow.started', {
    isCurrent: () => false,
    show: (key) => emitted.push(key),
    refreshNotifications: () => { refreshes += 1; },
  });
  assert.equal(committed, false);
  assert.deepEqual(emitted, []);
  assert.equal(refreshes, 0);
});

test('allows a routine localized toast without creating or refreshing inbox data', () => {
  const emitted = [];
  const committed = commitMilestoneToastIfCurrent('profile.updated', {
    isCurrent: () => true,
    show: (key) => emitted.push(key),
  });
  assert.equal(committed, true);
  assert.deepEqual(emitted, ['profile.updated']);
});
