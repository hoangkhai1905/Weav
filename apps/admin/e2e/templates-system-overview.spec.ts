import { expect, test, type Page } from '@playwright/test';
import { GATEWAY, json, signedInAs } from './support.js';

const template = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: `About ${name}`,
  authorName: 'Ada Author',
  nodeTypes: ['trigger.manual', 'email.send'],
  visibility: 'PUBLIC',
  usageCount: 12,
  createdAt: '2026-03-04T10:00:00Z',
  updatedAt: '2026-03-05T10:00:00Z',
  owned: false,
  ...extra,
});

/** Public template list; a PATCH removes the row (like the real list after a takedown) unless `patchStatus` says otherwise. */
async function stubTemplates(page: Page, initial: unknown[], patchStatus = 200) {
  let items = initial as { id: string; name: string }[];
  const lists: URLSearchParams[] = [];
  const patches: { id: string; body: unknown }[] = [];
  await page.route(`${GATEWAY}/api/v1/templates**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'PATCH') {
      const id = decodeURIComponent(url.pathname.split('/').pop()!);
      patches.push({ id, body: request.postDataJSON() });
      if (patchStatus !== 200) return json(route, patchStatus, { message: 'refused' });
      items = items.filter((item) => item.id !== id);
      return json(route, 200, { id });
    }
    lists.push(url.searchParams);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const rows = items.filter((item) => item.name.toLowerCase().includes(q));
    return json(route, 200, { items: rows, page: 0, size: 20, totalElements: rows.length, totalPages: 1 });
  });
  return { lists, patches };
}

test.beforeEach(async ({ page }) => {
  await signedInAs(page, { id: 'u1', email: 'root@weav.test', displayName: 'Root' });
});

test('public templates list with search and author fallback', async ({ page }) => {
  const { lists } = await stubTemplates(page, [template('t1', 'Daily report'), template('t2', 'Lead alert', { authorName: null, description: null })]);
  await page.goto('/templates');
  const rows = page.getByTestId('template-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Daily report');
  await expect(rows.first()).toContainText('About Daily report');
  await expect(rows.first()).toContainText('Ada Author');
  await expect(rows.first()).toContainText('12');
  await expect(rows.first()).toContainText('4 Mar 2026');
  await expect(rows.nth(1)).toContainText('—');
  expect(lists).toHaveLength(1);
  expect(lists[0].get('scope')).toBe('public');
  expect(lists[0].get('page')).toBe('0');
  expect(lists[0].has('q')).toBe(false);

  await page.getByLabel('Search by name').fill('lead');
  await expect.poll(() => lists.length).toBe(2);
  expect(lists[1].get('q')).toBe('lead');
  await expect(rows).toHaveCount(1);
});

test('take down a public template after confirming', async ({ page }) => {
  const { lists, patches } = await stubTemplates(page, [template('t1', 'Daily report'), template('t2', 'Lead alert')]);
  await page.goto('/templates');
  const rows = page.getByTestId('template-row');
  await expect(rows).toHaveCount(2);

  await rows.first().getByRole('button', { name: /Take down/ }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Daily report');
  await expect(dialog).toContainText('private');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(patches).toHaveLength(0);

  await rows.first().getByRole('button', { name: /Take down/ }).click();
  await dialog.getByRole('button', { name: 'Take down' }).click();
  await expect(dialog).toBeHidden();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Lead alert');
  expect(patches).toEqual([{ id: 't1', body: { visibility: 'PRIVATE' } }]);
  expect(lists).toHaveLength(2);
});

test('a refused takedown shows a friendly error', async ({ page }) => {
  const { patches } = await stubTemplates(page, [template('t1', 'Daily report')], 409);
  await page.goto('/templates');
  await page.getByTestId('template-row').getByRole('button', { name: /Take down/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Take down' }).click();
  await expect(page.getByRole('alert')).toContainText('can no longer be taken down');
  await expect(page.getByRole('alert')).not.toContainText('refused');
  expect(patches).toHaveLength(1);
});

test('system page shows identity and workspace up/down', async ({ page }) => {
  await page.route(`${GATEWAY}/ready/upstreams`, (route) =>
    json(route, 503, { status: 'error', details: { identity: { status: 'up' }, workspace: { status: 'down' } }, requestId: 'r1' }),
  );
  await page.goto('/system');
  await expect(page.getByTestId('system-identity')).toContainText('Up');
  await expect(page.getByTestId('system-workspace')).toContainText('Down');
  await expect(page.getByText('Up', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Down', { exact: true })).toHaveCount(1);
  await expect(page.getByText(/Checked at/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('system page shows an error with Retry when the check cannot run', async ({ page }) => {
  let fail = true;
  await page.route(`${GATEWAY}/ready/upstreams`, (route) =>
    fail
      ? json(route, 500, { message: 'boom' })
      : json(route, 200, { status: 'ok', details: { identity: { status: 'up' }, workspace: { status: 'up' } }, requestId: 'r2' }),
  );
  await page.goto('/system');
  await expect(page.getByRole('alert')).toContainText('Could not check');
  await expect(page.getByText('Down', { exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Up', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

const failedRun = (id: string, workspaceId: string) => ({
  executionId: id,
  workflowId: `wf-${id}`,
  workflowName: `Flow ${id}`,
  workspaceId,
  status: 'FAILED',
  triggerType: 'MANUAL',
  createdAt: '2026-05-01T09:00:00Z',
  startedAt: '2026-05-01T09:00:01Z',
  durationMs: 900,
  errorCode: 'STEP_FAILED',
});

async function stubOverview(page: Page, opts: { summaryStatus?: number } = {}) {
  const calls = { users: [] as URLSearchParams[], executions: [] as URLSearchParams[], workspaces: [] as URLSearchParams[], summary: 0 };
  await page.route(`${GATEWAY}/api/admin/users**`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    calls.users.push(params);
    return json(route, 200, { items: [], page: 0, size: 1, totalItems: params.get('status') === 'DISABLED' ? 2 : 7, totalPages: 1 });
  });
  await page.route(`${GATEWAY}/api/admin/workspaces**`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    calls.workspaces.push(params);
    if (params.get('ids')) {
      const items = [{ id: 'wA', name: 'Marketing' }].map((w) => ({ ...w, ownerId: 'u9', ownerEmail: null, ownerDisplayName: null, memberCount: 1, createdAt: '2026-04-01T12:00:00Z' }));
      return json(route, 200, { items, page: 0, size: 100, totalElements: 1, totalPages: 1 });
    }
    return json(route, 200, { items: [], page: 0, size: 1, totalElements: 5, totalPages: 5 });
  });
  await page.route(`${GATEWAY}/api/admin/executions**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/summary')) {
      calls.summary++;
      if (opts.summaryStatus && calls.summary === 1) return json(route, opts.summaryStatus, { message: 'boom' });
      return json(route, 200, { hours: 24, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z', total: 40, success: 30, failed: 6, active: 4 });
    }
    calls.executions.push(url.searchParams);
    return json(route, 200, { items: [failedRun('e1', 'wA'), failedRun('e2', 'gone')], page: 0, size: 5, totalElements: 2, hasNext: false });
  });
  await page.route(`${GATEWAY}/ready/upstreams`, (route) =>
    json(route, 200, { status: 'ok', details: { identity: { status: 'up' }, workspace: { status: 'up' } }, requestId: 'r1' }),
  );
  return calls;
}

test('overview tiles load independently', async ({ page }) => {
  await stubOverview(page, { summaryStatus: 500 });
  await page.goto('/');
  await expect(page.getByTestId('overview-users-total')).toHaveText('7');
  await expect(page.getByTestId('overview-disabled-total')).toHaveText('2');
  await expect(page.getByTestId('overview-workspaces-total')).toHaveText('5');
  const runsTile = page.getByTestId('tile-runs');
  await expect(runsTile.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByTestId('failed-run-row')).toHaveCount(2);

  await runsTile.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('overview-runs-total')).toHaveText('40');
  await expect(runsTile).toContainText('30 succeeded');
  await expect(runsTile).toContainText('6 failed');
  await expect(runsTile).toContainText('4 in progress');
});

test('overview lists the latest failed runs and the system health', async ({ page }) => {
  const calls = await stubOverview(page);
  await page.goto('/');
  const rows = page.getByTestId('failed-run-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Flow e1');
  await expect(rows.first()).toContainText('Marketing');
  await expect(rows.first()).toContainText('STEP_FAILED');
  await expect(rows.nth(1)).toContainText('—');
  await expect(rows.first()).toHaveAttribute('href', '/executions');
  expect(calls.executions).toHaveLength(1);
  expect(calls.executions[0].get('status')).toBe('FAILED');
  expect(calls.executions[0].get('size')).toBe('5');
  expect(calls.executions[0].get('page')).toBe('0');
  expect(calls.users.map((p) => p.get('status')).sort()).toEqual(['DISABLED', null]);

  const health = page.getByTestId('overview-health');
  await expect(health.getByText('Up', { exact: true })).toHaveCount(2);
  await health.getByRole('link', { name: 'See details' }).click();
  await expect(page).toHaveURL(/\/system$/);
});
