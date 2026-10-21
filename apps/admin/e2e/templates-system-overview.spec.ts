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

const FAILING = [
  { workflowId: 'wf1', workflowName: 'Nightly sync', workspaceId: 'wA', failures: 5, lastFailureAt: '2026-05-13T08:30:00Z' },
  { workflowId: 'wf2', workflowName: 'Lead alert', workspaceId: 'wB', failures: 2, lastFailureAt: '2026-05-12T10:00:00Z' },
  { workflowId: 'wf3', workflowName: 'Orphan flow', workspaceId: 'gone', failures: 1, lastFailureAt: '2026-05-11T10:00:00Z' },
];

/** Zero-filled UTC days ending 2026-05-14; success grows with the index and failed cycles 0, 1, 2. */
const trendOf = (days: number) =>
  Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.UTC(2026, 4, 14 - (days - 1 - i)));
    return { day: date.toISOString().slice(0, 10), total: i + (i % 3), success: i, failed: i % 3 };
  });

interface OverviewOpts {
  summaryStatus?: number;
  cancelled?: number;
  trendStatus?: number;
  /** Replaces the generated trend (any length). */
  trend?: ReturnType<typeof trendOf>;
  topFailing?: typeof FAILING;
}

async function stubOverview(page: Page, opts: OverviewOpts = {}) {
  const calls = {
    users: [] as URLSearchParams[],
    executions: [] as URLSearchParams[],
    workspaces: [] as URLSearchParams[],
    /** Summary calls without `days` are the 24 h tiles; the ones with `days` feed the charts. */
    summary: 0,
    chart: [] as URLSearchParams[],
  };
  let trendFailures = opts.trendStatus ? 1 : 0;
  await page.route(`${GATEWAY}/api/admin/users**`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    calls.users.push(params);
    return json(route, 200, { items: [], page: 0, size: 1, totalItems: params.get('status') === 'DISABLED' ? 2 : 7, totalPages: 1 });
  });
  await page.route(`${GATEWAY}/api/admin/workspaces**`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    calls.workspaces.push(params);
    const ids = params.get('ids');
    if (ids) {
      const known = [{ id: 'wA', name: 'Marketing' }, { id: 'wB', name: 'Sales' }];
      const items = known.filter((w) => ids.split(',').includes(w.id)).map((w) => ({ ...w, ownerId: 'u9', ownerEmail: null, ownerDisplayName: null, memberCount: 1, createdAt: '2026-04-01T12:00:00Z' }));
      return json(route, 200, { items, page: 0, size: 100, totalElements: items.length, totalPages: 1 });
    }
    return json(route, 200, { items: [], page: 0, size: 1, totalElements: 5, totalPages: 5 });
  });
  await page.route(`${GATEWAY}/api/admin/executions**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/summary')) {
      const days = url.searchParams.get('days');
      const body = (n: number) => ({
        hours: 24, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z', total: 40 + (opts.cancelled ?? 0), success: 30, failed: 6, active: 4,
        trend: opts.trend ?? trendOf(n), topFailing: opts.topFailing ?? FAILING,
      });
      if (days === null) {
        calls.summary++;
        if (opts.summaryStatus && calls.summary === 1) return json(route, opts.summaryStatus, { message: 'boom' });
        return json(route, 200, body(14));
      }
      calls.chart.push(url.searchParams);
      if (trendFailures-- > 0) return json(route, opts.trendStatus!, { message: 'boom' });
      return json(route, 200, body(Number(days)));
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
  await expect(page.getByTestId('overview-runs-other')).toHaveCount(0);
});

test('overview adds an "other" count when cancelled runs make the total exceed the breakdown', async ({ page }) => {
  await stubOverview(page, { cancelled: 3 });
  await page.goto('/');
  const runsTile = page.getByTestId('tile-runs');
  await expect(page.getByTestId('overview-runs-total')).toHaveText('43');
  await expect(runsTile).toContainText('4 in progress');
  await expect(page.getByTestId('overview-runs-other')).toHaveText('· 3 other');
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

test('overview draws one bar group per day with an accessible summary and table', async ({ page }) => {
  const calls = await stubOverview(page);
  await page.goto('/');
  const chart = page.getByTestId('overview-trend');
  await expect(chart.getByTestId('trend-day')).toHaveCount(14);
  await expect(chart.getByTestId('trend-day').first()).toHaveAttribute('data-date', '2026-05-01');
  await expect(chart.getByTestId('trend-day').last()).toHaveAttribute('data-date', '2026-05-14');
  await expect(chart.getByRole('img')).toHaveAttribute('aria-label', 'Chart of 104 runs over 14 days, split into succeeded and failed');
  const table = chart.getByRole('table', { name: 'Runs per day (UTC)' });
  await expect(table.getByRole('row')).toHaveCount(15);
  await expect(table.getByRole('row').nth(14)).toContainText('2026-05-14');
  await expect(table.getByRole('row').nth(14)).toContainText('14');
  await expect(chart.getByRole('button', { name: '14 days' })).toHaveAttribute('aria-pressed', 'true');
  expect(calls.chart).toHaveLength(1);
  expect(calls.chart[0].get('days')).toBe('14');
  expect(calls.chart[0].get('hours')).toBe('24');
});

test('choosing 30 days refetches the charts and leaves the tiles alone', async ({ page }) => {
  const calls = await stubOverview(page);
  await page.goto('/');
  await expect(page.getByTestId('overview-runs-total')).toHaveText('40');
  const chart = page.getByTestId('overview-trend');
  await chart.getByRole('button', { name: '30 days' }).click();
  await expect(chart.getByTestId('trend-day')).toHaveCount(30);
  await expect(chart.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.getByRole('button', { name: '14 days' })).toHaveAttribute('aria-pressed', 'false');
  expect(calls.chart.map((p) => p.get('days'))).toEqual(['14', '30']);
  expect(calls.summary).toBe(1);
  await chart.getByRole('button', { name: '7 days' }).click();
  await expect(chart.getByTestId('trend-day')).toHaveCount(7);
  expect(calls.chart.map((p) => p.get('days'))).toEqual(['14', '30', '7']);
  await expect(page.getByTestId('overview-runs-total')).toHaveText('40');
});

test('top failing workflows show names, one workspace lookup and a link to that workspace', async ({ page }) => {
  const calls = await stubOverview(page);
  await page.goto('/');
  const rows = page.getByTestId('top-failing-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('Nightly sync');
  await expect(rows.first()).toContainText('Marketing');
  await expect(rows.first()).toContainText('5 failed');
  await expect(rows.first()).toContainText('May 2026');
  await expect(rows.first()).toHaveAttribute('href', '/executions?workspaceId=wA');
  await expect(rows.nth(1)).toContainText('Sales');
  await expect(rows.nth(2)).toContainText('—');
  await expect(rows.nth(2)).toHaveAttribute('href', '/executions?workspaceId=gone');
  const width = (index: number) => rows.nth(index).getByTestId('top-failing-bar').getAttribute('style');
  expect(await width(0)).toContain('width: 100%');
  expect(await width(1)).toContain('width: 40%');
  const lookups = calls.workspaces.filter((p) => p.get('ids'));
  expect(lookups).toHaveLength(1);
  expect(lookups[0].get('ids')?.split(',').sort()).toEqual(['gone', 'wA', 'wB']);
  expect(lookups[0].get('size')).toBe('100');
  await rows.first().click();
  await expect(page).toHaveURL(/\/executions\?workspaceId=wA$/);
});

test('the charts show friendly empty states when nothing ran or failed', async ({ page }) => {
  await stubOverview(page, { trend: trendOf(14).map((d) => ({ ...d, total: 0, success: 0, failed: 0 })), topFailing: [] });
  await page.goto('/');
  await expect(page.getByTestId('overview-trend')).toContainText('No runs in this period');
  await expect(page.getByTestId('trend-day')).toHaveCount(0);
  await expect(page.getByTestId('overview-top-failing')).toContainText('No failed runs in this period');
  await expect(page.getByTestId('top-failing-row')).toHaveCount(0);
});

test('a failing chart request shows Retry and leaves the other sections working', async ({ page }) => {
  const calls = await stubOverview(page, { trendStatus: 500 });
  await page.goto('/');
  await expect(page.getByTestId('overview-users-total')).toHaveText('7');
  await expect(page.getByTestId('overview-runs-total')).toHaveText('40');
  await expect(page.getByTestId('failed-run-row')).toHaveCount(2);
  await expect(page.getByTestId('overview-trend').getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByTestId('overview-top-failing').getByRole('button', { name: 'Retry' })).toBeVisible();
  await page.getByTestId('overview-trend').getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('trend-day')).toHaveCount(14);
  await expect(page.getByTestId('top-failing-row')).toHaveCount(3);
  expect(calls.chart).toHaveLength(2);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test('the overview does not scroll sideways', async ({ page }) => {
    await stubOverview(page);
    await page.goto('/');
    await expect(page.getByTestId('top-failing-row')).toHaveCount(3);
    await expect(page.getByTestId('trend-day')).toHaveCount(14);
    const { scrollWidth, innerWidth } = await page.evaluate<{ scrollWidth: number; innerWidth: number }>('({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })');
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });
});
