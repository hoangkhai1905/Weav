import { expect, test, type Page, type Route } from '@playwright/test';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000010';
const syncId = '00000000-0000-4000-8000-000000000021';
const reportId = '00000000-0000-4000-8000-000000000022';
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const run = (id: string, workflowId: string, workflowName: string, status: string, minutesAgo: number, extra: Record<string, unknown> = {}) => ({
  executionId: id,
  workflowId,
  workflowName,
  status,
  triggerType: 'SCHEDULE',
  createdAt: iso(minutesAgo),
  startedAt: iso(minutesAgo),
  finishedAt: status === 'QUEUED' ? null : iso(minutesAgo - 1),
  durationMs: status === 'QUEUED' ? null : 61_000,
  errorCode: status === 'FAILED' ? 'HTTP_500' : null,
  errorMessage: status === 'FAILED' ? 'Upstream said no' : null,
  ...extra,
});

const RUNS = [
  run('00000000-0000-4000-8000-0000000000a1', syncId, 'Customer sync', 'FAILED', 10),
  run('00000000-0000-4000-8000-0000000000a2', reportId, 'Daily report', 'SUCCESS', 60),
  run('00000000-0000-4000-8000-0000000000a3', syncId, 'Customer sync', 'SUCCESS', 120),
];

const summary = {
  days: 7,
  from: iso(7 * 1440),
  to: iso(0),
  workflows: { published: 2, paused: 1, draft: 0 },
  runs: { total: 8, today: 3, success: 6, failed: 2, active: 0 },
  successRate: 0.75,
  averageDurationMs: 61_000,
  p95DurationMs: 125_000,
  trend: Array.from({ length: 7 }, (_, index) => ({
    date: day(6 - index),
    total: index === 6 ? 3 : index === 3 ? 5 : 0,
    success: index === 6 ? 2 : index === 3 ? 4 : 0,
    failed: index === 6 ? 1 : index === 3 ? 1 : 0,
  })),
  topFailingWorkflows: [{ workflowId: syncId, workflowName: 'Customer sync', failures: 2, lastFailureAt: iso(10) }],
  recentFailures: [RUNS[0]],
};

interface Rule {
  id: string;
  workspaceId: string;
  workflowId: string | null;
  name: string;
  type: string;
  threshold: number;
  windowMinutes: number | null;
  cooldownMinutes: number;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Stub {
  historyUrls: URL[];
  rules: Rule[];
  ruleBodies: Array<{ method: string; body: Record<string, unknown> }>;
  failHistory: boolean;
  rejectRange: boolean;
  failRuleWrite: boolean;
  emptyHistory: boolean;
}

async function setup(page: Page): Promise<Stub> {
  const stub: Stub = { historyUrls: [], rules: [], ruleBodies: [], failHistory: false, rejectRange: false, failRuleWrite: false, emptyHistory: false };
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'playwright-monitoring-token');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const base = `/api/v1/workspaces/${workspaceId}`;
    if (path === '/api/auth/me') return json(route, { id: userId, email: 'owner@example.test', displayName: 'Owner' });
    if (path === '/api/v1/workspaces') {
      return json(route, {
        items: [{ id: workspaceId, name: 'Monitoring Workspace', createdBy: userId, createdAt: iso(99_999), updatedAt: iso(99_999), role: 'OWNER' }],
        page: 0, size: 100, totalElements: 1, totalPages: 1,
      });
    }
    if (path.includes('/notifications')) return json(route, path.includes('unread') ? { unreadCount: 0 } : { items: [], nextCursor: null });
    if (path === `${base}/workflows`) {
      const item = (workflowId: string, name: string) => ({ workflowId, name, description: null, status: 'PUBLISHED', schemaVersion: '1.0', currentVersionId: null, createdAt: iso(9000), updatedAt: iso(60), publishedAt: iso(60) });
      return json(route, { items: [item(syncId, 'Customer sync'), item(reportId, 'Daily report')], page: 0, size: 100, totalElements: 2 });
    }
    if (path === `${base}/monitoring/summary`) return json(route, summary);
    if (path === `${base}/executions`) {
      stub.historyUrls.push(url);
      if (stub.rejectRange) return json(route, { error: { code: 'BAD_REQUEST', message: 'The time range must be positive and at most 90 days' } }, 400);
      if (stub.failHistory) return json(route, { error: { code: 'X', message: 'History unavailable' } }, 503);
      if (stub.emptyHistory) return json(route, { items: [], page: 0, size: 20, totalElements: 0, hasNext: false });
      const page = Number(url.searchParams.get('page') ?? '0');
      const status = url.searchParams.get('status');
      const workflow = url.searchParams.get('workflowId');
      const filtered = RUNS.filter((item) => (!status || item.status === status) && (!workflow || item.workflowId === workflow));
      const size = Number(url.searchParams.get('size') ?? '20');
      const items = filtered.slice(page * 2, page * 2 + 2);
      // The stub caps every page at 2 rows, as a server with a smaller page size would.
      return json(route, { items, page, size: Math.min(size, 2), totalElements: filtered.length, hasNext: (page + 1) * 2 < filtered.length });
    }
    if (path === `${base}/alert-rules` || path.startsWith(`${base}/alert-rules/`)) {
      const id = path.split('/alert-rules/')[1];
      if (request.method() === 'GET') return json(route, { items: stub.rules, maxRules: 20 });
      if (stub.failRuleWrite && request.method() !== 'DELETE') return json(route, { error: { code: 'BAD_REQUEST', message: 'The workflow does not exist in this workspace' } }, 400);
      if (request.method() === 'DELETE') {
        stub.rules = stub.rules.filter((rule) => rule.id !== id);
        return route.fulfill({ status: 204 });
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      stub.ruleBodies.push({ method: request.method(), body });
      const now = iso(0);
      if (request.method() === 'POST') {
        const rule = { id: `00000000-0000-4000-8000-00000000b${String(stub.rules.length).padStart(3, '0')}`, workspaceId, createdBy: userId, createdAt: now, updatedAt: now, ...body } as Rule;
        stub.rules.push(rule);
        return json(route, rule, 201);
      }
      stub.rules = stub.rules.map((rule) => (rule.id === id ? { ...rule, ...body, updatedAt: now } as Rule : rule));
      return json(route, stub.rules.find((rule) => rule.id === id));
    }
    return json(route, { items: [], page: 0, size: 20, totalElements: 0 });
  });
  return stub;
}

test.describe('monitoring overview', () => {
  test('shows real metrics, a trend with every day, and the run history', async ({ page }) => {
    await setup(page);
    await page.goto('/executions');

    await expect(page.getByRole('heading', { name: 'Execution History' })).toBeVisible();
    await expect(page.getByTestId('monitoring-runs-total')).toHaveText('8');
    await expect(page.getByTestId('monitoring-success-rate')).toHaveText('75%');
    await expect(page.getByTestId('monitoring-failed')).toHaveText('2');
    await expect(page.getByTestId('monitoring-avg-duration')).toHaveText('1 min 1 s');
    await expect(page.getByTestId('monitoring-p95-duration')).toHaveText('2 min 5 s');
    await expect(page.getByTestId('monitoring-trend-day')).toHaveCount(7);
    await expect(page.getByTestId('monitoring-top-failing')).toContainText('Customer sync');
    await expect(page.getByTestId('monitoring-recent-failures')).toContainText('Customer sync');
    await expect(page.getByTestId('monitoring-recent-failures').getByRole('link').first()).toHaveAttribute(
      'href',
      `/executions/00000000-0000-4000-8000-0000000000a1?workflowId=${syncId}`,
    );
    await expect(page.getByText('Today (UTC):')).toBeVisible();
    await expect(page.getByText('From (UTC)')).toBeVisible();
    await expect(page.getByText('To (UTC)')).toBeVisible();

    const rows = page.getByTestId('monitoring-run-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Customer sync');
    await expect(rows.first()).toContainText('Failed');
    await expect(rows.first()).toContainText('HTTP_500');
    await expect(rows.first()).toContainText('1 min 1 s');
    await expect(rows.first().getByRole('link', { name: /View live trace/ })).toHaveAttribute(
      'href',
      `/executions/00000000-0000-4000-8000-0000000000a1?workflowId=${syncId}`,
    );
  });

  test('sends status, workflow and date filters to the server and pages through results', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/executions');
    await expect(page.getByTestId('monitoring-run-row')).toHaveCount(2);

    await page.getByTestId('monitoring-next').click();
    await expect(page.getByTestId('monitoring-run-row')).toHaveCount(1);
    await expect(page.getByTestId('monitoring-page-info')).toContainText('Page 2 of 2');
    expect(stub.historyUrls.at(-1)?.searchParams.get('page')).toBe('1');

    await page.getByTestId('monitoring-filter-status').selectOption('FAILED');
    await expect(page.getByTestId('monitoring-run-row')).toHaveCount(1);
    const afterStatus = stub.historyUrls.at(-1);
    expect(afterStatus?.searchParams.get('status')).toBe('FAILED');
    expect(afterStatus?.searchParams.get('page')).toBe('0');

    await page.getByTestId('monitoring-filter-workflow').selectOption(reportId);
    await expect(page.getByTestId('monitoring-runs-empty')).toContainText('No runs match these filters.');
    expect(stub.historyUrls.at(-1)?.searchParams.get('workflowId')).toBe(reportId);

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByTestId('monitoring-filter-from').fill('2026-10-01');
    await page.getByTestId('monitoring-filter-to').fill('2026-10-05');
    await expect.poll(() => stub.historyUrls.at(-1)?.searchParams.get('to')).toBe('2026-10-06T00:00:00.000Z');
    expect(stub.historyUrls.at(-1)?.searchParams.get('from')).toBe('2026-10-01T00:00:00.000Z');
  });

  test('refuses a range longer than 90 days without calling the server', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/executions');
    await expect(page.getByTestId('monitoring-run-row')).toHaveCount(2);

    await page.getByTestId('monitoring-filter-from').fill(day(30));
    await expect.poll(() => stub.historyUrls.at(-1)?.searchParams.get('from')).toBe(`${day(30)}T00:00:00.000Z`);
    const before = stub.historyUrls.length;
    await page.getByTestId('monitoring-filter-to').fill(day(-70));

    await expect(page.getByTestId('monitoring-range-error')).toContainText('at most 90 days');
    expect(stub.historyUrls.length).toBe(before);
  });

  test('rejects a start date older than 90 days even without an end date and hides the stale table', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/executions');
    await expect(page.getByTestId('monitoring-run-row')).toHaveCount(2);
    const before = stub.historyUrls.length;

    await page.getByTestId('monitoring-filter-from').fill('2020-01-01');

    await expect(page.getByTestId('monitoring-range-error')).toContainText('more than 90 days ago');
    await expect(page.getByTestId('monitoring-run-row')).toHaveCount(0);
    await expect(page.getByTestId('monitoring-runs-empty')).toHaveCount(0);
    await expect(page.getByTestId('monitoring-page-info')).toHaveCount(0);
    expect(stub.historyUrls.length).toBe(before);
  });

  test('shows a localized message when the server rejects the range', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/executions');
    await expect(page.getByTestId('monitoring-run-row')).toHaveCount(2);

    stub.rejectRange = true;
    await page.getByTestId('monitoring-filter-from').fill(day(10));

    await expect(page.getByTestId('monitoring-runs-error')).toContainText('The time range can be at most 90 days.');
    await expect(page.getByTestId('monitoring-runs-error')).not.toContainText('positive and at most');
  });

  test('shows honest empty and error states', async ({ page }) => {
    const stub = await setup(page);
    stub.emptyHistory = true;
    await page.goto('/executions');
    await expect(page.getByTestId('monitoring-runs-empty')).toContainText('No runs yet.');

    stub.emptyHistory = false;
    stub.failHistory = true;
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByTestId('monitoring-runs-error')).toContainText('History unavailable');
    stub.failHistory = false;
    await page.getByTestId('monitoring-runs-error').getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('monitoring-run-row')).toHaveCount(2);
  });

  test('the sidebar opens the monitoring page', async ({ page }) => {
    await setup(page);
    await page.goto('/dashboard');
    await page.getByTestId('sidebar-monitoring').click();
    await expect(page).toHaveURL(/\/executions$/);
    await expect(page.getByTestId('monitoring-summary')).toBeVisible();
  });
});

test.describe('alert rules', () => {
  test('creates, edits, disables and deletes a rule', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/executions');
    await page.getByRole('tab', { name: 'Alert rules' }).click();
    await expect(page.getByTestId('alert-rules-empty')).toBeVisible();
    await expect(page.getByText('as soon as a run passes the threshold')).toBeVisible();

    await page.getByTestId('alert-rule-add').click();
    await page.getByLabel('Rule name').fill('Sync keeps failing');
    await page.getByLabel('Applies to').selectOption(syncId);
    await page.getByLabel('Consecutive failures (1-20)').fill('3');
    await page.getByLabel('Within (minutes)').fill('45');
    await page.getByTestId('alert-rule-save').click();

    const row = page.getByTestId('alert-rule-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Sync keeps failing');
    await expect(row).toContainText('Fails 3 times in a row within 45 minutes');
    await expect(row).toContainText('Customer sync');
    expect(stub.ruleBodies[0]).toEqual({
      method: 'POST',
      body: { name: 'Sync keeps failing', type: 'CONSECUTIVE_FAILURES', workflowId: syncId, threshold: 3, windowMinutes: 45, cooldownMinutes: 60, enabled: true },
    });

    await row.getByRole('button', { name: 'Edit: Sync keeps failing' }).click();
    await page.getByLabel('Type').selectOption('LONG_RUNNING');
    await page.getByLabel('Runs longer than (seconds)').fill('120');
    await page.getByTestId('alert-rule-save').click();
    await expect(row).toContainText('A run takes longer than 120 seconds');
    expect(stub.ruleBodies[1]).toMatchObject({ method: 'PUT', body: { type: 'LONG_RUNNING', threshold: 120, windowMinutes: null } });

    await row.getByRole('button', { name: 'Disable: Sync keeps failing' }).click();
    await expect(row).toContainText('Disabled');
    expect(stub.ruleBodies[2]).toMatchObject({ method: 'PUT', body: { enabled: false } });

    await row.getByTestId('alert-rule-delete').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('alert-rules-empty')).toBeVisible();
    expect(stub.rules).toHaveLength(0);
  });

  test('validates input locally and shows the server reason', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/executions');
    await page.getByRole('tab', { name: 'Alert rules' }).click();
    await page.getByTestId('alert-rule-add').click();

    await page.getByTestId('alert-rule-save').click();
    await expect(page.getByTestId('alert-rule-error')).toContainText('1 to 120 characters');
    expect(stub.ruleBodies).toHaveLength(0);

    await page.getByLabel('Rule name').fill('Valid name');
    await page.getByLabel('Consecutive failures (1-20)').fill('99');
    await page.getByTestId('alert-rule-save').click();
    await expect(page.getByTestId('alert-rule-error')).toContainText('between 1 and 20');

    await page.getByLabel('Consecutive failures (1-20)').fill('2');
    stub.failRuleWrite = true;
    await page.getByTestId('alert-rule-save').click();
    await expect(page.getByTestId('alert-rule-error')).toContainText('The workflow does not exist in this workspace');
  });

  test('stops adding once the workspace has 20 rules', async ({ page }) => {
    const stub = await setup(page);
    const now = iso(0);
    stub.rules = Array.from({ length: 20 }, (_, index) => ({
      id: `00000000-0000-4000-8000-00000000c${String(index).padStart(3, '0')}`, workspaceId, workflowId: null, name: `Rule ${index}`,
      type: 'LONG_RUNNING', threshold: 60, windowMinutes: null, cooldownMinutes: 60, enabled: true, createdBy: userId, createdAt: now, updatedAt: now,
    }));
    await page.goto('/executions');
    await page.getByRole('tab', { name: 'Alert rules' }).click();

    await expect(page.getByTestId('alert-rule-row')).toHaveCount(20);
    await expect(page.getByTestId('alert-rule-add')).toBeDisabled();
  });
});
