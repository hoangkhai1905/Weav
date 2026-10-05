import { expect, test, type Route } from '@playwright/test';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000010';
const WORKFLOW_COUNT = 30;
const wfId = (i: number) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`;
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const summary = (i: number) => ({
  workflowId: wfId(i),
  name: `Workflow ${i}`,
  description: null,
  status: i % 5 === 0 ? 'DRAFT' : 'PUBLISHED',
  schemaVersion: '1.0',
  currentVersionId: null,
  createdAt: iso(10_000),
  updatedAt: iso(60),
  publishedAt: null,
});

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('Dashboard to Workflows to run history and back stays within the API request budget', async ({ page }) => {
  const counts = new Map<string, number>();
  let total = 0;
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'playwright-test-token');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/') || url.pathname.includes('/notifications')) return;
    total += 1;
    const key = `${request.method()} ${url.pathname.replace(/[0-9a-f-]{36}/g, ':id')}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return json(route, { id: userId, email: 'test@example.test', displayName: 'Playwright User' });
    if (path === '/api/v1/workspaces') return json(route, {
      items: [{ id: workspaceId, name: 'Real Workspace', createdBy: userId, createdAt: iso(99_999), updatedAt: iso(99_999), role: 'OWNER' }],
      page: 0, size: 100, totalElements: 1, totalPages: 1,
    });
    if (path.includes('/notifications')) return json(route, path.includes('unread') ? { unreadCount: 0 } : { items: [], nextCursor: null });
    const base = `/api/v1/workspaces/${workspaceId}/workflows`;
    if (path === base) return json(route, { items: Array.from({ length: WORKFLOW_COUNT }, (_, i) => summary(i + 1)), page: 0, size: 100, totalElements: WORKFLOW_COUNT });
    const executions = path.match(new RegExp(`${base}/([^/]+)/executions$`));
    if (executions) {
      return json(route, {
        items: [{ executionId: `${executions[1]}-run`, workflowId: executions[1], workflowVersionId: executions[1], status: 'SUCCESS', triggerType: 'MANUAL', createdAt: iso(30), startedAt: iso(30), finishedAt: iso(29) }],
        page: 0, size: 50, totalElements: 1,
      });
    }
    const detail = path.match(new RegExp(`${base}/([^/]+)$`));
    if (detail) {
      const index = Number(detail[1].slice(-2));
      return json(route, { ...summary(index), definition: { schemaVersion: '1.0', nodes: [], edges: [], variables: {} }, editorState: { nodes: {} }, triggers: [] });
    }
    return json(route, { items: [], page: 0, size: 20, totalElements: 0 });
  });

  await page.goto('/dashboard');
  await expect(page.getByText('Workflow 1', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Workflows', exact: true }).first().click();
  const rows = page.getByTestId('workflow-row');
  await expect(rows).toHaveCount(WORKFLOW_COUNT);
  await rows.first().getByRole('button', { name: 'More workflow actions' }).click();
  await page.getByRole('menuitem', { name: 'Executions' }).click();
  await expect(page.getByTestId('executions-tripane')).toBeVisible();
  await expect(page.getByTestId('execution-run-item').first()).toBeVisible();

  await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
  await expect(page.getByText('Workflow 1', { exact: true }).first()).toBeVisible();

  // eslint-disable-next-line no-console
  console.log('API_REQUESTS', total, JSON.stringify([...counts.entries()]));
  expect(total).toBeLessThan(25);
});
