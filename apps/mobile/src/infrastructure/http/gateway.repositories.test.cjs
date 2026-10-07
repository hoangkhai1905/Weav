const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const axios = require('axios');
const { httpClient } = require('./http-client.ts');
const { HttpWorkflowRepository } = require('./http-workflow.repository.ts');
const { HttpExecutionRepository } = require('./http-execution.repository.ts');

const WS = '11111111-1111-4111-8111-111111111111';
const WF_A = '22222222-2222-4222-8222-222222222222';
const WF_B = '33333333-3333-4333-8333-333333333333';
const EX = '44444444-4444-4444-8444-444444444444';

const originalRequest = httpClient.request;
afterEach(() => {
  httpClient.request = originalRequest;
});

function httpError(status, code) {
  return new axios.AxiosError('failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    data: { error: { code, message: 'boom' } },
    headers: {},
  });
}

const workflow = (workflowId) => ({
  workflowId,
  name: workflowId,
  description: null,
  status: 'PUBLISHED',
  schemaVersion: '1.0',
  currentVersionId: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  publishedAt: null,
});

const execution = (executionId, workflowId, createdAt) => ({
  executionId,
  workflowId,
  workflowVersionId: 'v',
  status: 'SUCCESS',
  triggerType: 'MANUAL',
  createdAt,
  startedAt: null,
  finishedAt: null,
});

test('run uses a fresh Idempotency-Key per call and reuses it when retrying a 504', async () => {
  const seen = [];
  httpClient.request = async (config) => {
    seen.push(config.headers['Idempotency-Key']);
    if (seen.length === 1) throw httpError(504, 'UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN');
    return {
      data: { executionId: 'e', workflowId: WF_A, workflowVersionId: 'v', status: 'QUEUED' },
    };
  };
  const repo = new HttpWorkflowRepository();
  const first = await repo.runWorkflow(WS, WF_A);
  assert.equal(first.executionId, 'e');
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);

  await repo.runWorkflow(WS, WF_A);
  assert.notEqual(seen[2], seen[0]);
});

test('run does not retry a non-timeout failure (422 INVALID_STATE)', async () => {
  let calls = 0;
  httpClient.request = async () => {
    calls += 1;
    throw httpError(422, 'INVALID_STATE');
  };
  await assert.rejects(
    new HttpWorkflowRepository().runWorkflow(WS, WF_A),
    (error) => error.code === 'INVALID_STATE' && error.status === 422,
  );
  assert.equal(calls, 1);
});

test('recent workspace executions merge workflows, sort newest first and skip 403', async () => {
  httpClient.request = async (config) => {
    if (config.url.endsWith('/workflows')) {
      assert.deepEqual(config.params, { page: 0, size: 20 });
      return { data: { items: [workflow(WF_A), workflow(WF_B)], page: 0, size: 20, totalElements: 2 } };
    }
    assert.deepEqual(config.params, { page: 0, size: 10 });
    if (config.url.includes(WF_B)) throw httpError(403, 'FORBIDDEN');
    return {
      data: {
        items: [
          execution('old', WF_A, '2026-09-01T00:00:00Z'),
          execution('new', WF_A, '2026-09-02T00:00:00Z'),
        ],
        page: 0,
        size: 10,
        totalElements: 2,
        hasNext: false,
      },
    };
  };
  const result = await new HttpExecutionRepository().listRecentWorkspaceExecutions(WS);
  assert.deepEqual(result.map((e) => e.executionId), ['new', 'old']);
});

test('execution lookup probes workflows and returns the matching workflowId (or null)', async () => {
  const detail = (workflowId) => ({
    ...execution(EX, workflowId, '2026-09-01T00:00:00Z'),
    nodes: [],
    logs: { items: [], page: 0, size: 1, totalElements: 0, hasNext: false },
  });
  httpClient.request = async (config) => {
    if (config.url.endsWith('/workflows')) {
      return { data: { items: [workflow(WF_A), workflow(WF_B)], page: 0, size: 50, totalElements: 2 } };
    }
    if (config.url.includes(`${WF_B}/executions/${EX}`)) return { data: detail(WF_B) };
    throw httpError(404, 'NOT_FOUND');
  };
  const repo = new HttpExecutionRepository();
  assert.equal(await repo.findWorkflowIdForExecution(WS, EX), WF_B);
  assert.equal(
    await repo.findWorkflowIdForExecution(WS, '55555555-5555-4555-8555-555555555555'),
    null,
  );
});
