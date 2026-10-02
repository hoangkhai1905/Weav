const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getMilestoneToastCopy } = require('./milestone-toast.copy.ts');

test('provides localized copy for successful milestones without claiming workflow completion', () => {
  for (const language of ['VI', 'EN']) {
    for (const key of [
      'workspace.created',
      'workspace.renamed',
      'workspace.member_added',
      'workspace.permissions_updated',
      'workspace.member_removed',
      'workspace.left',
      'workflow.paused',
      'workflow.resumed',
      'workflow.started',
      'profile.updated',
      'connection.verified',
      'auth.password_changed',
      'auth.password_reset',
    ]) {
      const copy = getMilestoneToastCopy(key, language);
      assert.ok(copy.title.length > 0);
      assert.ok(copy.message.length > 0);
    }
    const run = getMilestoneToastCopy('workflow.started', language);
    assert.doesNotMatch(`${run.title} ${run.message}`, /completed|hoàn tất/i);
  }
});
