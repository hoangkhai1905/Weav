const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const {
  buildExecutionListRequest,
  buildExecutionDetailRequest,
} = require('./execution.http.contract.ts');

const WS = '11111111-1111-4111-8111-111111111111';
const WF = '22222222-2222-4222-8222-222222222222';
const EX = '33333333-3333-4333-8333-333333333333';

test('lists executions through the workflow, never workspace-wide', () => {
  assert.deepEqual(buildExecutionListRequest(WS, WF, { page: 0, size: 10 }), {
    url: `/api/v1/workspaces/${WS}/workflows/${WF}/executions`,
    params: { page: 0, size: 10 },
  });
  assert.throws(() => buildExecutionListRequest(WS, WF, { size: 500 }), /size/i);
});

test('detail needs workflowId and maps log paging to logPage/logSize', () => {
  assert.deepEqual(buildExecutionDetailRequest(WS, WF, EX, { logPage: 1, logSize: 50 }), {
    url: `/api/v1/workspaces/${WS}/workflows/${WF}/executions/${EX}`,
    params: { logPage: 1, logSize: 50 },
  });
  assert.deepEqual(buildExecutionDetailRequest(WS, WF, EX).params, {});
  assert.throws(() => buildExecutionDetailRequest(WS, WF, 'nope'), /execution/i);
  assert.throws(() => buildExecutionDetailRequest(WS, WF, EX, { logSize: 101 }), /size/i);
});
