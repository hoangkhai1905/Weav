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

test('create, saveDraft, publish and delete build the documented requests', () => {
  const c = require('./workflow.http.contract.ts');
  const base = `/api/v1/workspaces/${WS}/workflows`;
  assert.deepEqual(c.buildCreateWorkflowRequest(WS, { name: 'A' }), {
    method: 'POST',
    url: base,
    data: { name: 'A' },
  });
  assert.throws(() => c.buildCreateWorkflowRequest(WS, { name: '  ' }), /name/i);
  assert.throws(() => c.buildCreateWorkflowRequest(WS, { name: 'x'.repeat(256) }), /name/i);
  assert.throws(() => c.buildCreateWorkflowRequest(WS, { name: 'A', description: 'x'.repeat(2001) }), /description/i);

  const definition = { schemaVersion: '1.0', nodes: [], edges: [] };
  assert.deepEqual(c.buildSaveDraftRequest(WS, WF, { name: 'A', definition, expectedRevision: 3 }), {
    method: 'PUT',
    url: `${base}/${WF}/draft`,
    data: { name: 'A', definition, expectedRevision: 3 },
  });
  assert.throws(() => c.buildSaveDraftRequest(WS, WF, { name: 'A', definition, expectedRevision: -1 }), /revision/i);

  assert.deepEqual(c.buildPublishWorkflowRequest(WS, WF), { method: 'POST', url: `${base}/${WF}/publish` });
  assert.deepEqual(c.buildDeleteWorkflowRequest(WS, WF), { method: 'DELETE', url: `${base}/${WF}` });
  assert.throws(() => c.buildDeleteWorkflowRequest(WS, 'x'), /workflow/i);
});

test('publication mapper keeps the one-time webhook secret and rejects bad shapes', () => {
  const { mapWorkflowPublication, mapWorkflowCreated } = require('./workflow.mapper.ts');
  const dto = {
    workflowId: WF,
    versionId: WS,
    version: 2,
    status: 'PUBLISHED',
    webhooks: [{ triggerId: WF, endpointKey: 'k'.repeat(32), secret: 's'.repeat(43) }],
  };
  assert.equal(mapWorkflowPublication(dto).webhooks[0].secret, 's'.repeat(43));
  assert.throws(() => mapWorkflowPublication({ ...dto, status: 'DRAFT' }), /status/);
  assert.deepEqual(mapWorkflowCreated({ workflowId: WF, status: 'DRAFT' }), { workflowId: WF, status: 'DRAFT' });
});
