import { expect, test } from '@playwright/test';

const workspaceId = '00000000-0000-4000-8000-000000000101';
const publishedWorkflowId = '00000000-0000-4000-8000-000000000102';
const draftWorkflowId = '00000000-0000-4000-8000-000000000103';

const workflow = (workflowId: string, name: string, status: 'DRAFT' | 'PUBLISHED') => ({
  workflowId,
  name,
  description: `${name} from the Workflow Service`,
  status,
  schemaVersion: '1.0',
  currentVersionId: null,
  createdAt: '2026-09-25T10:00:00Z',
  updatedAt: '2026-09-25T10:00:00Z',
  publishedAt: status === 'PUBLISHED' ? '2026-09-25T10:00:00Z' : null,
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'dashboard-playwright-token');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: '00000000-0000-4000-8000-000000000110',
      email: 'dashboard@example.test',
      displayName: 'Dashboard User',
    }),
  }));
  await page.route('**/api/v1/workspaces**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      items: [{ id: workspaceId, name: 'Dashboard Workspace', role: 'OWNER' }],
      page: 0,
      size: 100,
      totalElements: 1,
      totalPages: 1,
    }),
  }));
});

test('renders real workflow counts and recent runs without demo data', async ({ page }) => {
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows?page=0&size=100`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      items: [
        workflow(publishedWorkflowId, 'Customer sync', 'PUBLISHED'),
        workflow(draftWorkflowId, 'Draft report', 'DRAFT'),
      ],
      page: 0,
      size: 100,
      totalElements: 2,
    }),
  }));

  // Run numbers come from the workspace monitoring endpoints (summary + one recent-runs page).
  const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
  await page.route(`**/api/v1/workspaces/${workspaceId}/monitoring/summary**`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      days: 7,
      from: startedAt,
      to: startedAt,
      workflows: { published: 1, paused: 0, draft: 1 },
      runs: { total: 1, today: 1, success: 1, failed: 0, active: 0 },
      successRate: 1,
      averageDurationMs: 1000,
      p95DurationMs: 1000,
      trend: [{ date: startedAt.slice(0, 10), total: 1, success: 1, failed: 0 }],
      topFailingWorkflows: [],
      recentFailures: [],
    }),
  }));
  await page.route((url) => url.pathname === `/api/v1/workspaces/${workspaceId}/executions`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      items: [{
        executionId: '00000000-0000-4000-8000-000000000106',
        workflowId: publishedWorkflowId,
        workflowName: 'Customer sync',
        status: 'SUCCESS',
        triggerType: 'MANUAL',
        createdAt: startedAt,
        startedAt,
        finishedAt: startedAt,
        durationMs: 1000,
        errorCode: null,
        errorMessage: null,
      }],
      page: 0,
      size: 6,
      totalElements: 1,
      hasNext: false,
    }),
  }));
  await page.goto('/dashboard');

  const dashboard = page.getByTestId('dashboard-real-data');
  await expect(dashboard).toBeVisible();
  await expect(page.getByTestId('dashboard-total-workflows')).toHaveText('2');
  await expect(page.getByTestId('dashboard-published-workflows')).toHaveText('1');
  await expect(dashboard.getByTestId('dashboard-recent-runs')).toContainText('Customer sync');

  // Run numbers come from the real executions API, not placeholders or demo data.
  await expect(page.getByTestId('dashboard-runs-7d')).toHaveText('1');
  await expect(page.getByTestId('dashboard-success-rate-7d')).toHaveText('100%');
  const recentRuns = page.getByTestId('dashboard-recent-runs');
  await expect(recentRuns.getByRole('link', { name: 'View run: Customer sync' })).toHaveAttribute(
    'href',
    `/workflows/${publishedWorkflowId}/executions?run=00000000-0000-4000-8000-000000000106`,
  );
  await expect(dashboard).not.toContainText('#EX-8492');
  await expect(dashboard).not.toContainText('wf-prod-8492');
  await expect(dashboard).not.toContainText('128');
  await expect(dashboard).not.toContainText('97.8%');
});

test('keeps safe quick actions available in HTTP mode without demo workflow ids', async ({ page }) => {
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows?page=0&size=100`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [], page: 0, size: 100, totalElements: 0 }),
  }));

  await page.goto('/dashboard');

  const actions = page.getByTestId('dashboard-quick-actions');
  await expect(actions).toBeVisible();
  await expect(actions.getByRole('link', { name: /^Start from scratch/ })).toHaveAttribute('href', '/workflows/new');
  await expect(actions.getByRole('link', { name: /^Use a ready-made template/ })).toHaveAttribute('href', '/workflows/new#templates-list');
  await actions.getByRole('button', { name: /Describe it/ }).click();
  await expect(page.getByTestId('ai-generator-dialog')).toBeVisible();
  await expect(actions).not.toContainText('wf-prod-8492');
});

test('shows a truthful empty state without demo workflows or execution metrics', async ({ page }) => {
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows?page=0&size=100`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [], page: 0, size: 100, totalElements: 0 }),
  }));

  await page.goto('/dashboard');

  await expect(page.getByTestId('dashboard-workflows-empty')).toBeVisible();
  await expect(page.getByTestId('dashboard-total-workflows')).toHaveText('0');
  await expect(page.getByTestId('dashboard-published-workflows')).toHaveText('0');
  await expect(page.locator('body')).not.toContainText('#EX-8492');
  await expect(page.locator('body')).not.toContainText('128');
});

test('shows a localized workflow error without falling back to demo data', async ({ page }) => {
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows?page=0&size=100`, (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'WORKFLOW_UNAVAILABLE', message: 'Workflow service unavailable' } }),
  }));

  await page.goto('/dashboard');

  await expect(page.getByTestId('dashboard-workflows-error')).toBeVisible();
  await expect(page.getByTestId('dashboard-workflows-error')).toContainText('Workflow data could not be loaded.');
  await expect(page.locator('body')).not.toContainText('Order processing & notification');
  await expect(page.locator('body')).not.toContainText('#EX-8492');
});
