const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const {
  mapWorkflowPage,
  mapWorkflow,
  mapWorkflowRunAccepted,
} = require('./workflow.mapper.ts');

const summary = (overrides = {}) => ({
  workflowId: '22222222-2222-4222-8222-222222222222',
  name: 'Daily report',
  description: null,
  status: 'PUBLISHED',
  schemaVersion: '1.0',
  currentVersionId: '33333333-3333-4333-8333-333333333333',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-02T00:00:00Z',
  publishedAt: '2026-09-02T00:00:00Z',
  ...overrides,
});

test('maps a workflow page and derives hasNext (the endpoint has none)', () => {
  const first = mapWorkflowPage({ items: [summary()], page: 0, size: 1, totalElements: 2 });
  assert.equal(first.items[0].workflowId, '22222222-2222-4222-8222-222222222222');
  assert.equal(first.hasNext, true);
  assert.equal(mapWorkflowPage({ items: [], page: 1, size: 1, totalElements: 2 }).hasNext, false);
  assert.throws(
    () => mapWorkflowPage({ items: [summary({ status: 'ARCHIVED' })], page: 0, size: 1, totalElements: 1 }),
    /status/,
  );
});

test('maps detail: labels come from editorState, fallback null; edges keep sourcePort', () => {
  const wf = mapWorkflow({
    ...summary(),
    revision: 3,
    definition: {
      schemaVersion: '1.0',
      nodes: [
        { id: 'n1', type: 'trigger.manual', config: {} },
        { id: 'n2', type: 'http.request', config: { url: 'https://x.test' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', sourcePort: 'true' }],
    },
    editorState: { nodes: { n1: { name: 'Start', position: { x: 1, y: 2 } } } },
    triggers: [
      {
        triggerId: 't1',
        type: 'SCHEDULE',
        status: 'DISABLED',
        reasonCode: 'CONNECTION_UNAVAILABLE',
        nextRunAt: null,
        lastTriggeredAt: null,
      },
    ],
  });
  assert.equal(wf.revision, 3);
  assert.deepEqual(wf.nodes[0], {
    id: 'n1',
    type: 'trigger.manual',
    config: {},
    name: 'Start',
    position: { x: 1, y: 2 },
  });
  assert.equal(wf.nodes[1].name, null);
  assert.equal(wf.nodes[1].position, null);
  assert.deepEqual(wf.edges, [{ id: 'e1', source: 'n1', target: 'n2', sourcePort: 'true' }]);
  assert.equal(wf.triggers[0].reasonCode, 'CONNECTION_UNAVAILABLE');
});

test('detail without editorState still maps (AI generated workflows)', () => {
  const wf = mapWorkflow({
    ...summary({ status: 'DRAFT' }),
    revision: 0,
    definition: { schemaVersion: '1.0', nodes: [], edges: [] },
    editorState: null,
    triggers: [],
  });
  assert.deepEqual(wf.nodes, []);
});

test('maps the 202 run response and rejects other statuses', () => {
  const ok = mapWorkflowRunAccepted({
    executionId: 'e',
    workflowId: 'w',
    workflowVersionId: 'v',
    status: 'QUEUED',
  });
  assert.equal(ok.executionId, 'e');
  assert.throws(
    () => mapWorkflowRunAccepted({ executionId: 'e', workflowId: 'w', workflowVersionId: 'v', status: 'RUNNING' }),
    /status/,
  );
});
