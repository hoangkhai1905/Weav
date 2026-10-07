const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const {
  buildWorkflowListRequest,
  buildWorkflowDetailRequest,
  buildPauseWorkflowRequest,
  buildResumeWorkflowRequest,
  buildRunWorkflowRequest,
  isValidIdempotencyKey,
  newIdempotencyKey,
} = require('./workflow.http.contract.ts');

const WS = '11111111-1111-4111-8111-111111111111';
const WF = '22222222-2222-4222-8222-222222222222';

test('lists workflows under the workspace route with only page/size', () => {
  assert.deepEqual(buildWorkflowListRequest(WS, { page: 0, size: 20 }), {
    url: `/api/v1/workspaces/${WS}/workflows`,
    params: { page: 0, size: 20 },
  });
  assert.deepEqual(buildWorkflowListRequest(WS).params, {});
  assert.throws(() => buildWorkflowListRequest(WS, { size: 101 }), /size/i);
  assert.throws(() => buildWorkflowListRequest(WS, { size: 0 }), /size/i);
  assert.throws(() => buildWorkflowListRequest(WS, { page: -1 }), /page/i);
  assert.throws(() => buildWorkflowListRequest('nope'), /workspace/i);
});

test('detail, pause and resume use the workflow route and validate ids', () => {
  const base = `/api/v1/workspaces/${WS}/workflows/${WF}`;
  assert.equal(buildWorkflowDetailRequest(WS, WF).url, base);
  assert.deepEqual(buildPauseWorkflowRequest(WS, WF), { method: 'POST', url: `${base}/pause` });
  assert.deepEqual(buildResumeWorkflowRequest(WS, WF), { method: 'POST', url: `${base}/resume` });
  assert.throws(() => buildWorkflowDetailRequest(WS, 'x'), /workflow/i);
});

test('run posts {input} with an Idempotency-Key header to /executions', () => {
  const key = 'run:abcdef0123456789';
  assert.deepEqual(buildRunWorkflowRequest(WS, WF, { idempotencyKey: key }), {
    method: 'POST',
    url: `/api/v1/workspaces/${WS}/workflows/${WF}/executions`,
    data: { input: {} },
    headers: { 'Idempotency-Key': key },
  });
  assert.deepEqual(
    buildRunWorkflowRequest(WS, WF, { idempotencyKey: key, input: { a: 1 } }).data,
    { input: { a: 1 } },
  );
  assert.throws(() => buildRunWorkflowRequest(WS, WF, { idempotencyKey: 'short' }), /idempotency/i);
  assert.throws(() => buildRunWorkflowRequest(WS, WF, { idempotencyKey: 'bad key!!!!' }), /idempotency/i);
});

test('generated idempotency keys match the gateway pattern and are unique', () => {
  const a = newIdempotencyKey();
  const b = newIdempotencyKey();
  assert.ok(isValidIdempotencyKey(a));
  assert.notEqual(a, b);
  assert.equal(isValidIdempotencyKey('x'.repeat(129)), false);
});
