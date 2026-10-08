const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { mapExecutionPage, mapExecution } = require('./execution.mapper.ts');

const summary = (overrides = {}) => ({
  executionId: 'e1',
  workflowId: 'w1',
  workflowVersionId: 'v1',
  status: 'WAITING',
  triggerType: 'MANUAL',
  createdAt: '2026-09-01T00:00:00Z',
  startedAt: '2026-09-01T00:00:01Z',
  finishedAt: '2026-09-01T00:00:04Z',
  ...overrides,
});

const pageOf = (items) => ({ items, page: 0, size: 10, totalElements: items.length, hasNext: false });

test('maps execution pages with WAITING status and a derived duration', () => {
  const page = mapExecutionPage(pageOf([summary()]));
  assert.equal(page.items[0].status, 'WAITING');
  assert.equal(page.items[0].durationMs, 3000);
  assert.equal(page.hasNext, false);
  assert.equal(
    mapExecutionPage(pageOf([summary({ startedAt: null, finishedAt: null })])).items[0].durationMs,
    null,
  );
  assert.throws(() => mapExecutionPage(pageOf([summary({ status: 'PAUSED' })])), /status/);
});

test('maps detail nodes (READY/SKIPPED), attempts and DEBUG/WARN logs', () => {
  const detail = mapExecution({
    ...summary({ status: 'FAILED' }),
    nodes: [
      {
        nodeExecutionId: 'ne1',
        nodeId: 'n1',
        nodeType: 'http.request',
        status: 'READY',
        attemptCount: 0,
        startedAt: null,
        finishedAt: null,
        output: null,
        error: null,
        attempts: [],
      },
      {
        nodeExecutionId: 'ne2',
        nodeId: 'n2',
        nodeType: 'email.send',
        status: 'SKIPPED',
        attemptCount: 2,
        startedAt: '2026-09-01T00:00:01Z',
        finishedAt: '2026-09-01T00:00:02Z',
        output: null,
        error: { code: 'X' },
        attempts: [
          {
            attemptId: 'a1',
            attemptNumber: 1,
            status: 'FAILED',
            startedAt: null,
            finishedAt: null,
            output: null,
            error: { message: 'boom' },
          },
        ],
      },
    ],
    logs: {
      items: [
        { id: 'l1', nodeExecutionId: null, attemptId: null, level: 'DEBUG', eventType: 'x', message: null, metadata: null, createdAt: '2026-09-01T00:00:01Z' },
        { id: 'l2', nodeExecutionId: 'ne2', attemptId: 'a1', level: 'WARN', eventType: 'y', message: 'm', metadata: { k: 1 }, createdAt: '2026-09-01T00:00:02Z' },
      ],
      page: 0,
      size: 20,
      totalElements: 2,
      hasNext: false,
    },
  });
  assert.equal(detail.nodes[0].status, 'READY');
  assert.equal(detail.nodes[1].durationMs, 1000);
  assert.deepEqual(detail.nodes[1].error, { code: 'X' });
  assert.equal(detail.nodes[1].attempts[0].attemptNumber, 1);
  assert.deepEqual(detail.logs.items.map((l) => l.level), ['DEBUG', 'WARN']);
  assert.deepEqual(detail.logs.items[0].metadata, {});
  assert.throws(
    () =>
      mapExecution({
        ...summary(),
        nodes: [],
        logs: {
          items: [{ id: 'l', nodeExecutionId: null, attemptId: null, level: 'SUCCESS', eventType: 'x', message: null, createdAt: 'a' }],
          page: 0,
          size: 1,
          totalElements: 1,
          hasNext: false,
        },
      }),
    /level/,
  );
});
