import { expect, test, type Page, type Route } from '@playwright/test';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workflowId = '00000000-0000-4000-8000-000000000002';
const executionId = '00000000-0000-4000-8000-000000000003';
const userId = '00000000-0000-4000-8000-000000000010';

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const workflowSummary = {
  workflowId,
  name: 'Nav workflow',
  description: null,
  status: 'PUBLISHED',
  schemaVersion: '1.0',
  currentVersionId: null,
  createdAt: '2026-09-24T10:00:00Z',
  updatedAt: '2026-09-24T10:00:00Z',
  publishedAt: null,
};

const execution = {
  executionId,
  workflowId,
  workflowVersionId: workflowId,
  status: 'SUCCESS',
  triggerType: 'MANUAL',
  createdAt: '2026-09-24T10:00:00Z',
  startedAt: '2026-09-24T10:00:01Z',
  finishedAt: '2026-09-24T10:00:02Z',
};

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'playwright-test-token');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return json(route, { id: userId, email: 'test@example.test', displayName: 'Playwright User' });
    if (path === '/api/v1/workspaces') {
      return json(route, {
        items: [{ id: workspaceId, name: 'Nav Workspace', createdBy: userId, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', role: 'OWNER' }],
        page: 0, size: 100, totalElements: 1, totalPages: 1,
      });
    }
    if (path === `/api/v1/workspaces/${workspaceId}/connections`) return json(route, []);
    const base = `/api/v1/workspaces/${workspaceId}/workflows`;
    if (path === base) return json(route, { items: [workflowSummary], page: 0, size: 100, totalElements: 1 });
    if (path === `${base}/${workflowId}`) {
      return json(route, { ...workflowSummary, definition: { schemaVersion: '1.0', nodes: [], edges: [], variables: {} }, editorState: { nodes: {} }, triggers: [] });
    }
    if (path === `${base}/${workflowId}/executions`) return json(route, { items: [execution], page: 0, size: 100, totalElements: 1 });
    if (path === `${base}/${workflowId}/executions/${executionId}`) return json(route, { ...execution, nodes: [], logs: { items: [], page: 0, size: 100, totalElements: 0, hasNext: false } });
    return json(route, { items: [], page: 0, size: 20, totalElements: 0 });
  });
}

test.describe('navigation structure', () => {
  test('sidebar lists only Overview, Workflows, Workspace and AI, and toggles with Ctrl+B', async ({ page }) => {
    await setup(page);
    await page.goto('/dashboard');
    const sidebar = page.getByTestId('app-sidebar');
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    for (const name of ['Dashboard', 'Workflows', 'Workspace', 'AI Generator']) {
      await expect(sidebar.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(sidebar.getByRole('link', { name: 'Connections', exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Executions', exact: true })).toHaveCount(0);

    await page.getByTestId('sidebar-toggle').click();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    await expect(page.getByTestId('sidebar-profile-name')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toHaveAttribute('data-collapsed', 'false');

    await page.locator('body').click({ position: { x: 700, y: 400 } });
    await page.keyboard.press('Control+b');
    await expect(page.getByTestId('app-sidebar')).toHaveAttribute('data-collapsed', 'true');
  });

  test('legacy routes redirect and keep the query string', async ({ page }) => {
    await setup(page);
    await page.goto('/connections?oauth=success&connectionId=abc');
    await expect(page).toHaveURL(/\/workspace\/connections\?oauth=success&connectionId=abc/);
    await expect(page.getByTestId('connections-page')).toBeVisible();

    // /executions is the monitoring overview now (W6-A), no longer a redirect to /workflows.
    await page.goto('/executions');
    await expect(page).toHaveURL(/\/executions$/);
    await expect(page.getByTestId('monitoring-summary').or(page.getByTestId('monitoring-summary-error'))).toBeVisible();

    await page.goto(`/executions/${executionId}?workflowId=${workflowId}`);
    await expect(page).toHaveURL(new RegExp(`/workflows/${workflowId}/executions\\?run=${executionId}`));
    await expect(page.getByTestId('executions-tripane')).toBeVisible();
  });

  test('Workspace page has Overview, Members, Connections and Settings tabs', async ({ page }) => {
    await setup(page);
    await page.goto('/workspace');
    await expect(page.getByTestId('workspace-header-name')).toHaveText('Nav Workspace');
    for (const key of ['overview', 'members', 'connections', 'settings']) {
      await expect(page.getByTestId(`workspace-tab-${key}`)).toBeVisible();
    }
    await page.getByTestId('workspace-tab-connections').click();
    await expect(page).toHaveURL(/\/workspace\/connections$/);
    await expect(page.getByTestId('connections-page')).toBeVisible();
    await expect(page.getByTestId('connections-workspace-name')).toHaveText('Nav Workspace');
    await expect(page.getByTestId('topbar-breadcrumb-current')).toHaveText('Connections');

    await page.goto('/workspace/members');
    await expect(page.getByTestId('workspace-tab-members')).toHaveAttribute('aria-current', 'page');
    await page.goto('/workspace/settings');
    await expect(page.getByTestId('workspace-tab-settings')).toHaveAttribute('aria-current', 'page');
  });

  test('collapsed sidebar expands as an overlay on hover and focus without shifting the page', async ({ page }) => {
    await setup(page);
    await page.goto('/dashboard');
    const sidebar = page.getByTestId('app-sidebar');
    const main = page.locator('main').first();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    const before = await main.boundingBox();
    const railWidth = (await sidebar.boundingBox())?.width;
    expect(railWidth).toBe(56);

    await sidebar.hover();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(220);
    await expect(sidebar).toHaveAttribute('data-pinned', 'false');
    expect((await main.boundingBox())?.x).toBe(before?.x);

    await page.mouse.move(800, 400);
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(56);
    expect((await main.boundingBox())?.x).toBe(before?.x);

    // keyboard focus expands it too, and blur collapses it
    await page.keyboard.press('Tab');
    await sidebar.getByRole('link', { name: 'Dashboard', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    await page.locator('main a, main button').first().focus();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  });

  test('pinning keeps the sidebar expanded and pushes the content', async ({ page }) => {
    await setup(page);
    await page.goto('/dashboard');
    const main = page.locator('main').first();
    const railX = (await main.boundingBox())?.x ?? 0;
    await page.getByTestId('sidebar-toggle').click();
    await page.mouse.move(800, 400);
    const sidebar = page.getByTestId('app-sidebar');
    await expect(sidebar).toHaveAttribute('data-pinned', 'true');
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    await expect.poll(async () => (await main.boundingBox())?.x ?? 0).toBeGreaterThan(railX + 100);
    await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-label', 'Unpin');
  });

  test('each Workspace tab shows only its own section', async ({ page }) => {
    await setup(page);
    await page.goto('/workspace');
    await expect(page.getByTestId('workspace-selected-heading')).toHaveText('Nav Workspace');
    await expect(page.getByTestId('workspace-members-summary')).toBeVisible();
    await expect(page.getByTestId('workspace-create-form')).toBeVisible();
    await expect(page.getByTestId('workspace-member-email')).toHaveCount(0);
    await expect(page.getByTestId('workspace-rename-form')).toHaveCount(0);

    await page.getByTestId('workspace-tab-members').click();
    await expect(page).toHaveURL(/\/workspace\/members$/);
    await expect(page.getByTestId('workspace-member-email')).toBeVisible();
    await expect(page.getByTestId('workspace-create-form')).toHaveCount(0);
    await expect(page.getByTestId('workspace-rename-form')).toHaveCount(0);

    await page.getByTestId('workspace-tab-settings').click();
    await expect(page).toHaveURL(/\/workspace\/settings$/);
    await expect(page.getByTestId('workspace-rename-form')).toBeVisible();
    await expect(page.getByTestId('workspace-member-email')).toHaveCount(0);
  });
});
