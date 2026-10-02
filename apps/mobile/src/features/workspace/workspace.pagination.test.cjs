const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAllPages } = require('./workspace.pagination.ts');

test('loads every page instead of treating the first page as the complete collection', async () => {
  const requests = [];
  const pages = [
    { items: [{ id: 'workspace-1' }], page: 0, size: 1, totalElements: 2, totalPages: 2 },
    { items: [{ id: 'workspace-2' }], page: 1, size: 1, totalElements: 2, totalPages: 2 },
  ];

  const result = await loadAllPages(
    async (page) => {
      requests.push(page);
      return pages[page];
    },
    'workspace list',
  );

  assert.deepEqual(requests, [0, 1]);
  assert.deepEqual(result.items, [{ id: 'workspace-1' }, { id: 'workspace-2' }]);
  assert.equal(result.totalElements, 2);
  assert.equal(result.totalPages, 2);
});

test('stops late page results from being applied after the request scope changes', async () => {
  const scope = { current: 'user-a' };
  const pending = loadAllPages(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { items: [{ id: 'old-workspace' }], page: 0, size: 100, totalElements: 1, totalPages: 1 };
    },
    'workspace list',
    () => scope.current === 'user-a',
  );
  scope.current = 'user-b';

  await assert.rejects(pending, /scope changed/i);
});
