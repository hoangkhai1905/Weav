import { expect, test, type Page } from '@playwright/test';
import { GATEWAY, json, signedInAs } from './support.js';

const ws = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  ownerId: 'u9',
  ownerEmail: 'owner@example.com',
  ownerDisplayName: 'Olive Owner',
  memberCount: 3,
  createdAt: '2026-04-01T12:00:00Z',
  ...extra,
});

const run = (executionId: string, workspaceId: string, extra: Record<string, unknown> = {}) => ({
  executionId,
  workflowId: `wf-${executionId}`,
  workflowName: `Flow ${executionId}`,
  workspaceId,
  status: 'SUCCESS',
  triggerType: 'MANUAL',
  createdAt: '2026-05-01T09:00:00Z',
  startedAt: '2026-05-01T09:00:01Z',
  durationMs: 1234,
  errorCode: null,
  ...extra,
});

const detail = {
  executionId: 'e2',
  workflowId: 'wf-e2',
  workflowName: 'Flow e2',
  workspaceId: 'wA',
  status: 'FAILED',
  triggerType: 'TELEGRAM',
  createdAt: '2026-05-01T09:00:00Z',
  startedAt: '2026-05-01T09:00:01Z',
  finishedAt: '2026-05-01T09:03:05Z',
  errorCode: 'STEP_FAILED',
  errorMessage: 'The mail step gave up',
  steps: [
    { nodeId: 'n1', nodeType: 'trigger.telegram', status: 'SUCCESS', attemptCount: 1, startedAt: '2026-05-01T09:00:01Z', finishedAt: '2026-05-01T09:00:02Z', errorCode: null, errorMessage: null },
    { nodeId: 'n2', nodeType: 'gmail.send', status: 'FAILED', attemptCount: 3, startedAt: '2026-05-01T09:00:02Z', finishedAt: '2026-05-01T09:03:05Z', errorCode: 'SMTP_REFUSED', errorMessage: 'Mailbox unavailable', },
    { nodeId: 'n3', nodeType: 'custom.thing', status: 'SKIPPED', attemptCount: 0, startedAt: null, finishedAt: null, errorCode: null, errorMessage: null },
  ],
};

async function stubWorkspaces(page: Page, items = [ws('wA', 'Marketing'), ws('wB', 'Support', { ownerEmail: null })]) {
  const lists: URLSearchParams[] = [];
  const idLookups: URLSearchParams[] = [];
  await page.route(`${GATEWAY}/api/admin/workspaces**`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    const ids = params.get('ids');
    (ids ? idLookups : lists).push(params);
    const rows = ids ? items.filter((w) => ids.split(',').includes(w.id)) : items.filter((w) => w.name.toLowerCase().includes((params.get('q') ?? '').toLowerCase()));
    return json(route, 200, { items: rows, page: 0, size: 20, totalElements: rows.length, totalPages: 1 });
  });
  return { lists, idLookups };
}

async function stubExecutions(page: Page, items: unknown[]) {
  const lists: URLSearchParams[] = [];
  await page.route(`${GATEWAY}/api/admin/executions**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/e2')) return json(route, 200, detail);
    lists.push(url.searchParams);
    return json(route, 200, { items, page: 0, size: 20, totalElements: items.length, hasNext: false });
  });
  return lists;
}

test.beforeEach(async ({ page }) => {
  await signedInAs(page, { id: 'u1', email: 'root@weav.test', displayName: 'Root' });
});

test('workspaces list shows owner email and member count, search by name', async ({ page }) => {
  const { lists } = await stubWorkspaces(page);
  await page.goto('/workspaces');
  const rows = page.getByTestId('workspace-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Marketing');
  await expect(rows.first()).toContainText('owner@example.com');
  await expect(rows.first()).toContainText('3');
  await expect(rows.nth(1)).toContainText('—');
  expect(lists).toHaveLength(1);
  expect(lists[0].get('page')).toBe('0');
  expect(lists[0].has('q')).toBe(false);

  await page.getByLabel('Search by name').fill('supp');
  await expect.poll(() => lists.length).toBe(2);
  expect(lists[1].get('q')).toBe('supp');
  await expect(rows).toHaveCount(1);
});

test('a workspace row opens executions filtered by that workspace', async ({ page }) => {
  const { idLookups } = await stubWorkspaces(page);
  const runs = await stubExecutions(page, [run('e1', 'wA')]);
  await page.goto('/workspaces');
  await page.getByTestId('workspace-row').first().click();

  await expect(page).toHaveURL(/\/executions\?workspaceId=wA$/);
  await expect(page.getByTestId('execution-row')).toHaveCount(1);
  expect(runs).toHaveLength(1);
  expect(runs[0].get('workspaceId')).toBe('wA');
  await expect(page.getByText('Workspace: Marketing')).toBeVisible();
  expect(idLookups).toHaveLength(1);

  await page.getByRole('button', { name: 'Remove the workspace filter' }).click();
  await expect(page).toHaveURL(/\/executions$/);
  await expect.poll(() => runs.length).toBe(2);
  expect(runs[1].has('workspaceId')).toBe(false);
  await expect(page.getByText(/Workspace: /)).toBeHidden();
});

test('executions resolve workspace names with a single ids request', async ({ page }) => {
  const { idLookups } = await stubWorkspaces(page);
  const runs = await stubExecutions(page, [run('e1', 'wA'), run('e3', 'wB'), run('e4', 'wA'), run('e5', 'gone')]);
  await page.goto('/executions');
  const rows = page.getByTestId('execution-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Marketing');
  await expect(rows.nth(1)).toContainText('Support');
  await expect(rows.nth(3)).toContainText('—');
  await expect(rows.nth(0)).toContainText('1.2 s');
  await expect(rows.nth(0)).toContainText('Succeeded');
  await expect(rows.nth(0)).toContainText('Manual');
  await page.waitForTimeout(300);

  expect(runs).toHaveLength(1);
  expect(runs[0].get('size')).toBe('20');
  expect(runs[0].has('status')).toBe(false);
  expect(idLookups).toHaveLength(1);
  expect(idLookups[0].get('ids')?.split(',').sort()).toEqual(['gone', 'wA', 'wB']);
  expect(idLookups[0].get('size')).toBe('100');
});

test('status and date filters go to the request as ISO instants', async ({ page }) => {
  await stubWorkspaces(page);
  const runs = await stubExecutions(page, [run('e1', 'wA')]);
  await page.goto('/executions');
  await expect(page.getByTestId('execution-row')).toHaveCount(1);

  await page.getByLabel('Status').selectOption('FAILED');
  await expect.poll(() => runs.length).toBe(2);
  await page.getByLabel('From').fill('2026-05-01');
  await page.getByLabel('To').fill('2026-05-03');
  await expect.poll(() => runs.length).toBe(4);
  const last = runs[3];
  expect(last.get('status')).toBe('FAILED');
  expect(Date.parse(last.get('to')!) - Date.parse(last.get('from')!)).toBe(3 * 86_400_000);
});

test('a date range over 90 days shows an inline error and sends no request', async ({ page }) => {
  await stubWorkspaces(page);
  const runs = await stubExecutions(page, [run('e1', 'wA')]);
  await page.goto('/executions');
  await expect(page.getByTestId('execution-row')).toHaveCount(1);

  await page.getByLabel('From').fill('2026-01-01');
  await expect.poll(() => runs.length).toBe(2); // a lone start date is a valid filter
  await page.getByLabel('To').fill('2026-06-30');
  await expect(page.getByRole('alert')).toHaveText(/at most 90 days/);
  await page.waitForTimeout(300);
  expect(runs).toHaveLength(2);
  await expect(page.getByTestId('execution-row')).toHaveCount(0);

  await page.getByLabel('To').fill('2026-02-15');
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.getByTestId('execution-row')).toHaveCount(1);
});

test('the execution panel shows steps and errors read-only', async ({ page }) => {
  await stubWorkspaces(page);
  await stubExecutions(page, [run('e2', 'wA', { status: 'FAILED', errorCode: 'STEP_FAILED' })]);
  await page.goto('/executions');
  await page.getByTestId('execution-row').click();

  const panel = page.getByRole('dialog');
  await expect(panel).toContainText('Flow e2');
  await expect(panel).toContainText('Marketing');
  await expect(panel).toContainText('Telegram');
  await expect(panel).toContainText('STEP_FAILED');
  await expect(panel).toContainText('The mail step gave up');
  await expect(panel).toContainText('3 min 4 s');
  const steps = panel.getByRole('list', { name: 'Steps' }).getByRole('listitem');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText('Workflow start');
  await expect(steps.nth(1)).toContainText('Gmail');
  await expect(steps.nth(1)).toContainText('3 attempts');
  await expect(steps.nth(1)).toContainText('SMTP_REFUSED');
  await expect(steps.nth(1)).toContainText('Mailbox unavailable');
  await expect(steps.nth(2)).toContainText('custom.thing');
  await expect(steps.nth(2)).toContainText('Skipped');
  await expect(panel.getByRole('button', { name: /retry|stop|run|cancel/i })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Close' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('a failed list shows an error with Retry', async ({ page }) => {
  await stubWorkspaces(page);
  let fail = true;
  await page.route(`${GATEWAY}/api/admin/executions**`, (route) =>
    fail ? json(route, 500, { message: 'boom' }) : json(route, 200, { items: [run('e1', 'wA')], page: 0, size: 20, totalElements: 1, hasNext: false }),
  );
  await page.goto('/executions');
  await expect(page.getByRole('alert')).toContainText('Could not load the runs');
  fail = false;
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('execution-row')).toHaveCount(1);
});
