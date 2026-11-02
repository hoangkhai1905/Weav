import { expect, test, type Page, type Route } from '@playwright/test';
import { STUB_WORKSPACE_ID, getOnly, openStubbedBuilder, registerApiFallback } from './support/http-builder.js';

const VIEWPORT = { width: 390, height: 844 };
const USER_ID = '00000000-0000-4000-8000-000000000110';
const WORKFLOW_ID = '00000000-0000-4000-8000-000000000102';
const WORKFLOW_NAME = 'Customer onboarding sync for the sales team';

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const pageOf = (items: unknown[]) => ({ items, page: 0, size: 100, totalElements: items.length, totalPages: 1, hasNext: false });

test.use({ viewport: VIEWPORT, hasTouch: true });

async function expectNoHorizontalOverflow(page: Page) {
  const scrollWidth = await page.evaluate(() => (globalThis as unknown as { document: { documentElement: { scrollWidth: number } } }).document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(VIEWPORT.width);
}

async function expectInsideViewport(page: Page, testId: string) {
  const locator = page.getByTestId(testId);
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${testId} has a box`).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(VIEWPORT.width);
}

async function stubListApi(page: Page) {
  const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const workspace = { id: STUB_WORKSPACE_ID, name: 'Weav Test Workspace', role: 'OWNER', createdBy: USER_ID, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' };
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'playwright-test-token');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await registerApiFallback(page);
  await page.route('**/api/auth/me', getOnly((route: Route) => route.fulfill(json({ id: USER_ID, email: 'ui@example.test', displayName: 'UI Tester', systemRole: 'USER', status: 'ACTIVE' }))));
  await page.route('**/api/v2/notifications**', getOnly((route: Route) => route.fulfill(json(route.request().url().includes('unread-count') ? { count: 0 } : { items: [], nextCursor: null }))));
  await page.route('**/api/v1/workspaces?**', getOnly((route: Route) => route.fulfill(json(pageOf([workspace])))));
  await page.route(`**/api/v1/workspaces/${STUB_WORKSPACE_ID}`, getOnly((route: Route) => route.fulfill(json(workspace))));
  await page.route(`**/api/v1/workspaces/${STUB_WORKSPACE_ID}/members**`, getOnly((route: Route) => route.fulfill(json(pageOf([])))));
  await page.route(`**/api/v1/workspaces/${STUB_WORKSPACE_ID}/workflows?**`, getOnly((route: Route) => route.fulfill(json(pageOf([{
    workflowId: WORKFLOW_ID,
    name: WORKFLOW_NAME,
    description: null,
    status: 'PUBLISHED',
    schemaVersion: '1.0',
    currentVersionId: null,
    createdAt: '2026-09-25T10:00:00Z',
    updatedAt: '2026-09-25T10:00:00Z',
    publishedAt: '2026-09-25T10:00:00Z',
  }])))));
  await page.route(`**/api/v1/workspaces/${STUB_WORKSPACE_ID}/monitoring/summary**`, getOnly((route: Route) => route.fulfill(json({
    days: 7, from: startedAt, to: startedAt,
    workflows: { published: 1, paused: 0, draft: 0 },
    runs: { total: 1, today: 1, success: 1, failed: 0, active: 0 },
    successRate: 1, averageDurationMs: 1000, p95DurationMs: 1000,
    trend: [{ date: startedAt.slice(0, 10), total: 1, success: 1, failed: 0 }],
    topFailingWorkflows: [], recentFailures: [],
  }))));
  await page.route((url) => url.pathname === `/api/v1/workspaces/${STUB_WORKSPACE_ID}/executions`, getOnly((route: Route) => route.fulfill(json({
    items: [{
      executionId: '00000000-0000-4000-8000-000000000106',
      workflowId: WORKFLOW_ID,
      workflowName: WORKFLOW_NAME,
      status: 'SUCCESS',
      triggerType: 'MANUAL',
      createdAt: startedAt, startedAt, finishedAt: startedAt, durationMs: 1000, errorCode: null, errorMessage: null,
    }],
    page: 0, size: 6, totalElements: 1, hasNext: false,
  }))));
}

test('workflows list fits a phone without clipping', async ({ page }) => {
  await stubListApi(page);
  await page.goto('/workflows');
  const name = page.getByRole('link', { name: WORKFLOW_NAME });
  await expect(name).toBeVisible();
  const box = await name.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(VIEWPORT.width);
  await expectNoHorizontalOverflow(page);
  const row = page.getByTestId('workflow-row').first();
  const rowBox = await row.boundingBox();
  expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(VIEWPORT.width);
  expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('dashboard recent runs fit a phone without clipping', async ({ page }) => {
  await stubListApi(page);
  await page.goto('/dashboard');
  const runs = page.getByTestId('dashboard-recent-runs');
  const link = runs.getByRole('link', { name: new RegExp(WORKFLOW_NAME) });
  await expect(link).toBeVisible();
  const box = await link.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(VIEWPORT.width);
  await expectNoHorizontalOverflow(page);
  expect(await runs.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('builder keeps Publish and Save on screen and fits the graph', async ({ page }) => {
  await openStubbedBuilder(page);
  await expectInsideViewport(page, 'workflow-publish');
  await expectInsideViewport(page, 'workflow-save');
  await expectNoHorizontalOverflow(page);
  await expect(page.getByTestId('workflow-title')).toHaveValue('Catalog fixture');

  // Every node of the starter graph is inside the viewport after the initial fit.
  for (const id of ['node-manual', 'node-webhook', 'node-extract', 'node-condition', 'node-notify']) {
    const node = page.getByTestId(`rf__node-${id}`);
    await expect(node).toBeVisible();
    const box = await node.boundingBox();
    expect(box!.x, `${id} left`).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width, `${id} right`).toBeLessThanOrEqual(VIEWPORT.width + 1);
  }

  // The secondary actions live in the overflow menu, which closes on Escape.
  const more = page.getByTestId('workflow-more-actions');
  await expect(more).toHaveAttribute('aria-haspopup', 'menu');
  await more.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByTestId('workflow-more-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});
