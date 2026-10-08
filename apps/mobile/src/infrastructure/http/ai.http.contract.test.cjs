const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { buildGenerateWorkflowRequest, GENERATE_TIMEOUT_MS } = require('./ai.http.contract.ts');

const WS = '11111111-1111-4111-8111-111111111111';
const CN = '44444444-4444-4444-8444-444444444444';

test('generate posts to the workflows/generate route with an 85 s timeout', () => {
  const config = buildGenerateWorkflowRequest(WS, { prompt: 'send a report', timezone: 'Asia/Ho_Chi_Minh' });
  assert.equal(config.method, 'POST');
  assert.equal(config.url, `/api/v1/workspaces/${WS}/workflows/generate`);
  assert.deepEqual(config.data, { prompt: 'send a report', timezone: 'Asia/Ho_Chi_Minh' });
  assert.equal(config.timeout, 85000);
  assert.equal(GENERATE_TIMEOUT_MS, 85000);
});

test('forwards answers and connections, validates them like the server', () => {
  const config = buildGenerateWorkflowRequest(WS, {
    prompt: 'p',
    answers: { 'email.send.body': 'hello' },
    connections: { 'email.send': CN },
  });
  assert.deepEqual(config.data.answers, { 'email.send.body': 'hello' });
  assert.deepEqual(config.data.connections, { 'email.send': CN });
  assert.throws(() => buildGenerateWorkflowRequest(WS, { prompt: '' }), /prompt/i);
  assert.throws(() => buildGenerateWorkflowRequest(WS, { prompt: 'x'.repeat(4001) }), /prompt/i);
  assert.throws(() => buildGenerateWorkflowRequest(WS, { prompt: 'p', connections: { a: 'not-uuid' } }), /connections/i);
  assert.throws(() => buildGenerateWorkflowRequest(WS, { prompt: 'p', answers: { k: ' ' } }), /answers/i);
  assert.throws(
    () => buildGenerateWorkflowRequest(WS, { prompt: 'x'.repeat(3890), answers: { k: 'y'.repeat(50) } }),
    /long/i,
  );
});
