import { expect, test, type Page, type Route } from '@playwright/test';

const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '10000000-0000-4000-8000-000000000002';
const WORKSPACE_A = '30000000-0000-4000-8000-000000000001';
const WORKSPACE_B = '30000000-0000-4000-8000-000000000002';
const WORKSPACE_C = '30000000-0000-4000-8000-000000000003';

const user = (id: string, email: string, displayName: string) => ({
  id,
  email,
  displayName,
  avatarUrl: null,
  systemRole: 'USER',
  status: 'ACTIVE',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  emailVerifiedAt: null,
});

const workspace = (id: string, name: string, ownerId: string) => ({
  id,
  name,
  createdBy: ownerId,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
});

const pageResult = (items: unknown[]) => ({
  items,
  page: 0,
  size: 20,
  totalElements: items.length,
  totalPages: items.length ? 1 : 0,
});

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installFixtures(
  page: Page,
  createWorkspace: (route: Route) => Promise<void>,
) {
  const notificationReads: string[] = [];
  const eventOrder: string[] = [];

  await page.addInitScript(() => {
    if (!localStorage.getItem('weav_token')) localStorage.setItem('weav_token', 'token-a');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await page.route('**/api/auth/me', async (route) => {
    const isAccountB = route.request().headers().authorization === 'Bearer token-b';
    await fulfill(route, user(
      isAccountB ? USER_B : USER_A,
      isAccountB ? 'b@example.com' : 'a@example.com',
      isAccountB ? 'User B' : 'User A',
    ));
  });
  await page.route('**/api/auth/logout', async (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/auth/login', async (route) => fulfill(route, {
    accessToken: 'token-b',
    refreshToken: 'refresh-token-b',
    user: user(USER_B, 'b@example.com', 'User B'),
  }));
  await page.route('**/api/v2/notifications**', async (route) => {
    const url = new URL(route.request().url());
    const actor = route.request().headers().authorization === 'Bearer token-b' ? 'B' : 'A';
    if (url.pathname === '/api/v2/notifications/unread-count' && route.request().method() === 'GET') {
      notificationReads.push(`${actor}:count`);
      eventOrder.push('notification-count');
      await fulfill(route, { count: 0 });
    } else if (url.pathname === '/api/v2/notifications' && route.request().method() === 'GET') {
      notificationReads.push(`${actor}:list`);
      eventOrder.push('notification-list');
      await fulfill(route, { items: [], nextCursor: null });
    } else {
      await route.fallback();
    }
  });
  await page.route('**/api/v1/workspaces**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isAccountB = request.headers().authorization === 'Bearer token-b';
    if (url.pathname === '/api/v1/workspaces' && request.method() === 'GET') {
      await fulfill(route, pageResult([workspace(
        isAccountB ? WORKSPACE_C : WORKSPACE_A,
        isAccountB ? 'Account B workspace' : 'Account A workspace',
        isAccountB ? USER_B : USER_A,
      )]));
    } else if (url.pathname === '/api/v1/workspaces' && request.method() === 'POST') {
      await createWorkspace(route);
    } else if (/\/api\/v1\/workspaces\/[0-9a-f-]+\/members$/.test(url.pathname)) {
      await fulfill(route, pageResult([]));
    } else {
      await route.fallback();
    }
  });

  return { notificationReads, eventOrder };
}

async function openWorkspacePage(page: Page) {
  const authResponse = page.waitForResponse((response) => response.url().includes('/api/auth/me'));
  await page.goto('/workspace');
  await authResponse;
  await expect(page.getByTestId('workspace-create-form')).toBeVisible();
}

test('successful workspace creation invalidates current notifications without creating client records', async ({ page }) => {
  const { notificationReads, eventOrder } = await installFixtures(page, async (route) => {
    eventOrder.push('workspace-create-success');
    await fulfill(route, workspace(WORKSPACE_B, 'Created workspace', USER_A));
  });
  await openWorkspacePage(page);
  await expect.poll(() => notificationReads.filter((item) => item === 'A:count').length).toBeGreaterThan(0);
  const beforeMutation = notificationReads.length;

  await page.getByTestId('workspace-create-name').fill('Created workspace');
  await page.getByTestId('workspace-create-submit').click();
  await expect(page.getByText('Workspace created.', { exact: true })).toHaveCount(1);
  await expect.poll(() => notificationReads.length).toBeGreaterThan(beforeMutation);
  const successIndex = eventOrder.indexOf('workspace-create-success');
  expect(successIndex).toBeGreaterThanOrEqual(0);
  expect(eventOrder.findIndex((event, index) => index > successIndex && event.startsWith('notification-'))).toBeGreaterThan(successIndex);

  await page.getByRole('link', { name: /^Notifications/ }).click();
  await expect(page.getByText('No notifications yet', { exact: true })).toBeVisible();
  await expect(page.getByText('0 unread', { exact: true })).toBeVisible();
});

test('failed workspace creation does not invalidate notifications', async ({ page }) => {
  const { notificationReads } = await installFixtures(page, async (route) => {
    await fulfill(route, {
      error: { code: 'INVALID_REQUEST', message: 'Workspace name rejected', details: [] },
      status: 400,
    }, 400);
  });
  await openWorkspacePage(page);
  await expect.poll(() => notificationReads.filter((item) => item === 'A:count').length).toBeGreaterThan(0);
  const beforeMutation = notificationReads.length;

  await page.getByTestId('workspace-create-name').fill('Rejected workspace');
  await page.getByTestId('workspace-create-submit').click();
  await expect(page.getByTestId('workspace-create-error')).toBeVisible();
  expect(notificationReads).toHaveLength(beforeMutation);
  await expect(page.getByText('Workspace created.', { exact: true })).toHaveCount(0);
});

test('late account-A workspace creation cannot refresh account-B notifications', async ({ page }) => {
  let releaseCreate!: () => void;
  let markCreateStarted!: () => void;
  const createHeld = new Promise<void>((resolve) => { releaseCreate = resolve; });
  const createStarted = new Promise<void>((resolve) => { markCreateStarted = resolve; });
  const { notificationReads } = await installFixtures(page, async (route) => {
    markCreateStarted();
    await createHeld;
    await fulfill(route, workspace(WORKSPACE_B, 'Late A workspace', USER_A));
  });
  await openWorkspacePage(page);
  await page.getByTestId('workspace-create-name').fill('Late A workspace');
  await page.getByTestId('workspace-create-submit').click();
  await createStarted;

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.locator('input[type="email"]').fill('b@example.com');
  await page.locator('input[type="password"]').fill('password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/workspace');
  await expect(page.getByTestId('topbar-workspace-selector')).toHaveValue(WORKSPACE_C);
  await expect.poll(() => notificationReads.filter((item) => item === 'B:count').length).toBeGreaterThan(0);
  const accountBReads = notificationReads.filter((item) => item.startsWith('B:')).length;

  releaseCreate();
  await page.waitForTimeout(100);
  expect(notificationReads.filter((item) => item.startsWith('B:'))).toHaveLength(accountBReads);
  await expect(page.getByText('Workspace created.', { exact: true })).toHaveCount(0);
});
