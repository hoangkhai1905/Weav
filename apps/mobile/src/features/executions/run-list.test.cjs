const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { filterRuns, matchesRunFilter, parseRunFilter } = require('./run-list.ts');

const run = (executionId, workflowId, status) => ({ executionId, workflowId, status });
const runs = [
  run('aaaa-1', 'w1', 'FAILED'),
  run('bbbb-2', 'w1', 'SUCCESS'),
  run('cccc-3', 'w2', 'RUNNING'),
  run('dddd-4', 'w2', 'QUEUED'),
  run('eeee-5', 'w3', 'CANCELLED'),
];
const names = { w1: 'Gửi hóa đơn', w2: 'Báo đơn hàng', w3: 'Nhắc lịch' };
const nameOf = (id) => names[id];

test('result filters group queued and waiting runs with running ones', () => {
  assert.deepEqual(filterRuns(runs, 'failed', '', nameOf).map((r) => r.executionId), ['aaaa-1']);
  assert.deepEqual(filterRuns(runs, 'success', '', nameOf).map((r) => r.executionId), ['bbbb-2']);
  assert.deepEqual(filterRuns(runs, 'running', '', nameOf).map((r) => r.executionId), ['cccc-3', 'dddd-4']);
  assert.equal(filterRuns(runs, 'all', '', nameOf).length, 5);
  // A cancelled run is only listed under "all".
  assert.equal(matchesRunFilter('CANCELLED', 'failed'), false);
  assert.equal(matchesRunFilter('CANCELLED', 'all'), true);
});

test('search finds a run by workflow name without accents or by run id', () => {
  assert.deepEqual(filterRuns(runs, 'all', 'hoa don', nameOf).map((r) => r.executionId), ['aaaa-1', 'bbbb-2']);
  assert.deepEqual(filterRuns(runs, 'all', 'CCCC', nameOf).map((r) => r.executionId), ['cccc-3']);
  assert.deepEqual(filterRuns(runs, 'failed', 'bao don', nameOf), []);
});

test('the filter route parameter falls back to all', () => {
  assert.equal(parseRunFilter('failed'), 'failed');
  assert.equal(parseRunFilter(['running']), 'running');
  assert.equal(parseRunFilter('nonsense'), 'all');
  assert.equal(parseRunFilter(undefined), 'all');
});
