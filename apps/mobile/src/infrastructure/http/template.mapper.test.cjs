const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const {
  mapTemplateSummary,
  mapTemplatePage,
  mapTemplateDetail,
  mapTemplateUsed,
} = require('./template.mapper.ts');

const summary = (overrides = {}) => ({
  id: 't1',
  name: 'Hoa don',
  description: null,
  authorName: 'Khai',
  nodeTypes: ['trigger.gmail', 'email.send'],
  visibility: 'PUBLIC',
  usageCount: 3,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
  owned: false,
  ...overrides,
});

test('maps a template summary and rejects malformed ones', () => {
  const item = mapTemplateSummary(summary());
  assert.equal(item.description, null);
  assert.deepEqual(item.nodeTypes, ['trigger.gmail', 'email.send']);
  assert.equal(mapTemplateSummary(summary({ authorName: undefined })).authorName, null);
  assert.throws(() => mapTemplateSummary(summary({ visibility: 'SECRET' })), /visibility/);
  assert.throws(() => mapTemplateSummary(summary({ usageCount: '3' })), /usageCount/);
  assert.throws(() => mapTemplateSummary(summary({ nodeTypes: [1] })), /nodeTypes/);
  assert.throws(() => mapTemplateSummary(summary({ owned: undefined })), /owned/);
  assert.throws(() => mapTemplateSummary(null), /template/);
});

test('page derives hasNext from totalElements', () => {
  const page = mapTemplatePage({ items: [summary()], page: 0, size: 20, totalElements: 21 });
  assert.equal(page.hasNext, true);
  assert.equal(page.items.length, 1);
  assert.equal(mapTemplatePage({ items: [], page: 1, size: 20, totalElements: 21 }).hasNext, false);
  assert.throws(() => mapTemplatePage({ items: {}, page: 0, size: 20, totalElements: 0 }), /items/);
  assert.throws(() => mapTemplatePage({ items: [], page: 0, size: 20 }), /totalElements/);
});

test('detail keeps only id and type of each step, and the share code when present', () => {
  const definition = { schemaVersion: '1.0', nodes: [{ id: 'a', type: 'trigger.gmail', config: { x: 1 } }], edges: [] };
  const owned = mapTemplateDetail({ ...summary({ owned: true }), definition, editorState: {}, shareCode: 'WV7K3M9Q' });
  assert.deepEqual(owned.nodes, [{ id: 'a', type: 'trigger.gmail' }]);
  assert.equal(owned.shareCode, 'WV7K3M9Q');
  assert.equal(mapTemplateDetail({ ...summary(), definition }).shareCode, null);
  assert.throws(() => mapTemplateDetail(summary()), /definition/);
  assert.throws(() => mapTemplateDetail({ ...summary(), definition: { nodes: [{ id: 'a' }] } }), /node/);
});

test('use answer needs a workflowId', () => {
  assert.deepEqual(mapTemplateUsed({ workflowId: 'w1' }), { workflowId: 'w1' });
  assert.throws(() => mapTemplateUsed({}), /workflowId/);
});
