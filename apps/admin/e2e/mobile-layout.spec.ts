import { expect, test } from '@playwright/test';
import { GATEWAY, json, signedInAs } from './support.js';

const LONG = 'a-very-long-name-that-keeps-going-and-going-to-force-a-wide-table-row-on-phones';

test.use({ viewport: { width: 375, height: 812 } });

test('wide tables scroll inside their wrapper and never widen the page on a phone', async ({ page }) => {
  await signedInAs(page, { id: 'u1', email: 'root@weav.test', displayName: 'Root' });
  const paged = { page: 0, size: 20, totalElements: 1, totalPages: 1 };
  await page.route(`${GATEWAY}/api/admin/users**`, (route) =>
    json(route, 200, {
      items: [{ id: 'u2', email: `${LONG}@example.com`, displayName: LONG, systemRole: 'USER', status: 'ACTIVE', createdAt: '2026-03-04T12:00:00Z', emailVerifiedAt: null, avatarPresent: false }],
      ...paged,
      totalItems: 1,
    }));
  await page.route(`${GATEWAY}/api/admin/workspaces**`, (route) =>
    json(route, 200, { items: [{ id: 'wA', name: LONG, ownerId: 'u9', ownerEmail: `${LONG}@example.com`, ownerDisplayName: LONG, memberCount: 3, createdAt: '2026-04-01T12:00:00Z' }], ...paged }));
  await page.route(`${GATEWAY}/api/admin/executions**`, (route) =>
    json(route, 200, {
      items: [{ executionId: 'e1', workflowId: 'wf1', workflowName: LONG, workspaceId: 'wA', status: 'SUCCESS', triggerType: 'MANUAL', createdAt: '2026-05-01T09:00:00Z', startedAt: '2026-05-01T09:00:01Z', durationMs: 1234, errorCode: null }],
      page: 0, size: 20, totalElements: 1, hasNext: false,
    }));
  await page.route(`${GATEWAY}/api/v1/templates**`, (route) =>
    json(route, 200, { items: [{ id: 't1', name: LONG, description: LONG, authorName: LONG, nodeTypes: ['trigger.manual'], visibility: 'PUBLIC', usageCount: 1, createdAt: '2026-03-04T10:00:00Z', updatedAt: '2026-03-05T10:00:00Z', owned: false }], ...paged }));

  for (const [path, row] of [['/users', 'user-row'], ['/workspaces', 'workspace-row'], ['/executions', 'execution-row'], ['/templates', 'template-row']]) {
    await page.goto(path);
    await expect(page.getByTestId(row)).toHaveCount(1);
    const { scrollWidth, innerWidth } = await page.evaluate<{ scrollWidth: number; innerWidth: number }>('({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })'); // string form: e2e is type-checked without the DOM lib
    expect(innerWidth, path).toBe(375);
    expect(scrollWidth, path).toBeLessThanOrEqual(innerWidth);
  }
});
