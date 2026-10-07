const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { countWorkflowsByStatus, summarizeRuns, collectAttention } = require('./dashboard.stats.ts');

const run = (id, status, createdAt = '2026-10-07T10:00:00Z', workflowId = 'w1') => ({
  executionId: id,
  workflowId,
  status,
  createdAt,
});

test('workflows are counted by status', () => {
  assert.deepEqual(
    countWorkflowsByStatus([{ status: 'DRAFT' }, { status: 'PUBLISHED' }, { status: 'PUBLISHED' }, { status: 'PAUSED' }]),
    { DRAFT: 1, PUBLISHED: 2, PAUSED: 1 },
  );
  assert.deepEqual(countWorkflowsByStatus([]), { DRAFT: 0, PUBLISHED: 0, PAUSED: 0 });
});

test('run summary describes only the loaded sample; success rate ignores unfinished runs', () => {
  const s = summarizeRuns([
    run('a', 'SUCCESS'),
    run('b', 'SUCCESS'),
    run('c', 'FAILED'),
    run('d', 'RUNNING'),
    run('e', 'QUEUED'),
    run('f', 'CANCELLED'),
  ]);
  assert.deepEqual(s, { sample: 6, active: 2, success: 2, failed: 1, cancelled: 1, successRate: 67 });
  assert.equal(summarizeRuns([run('a', 'RUNNING')]).successRate, null);
  assert.equal(summarizeRuns([]).successRate, null);
});

test('attention: newest 3 failed runs, disabled triggers, invalid connections', () => {
  const executions = [
    run('f1', 'FAILED', '2026-10-07T01:00:00Z'),
    run('f2', 'FAILED', '2026-10-07T04:00:00Z'),
    run('ok', 'SUCCESS', '2026-10-07T05:00:00Z'),
    run('f3', 'FAILED', '2026-10-07T03:00:00Z'),
    run('f4', 'FAILED', '2026-10-07T02:00:00Z'),
  ];
  const items = collectAttention({
    executions,
    workflows: [
      { workflowId: 'w1', name: 'A', triggers: [{ status: 'ACTIVE', reasonCode: null }] },
      { workflowId: 'w2', name: 'B', triggers: [{ status: 'DISABLED', reasonCode: 'CONNECTION_RECONNECT_REQUIRED' }] },
    ],
    connections: [
      { id: 'c1', name: 'Gmail', provider: 'GMAIL', status: 'INVALID' },
      { id: 'c2', name: 'Sheet', provider: 'GOOGLE_SHEETS', status: 'ACTIVE' },
    ],
  });
  assert.deepEqual(items.map((i) => i.key), ['run:f2', 'run:f3', 'run:f4', 'trigger:w2', 'conn:c1']);
  assert.equal(items[3].reasonCode, 'CONNECTION_RECONNECT_REQUIRED');
  assert.deepEqual(collectAttention({ executions: [], workflows: [], connections: [] }), []);
});
