import { expect, test, type Page, type Route } from '@playwright/test';

const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '10000000-0000-4000-8000-000000000002';
const NOTIFICATION_A = '20000000-0000-4000-8000-000000000001';
const NOTIFICATION_B = '20000000-0000-4000-8000-000000000002';
const WORKSPACE_A = '30000000-0000-4000-8000-000000000001';
const WORKSPACE_B = '30000000-0000-4000-8000-000000000002';
const WORKSPACE_C = '30000000-0000-4000-8000-000000000003';
const WORKFLOW_TARGET = '40000000-0000-4000-8000-000000000001';
const EXECUTION_TARGET = '40000000-0000-4000-8000-000000000002';
const CONNECTION_TARGET = '40000000-0000-4000-8000-000000000003';

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

const notification = (
  id: string,
  title: string,
  read = false,
  options: { category?: string; target?: unknown; workspaceId?: string | null; executionId?: string | null } = {},
) => ({
  id,
  eventType: 'workflow.completed',
  category: options.category ?? 'WORKFLOW',
  severity: 'SUCCESS',
  title,
  message: `${title} message`,
  target: options.target ?? { kind: 'NONE' },
  workspaceId: options.workspaceId ?? null,
  executionId: options.executionId ?? null,
  occurredAt: '2026-09-22T02:00:00Z',
  createdAt: '2026-09-22T02:00:00Z',
  readAt: read ? '2026-09-22T02:01:00Z' : null,
});

async function installAuthFixture(page: Page, token = 'token-a') {
  await page.addInitScript(({ initialToken }) => {
    if (!localStorage.getItem('weav_token')) {
      localStorage.setItem('weav_token', initialToken);
    }
    localStorage.setItem('weav_lang_v1', 'EN');
  }, { initialToken: token });

  await page.route('**/api/auth/me', async (route) => {
    const isUserB = route.request().headers().authorization === 'Bearer token-b';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        isUserB
          ? user(USER_B, 'b@example.com', 'User B')
          : user(USER_A, 'a@example.com', 'User A'),
      ),
    });
  });

  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });
}

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function gotoAuthenticated(page: Page, path = '/notifications') {
  const authResponse = page.waitForResponse((response) => response.url().includes('/api/auth/me'));
  await page.goto(path);
  await authResponse;
  if (new URL(page.url()).pathname === '/login') await page.goto(path);
}

test.describe('web notification HTTP integration', () => {
  test('loads cursor pages through the UI without duplicates and sends bearer auth', async ({ page }) => {
    await installAuthFixture(page);
    const cursors: Array<string | null> = [];
    const authHeaders: string[] = [];
    let refreshCount = 0;

    await page.route('**/api/v2/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      authHeaders.push(request.headers().authorization ?? '');

      if (url.pathname === '/api/v2/notifications/unread-count') {
        await fulfill(route, { count: 2 });
        return;
      }

      if (url.pathname !== '/api/v2/notifications' || request.method() !== 'GET') {
        await route.fallback();
        return;
      }

      const cursor = url.searchParams.get('cursor');
      expect([...url.searchParams.keys()].sort()).toEqual(
        cursor === null ? ['limit', 'locale'] : ['cursor', 'limit', 'locale'],
      );
      expect(url.searchParams.get('locale')).toBe('en');
      expect(url.searchParams.has('status')).toBe(false);
      expect(url.searchParams.has('userId')).toBe(false);
      expect(url.searchParams.has('eventType')).toBe(false);

      cursors.push(cursor);
      if (cursor === null) {
        await fulfill(route, {
          items: [notification(NOTIFICATION_A, 'First notification')],
          nextCursor: 'cursor-page-2',
        });
        return;
      }

      expect(cursor).toBe('cursor-page-2');
      refreshCount += 1;
      await fulfill(route, {
        items: [notification(NOTIFICATION_B, 'Second notification')],
        nextCursor: null,
      });
    });

    await gotoAuthenticated(page);
    await expect(page.getByText('First notification', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByText('Second notification', { exact: true })).toBeVisible();
    await expect(page.getByText('First notification', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Second notification', { exact: true })).toHaveCount(1);

    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(() => refreshCount).toBeGreaterThan(0);
    expect(cursors).toContain(null);
    expect(cursors).toContain('cursor-page-2');
    expect(authHeaders.length).toBeGreaterThan(0);
    expect(authHeaders.every((value) => value === 'Bearer token-a')).toBe(true);
  });

  test('allows only one read-one mutation and refreshes unread count after success', async ({ page }) => {
    await installAuthFixture(page);
    let isRead = false;
    let readCalls = 0;

    await page.route('**/api/v2/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v2/notifications/unread-count') {
        await fulfill(route, { count: isRead ? 0 : 1 });
        return;
      }
      if (url.pathname === '/api/v2/notifications' && request.method() === 'GET') {
        await fulfill(route, {
          items: [notification(NOTIFICATION_A, 'Read me', isRead)],
          nextCursor: null,
        });
        return;
      }
      if (url.pathname === `/api/v2/notifications/${NOTIFICATION_A}/read` && request.method() === 'PATCH') {
        expect(url.searchParams.get('locale')).toBe('en');
        readCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        isRead = true;
        await fulfill(route, { item: notification(NOTIFICATION_A, 'Read me', true) });
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page);
    const markRead = page.getByRole('button', { name: /Mark as read: Read me/ });
    await expect(markRead).toBeVisible();
    await markRead.evaluate((button) => {
      button.dispatchEvent(new Event('click', { bubbles: true }));
      button.dispatchEvent(new Event('click', { bubbles: true }));
    });

    await expect.poll(() => readCalls).toBe(1);
    await expect(page.getByText('Read', { exact: true })).toBeVisible();
    await expect(page.getByText('1 unread', { exact: true })).toHaveCount(0);
    await expect(page.getByText('0 unread', { exact: true })).toBeVisible();
  });

  test('keeps HTTP errors visible and retries read-all only after user action', async ({ page }) => {
    await installAuthFixture(page);
    let isRead = false;
    let readAllCalls = 0;

    await page.route('**/api/v2/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v2/notifications/unread-count') {
        await fulfill(route, { count: isRead ? 0 : 1 });
        return;
      }
      if (url.pathname === '/api/v2/notifications' && request.method() === 'GET') {
        await fulfill(route, {
          items: [notification(NOTIFICATION_A, 'Retry all', isRead)],
          nextCursor: null,
        });
        return;
      }
      if (url.pathname === '/api/v2/notifications/read-all' && request.method() === 'POST') {
        readAllCalls += 1;
        if (readAllCalls === 1) {
          await fulfill(route, {
            error: { code: 'SERVICE_UNAVAILABLE', message: 'Notification service unavailable', details: [] },
            status: 503,
          }, 503);
          return;
        }
        isRead = true;
        await fulfill(route, { updatedCount: 1 });
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page);
    await page.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(page.getByRole('alert').getByText('Unable to update read status. Please try again.')).toBeVisible();
    await expect(page.getByText('0 unread', { exact: true })).toHaveCount(0);
    expect(readAllCalls).toBe(1);

    await page.getByRole('alert').getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => readAllCalls).toBe(2);
    await expect(page.getByText('0 unread', { exact: true })).toBeVisible();
    await expect(page.getByText('Read', { exact: true })).toBeVisible();
  });

  test('shows a 429 list error instead of mock data and retries from the UI', async ({ page }) => {
    await installAuthFixture(page);
    let listCalls = 0;

    await page.route('**/api/v2/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v2/notifications/unread-count') {
        await fulfill(route, { count: 0 });
        return;
      }
      if (url.pathname === '/api/v2/notifications' && request.method() === 'GET') {
        listCalls += 1;
        if (listCalls === 1) {
          await fulfill(route, {
            error: { code: 'NOTIFICATION_RATE_LIMITED', message: 'try later', details: [] },
            status: 429,
          }, 429);
          return;
        }
        await fulfill(route, { items: [], nextCursor: null });
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page);
    await expect(page.getByRole('alert').getByText('Unable to load notifications. Please try again.')).toBeVisible();
    await expect(page.getByText('No notifications yet', { exact: true })).toHaveCount(0);
    expect(listCalls).toBe(1);

    await page.getByRole('alert').getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => listCalls).toBe(2);
    await expect(page.getByText('No notifications yet', { exact: true })).toBeVisible();
  });

  test('applies category and unread filters, switches stored locale, and keeps count global', async ({ page }) => {
    await installAuthFixture(page);
    const listQueries: URLSearchParams[] = [];
    await page.route('**/api/v2/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v2/notifications/unread-count') {
        await fulfill(route, { count: 7 });
        return;
      }
      if (url.pathname !== '/api/v2/notifications' || request.method() !== 'GET') {
        await route.fallback();
        return;
      }
      listQueries.push(url.searchParams);
      expect([...url.searchParams.keys()].every((key) =>
        ['limit', 'cursor', 'unreadOnly', 'category', 'locale'].includes(key),
      )).toBe(true);
      const category = url.searchParams.get('category');
      const locale = url.searchParams.get('locale');
      if (locale === 'vi') await new Promise((resolve) => setTimeout(resolve, 250));
      const title = locale === 'vi'
        ? 'Thông báo tiếng Việt'
        : category === 'WORKSPACE' ? 'Workspace filtered' : 'English inbox';
      await fulfill(route, {
        items: [notification(
          category === 'WORKSPACE' ? NOTIFICATION_B : NOTIFICATION_A,
          title,
          false,
          { category: category ?? 'WORKFLOW' },
        )],
        nextCursor: null,
      });
    });

    await gotoAuthenticated(page);
    await expect(page.getByText('English inbox', { exact: true })).toBeVisible();
    await expect(page.getByText('7 unread', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Category' }).selectOption('WORKSPACE');
    await expect(page.getByText('Workspace filtered', { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Unread only' }).check();
    await expect.poll(() => listQueries.at(-1)?.get('unreadOnly')).toBe('true');
    expect(listQueries.at(-1)?.get('category')).toBe('WORKSPACE');

    await page.getByRole('button', { name: 'Switch to Vietnamese' }).click();
    await expect(page.getByText('Workspace filtered', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Thông báo tiếng Việt', { exact: true })).toBeVisible();
    expect(listQueries.at(-1)?.get('locale')).toBe('vi');
    expect(listQueries.at(-1)?.get('category')).toBe('WORKSPACE');
    expect(listQueries.at(-1)?.get('unreadOnly')).toBe('true');
    await expect(page.getByText('7 chưa đọc', { exact: true })).toBeVisible();
  });

  test('unknown metadata and removed-member targets render safely without navigation', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/v2/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v2/notifications/unread-count') {
        await fulfill(route, { count: 2 });
        return;
      }
      if (url.pathname === '/api/v2/notifications' && request.method() === 'GET') {
        await fulfill(route, {
          items: [
            {
              ...notification(NOTIFICATION_A, 'Future event'),
              eventType: 'future.unrecognized_event',
              category: 'FUTURE_CATEGORY',
              severity: 'FUTURE_SEVERITY',
              target: { kind: 'WORKFLOW', workspaceId: 'not-a-uuid', workflowId: 'javascript:alert(1)' },
            },
            {
              ...notification(NOTIFICATION_B, 'Removed from workspace'),
              eventType: 'workspace.member_removed',
              category: 'WORKSPACE',
              workspaceId: WORKSPACE_A,
              target: { kind: 'WORKSPACE', workspaceId: WORKSPACE_A },
            },
          ],
          nextCursor: null,
        });
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page);
    await expect(page.getByText('Future event', { exact: true })).toBeVisible();
    await expect(page.getByText('Notification', { exact: true })).toHaveCount(2);
    await expect(page.getByRole('button', { name: /Open related item/ })).toHaveCount(0);
    await expect(page.getByText('Removed from workspace', { exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/notifications');
  });

  test('keeps a created workspace selected while list synchronization is delayed', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/v2/notifications/unread-count', (route) => fulfill(route, { count: 0 }));

    const pageResult = (items: unknown[]) => ({
      items,
      page: 0,
      size: 20,
      totalElements: items.length,
      totalPages: items.length ? 1 : 0,
    });
    const workspace = (id: string, name: string) => ({
      id,
      name,
      createdBy: USER_A,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    });
    const created = workspace(WORKSPACE_C, 'Created from browser');
    let listCalls = 0;
    let signalRefetchStarted!: () => void;
    const refetchStarted = new Promise<void>((resolve) => { signalRefetchStarted = resolve; });
    let releaseRefetch!: () => void;
    const refetchGate = new Promise<void>((resolve) => { releaseRefetch = resolve; });

    await page.route('**/api/v1/workspaces**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v1/workspaces' && request.method() === 'GET') {
        listCalls += 1;
        if (listCalls === 1) {
          await fulfill(route, pageResult([workspace(WORKSPACE_A, 'Workspace A')]));
          return;
        }
        signalRefetchStarted();
        await refetchGate;
        await fulfill(route, pageResult([workspace(WORKSPACE_A, 'Workspace A'), created]));
        return;
      }
      if (url.pathname === '/api/v1/workspaces' && request.method() === 'POST') {
        await fulfill(route, created, 201);
        return;
      }
      if (/\/api\/v1\/workspaces\/[0-9a-f-]+\/members$/.test(url.pathname)) {
        await fulfill(route, pageResult([]));
        return;
      }
      await fulfill(route, { error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    });

    await gotoAuthenticated(page, '/workspace');
    const selector = page.getByTestId('topbar-workspace-selector');
    await expect(selector).toHaveValue(WORKSPACE_A);

    try {
      await page.getByTestId('workspace-create-name').fill('Created from browser');
      const createResponse = page.waitForResponse((response) =>
        response.url().endsWith('/api/v1/workspaces') && response.request().method() === 'POST');
      await page.getByTestId('workspace-create-submit').click();
      await createResponse;
      await refetchStarted;

      await expect(selector).toHaveValue(WORKSPACE_C);
      await expect(selector.locator(`option[value="${WORKSPACE_C}"]`)).toHaveText('Created from browser');
      await expect(page.getByTestId('workspace-selected-heading')).toHaveText('Created from browser');
    } finally {
      releaseRefetch();
    }

    await expect(selector).toHaveAttribute('aria-busy', 'false');
    await expect(selector).toHaveValue(WORKSPACE_C);
  });

  test('keeps a renamed workspace in the canonical list when switching during delayed synchronization', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/v2/notifications/unread-count', (route) => fulfill(route, { count: 0 }));

    const pageResult = (items: unknown[]) => ({
      items,
      page: 0,
      size: 20,
      totalElements: items.length,
      totalPages: items.length ? 1 : 0,
    });
    const workspace = (id: string, name: string) => ({
      id,
      name,
      createdBy: USER_A,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    });
    let listCalls = 0;
    let renamed = workspace(WORKSPACE_A, 'Workspace A renamed');
    const workspaceB = workspace(WORKSPACE_B, 'Workspace B');
    let signalRefetchStarted!: () => void;
    const refetchStarted = new Promise<void>((resolve) => { signalRefetchStarted = resolve; });
    let releaseRefetch!: () => void;
    const refetchGate = new Promise<void>((resolve) => { releaseRefetch = resolve; });

    await page.route('**/api/v1/workspaces**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v1/workspaces' && request.method() === 'GET') {
        listCalls += 1;
        if (listCalls === 1) {
          await fulfill(route, pageResult([workspace(WORKSPACE_A, 'Workspace A'), workspaceB]));
          return;
        }
        signalRefetchStarted();
        await refetchGate;
        await fulfill(route, pageResult([renamed, workspaceB]));
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}` && request.method() === 'PATCH') {
        renamed = { ...renamed, name: 'Workspace A renamed' };
        await fulfill(route, renamed);
        return;
      }
      if (/\/api\/v1\/workspaces\/[0-9a-f-]+\/members$/.test(url.pathname)) {
        await fulfill(route, pageResult([]));
        return;
      }
      await fulfill(route, { error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    });

    await gotoAuthenticated(page, '/workspace');
    const selector = page.getByTestId('topbar-workspace-selector');
    await expect(selector).toHaveValue(WORKSPACE_A);

    try {
      await page.getByTestId('workspace-rename-name').fill('Workspace A renamed');
      const renameResponse = page.waitForResponse((response) =>
        response.url().endsWith(`/api/v1/workspaces/${WORKSPACE_A}`) && response.request().method() === 'PATCH');
      await page.getByTestId('workspace-rename-submit').click();
      await renameResponse;
      await refetchStarted;

      await selector.selectOption(WORKSPACE_B);
      await expect(selector).toHaveValue(WORKSPACE_B);
      await expect(selector.locator(`option[value="${WORKSPACE_A}"]`)).toHaveText('Workspace A renamed');
      await expect(page.getByTestId('workspace-selected-heading')).toHaveText('Workspace B');
    } finally {
      releaseRefetch();
    }

    await expect(selector).toHaveAttribute('aria-busy', 'false');
    await expect(selector).toHaveValue(WORKSPACE_B);
    await expect(selector.locator(`option[value="${WORKSPACE_A}"]`)).toHaveText('Workspace A renamed');
  });

  test('navigates only through validated targets and selects an authorized workspace outside the first page', async ({ page }) => {
    let workspaceDetailCalls = 0;
    const memberRequestWorkspaceIds: string[] = [];
    let releaseWorkspaceList!: () => void;
    let markWorkspaceListStarted!: () => void;
    let markWorkspaceListFinished!: () => void;
    const workspaceListHeld = new Promise<void>((resolve) => { releaseWorkspaceList = resolve; });
    const workspaceListStarted = new Promise<void>((resolve) => { markWorkspaceListStarted = resolve; });
    const workspaceListFinished = new Promise<void>((resolve) => { markWorkspaceListFinished = resolve; });
    const pageResult = (items: unknown[]) => ({
      items,
      page: 0,
      size: 20,
      totalElements: items.length,
      totalPages: items.length ? 1 : 0,
    });
    const workspace = (id: string, name: string) => ({
      id,
      name,
      createdBy: USER_A,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    });

    await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
      await fulfill(route, { error: { code: 'NOT_FOUND', message: 'Not found', details: [] }, status: 404 }, 404);
    });
    await page.route('**/users/me/oauth-accounts', async (route) => fulfill(route, []));
    await installAuthFixture(page);
    await page.route('**/api/v2/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v2/notifications/unread-count' && request.method() === 'GET') {
        await fulfill(route, { count: 5 });
        return;
      }
      if (url.pathname !== '/api/v2/notifications' || request.method() !== 'GET') return route.fallback();
      await fulfill(route, {
        items: [
          notification(NOTIFICATION_A, 'Workflow target', false, {
            category: 'WORKFLOW', workspaceId: WORKSPACE_B,
            target: { kind: 'WORKFLOW', workspaceId: WORKSPACE_B, workflowId: WORKFLOW_TARGET },
          }),
          notification(NOTIFICATION_B, 'Execution target', false, {
            category: 'WORKFLOW', workspaceId: WORKSPACE_B, executionId: EXECUTION_TARGET,
            target: { kind: 'EXECUTION', workspaceId: WORKSPACE_B, executionId: EXECUTION_TARGET },
          }),
          notification('20000000-0000-4000-8000-000000000003', 'Workspace target', false, {
            category: 'WORKSPACE', workspaceId: WORKSPACE_B,
            target: { kind: 'WORKSPACE', workspaceId: WORKSPACE_B },
          }),
          notification('20000000-0000-4000-8000-000000000004', 'Connection target', false, {
            category: 'CONNECTION', workspaceId: WORKSPACE_B,
            target: { kind: 'CONNECTION', workspaceId: WORKSPACE_B, connectionId: CONNECTION_TARGET },
          }),
          notification('20000000-0000-4000-8000-000000000005', 'Security target', false, {
            category: 'SECURITY', target: { kind: 'SECURITY_SETTINGS' },
          }),
        ],
        nextCursor: null,
      });
    });
    await page.route('**/api/v1/workspaces**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v1/workspaces' && request.method() === 'GET') {
        markWorkspaceListStarted();
        await workspaceListHeld;
        await fulfill(route, pageResult([workspace(WORKSPACE_A, 'First-page workspace')]));
        markWorkspaceListFinished();
      } else if (url.pathname === `/api/v1/workspaces/${WORKSPACE_B}` && request.method() === 'GET') {
        workspaceDetailCalls += 1;
        await fulfill(route, workspace(WORKSPACE_B, 'Authorized later-page workspace'));
      } else if (/\/api\/v1\/workspaces\/[0-9a-f-]+\/members$/.test(url.pathname)) {
        memberRequestWorkspaceIds.push(url.pathname.split('/')[4]);
        await fulfill(route, pageResult([]));
      } else {
        await route.fallback();
      }
    });

    await gotoAuthenticated(page);
    await workspaceListStarted;
    await expect(page.getByText('Workspace target', { exact: true })).toBeVisible();
    const targets = [
      ['Workspace target', '/workspace'],
      ['Workflow target', `/workflows/${WORKFLOW_TARGET}`],
      ['Execution target', `/executions/${EXECUTION_TARGET}`],
      ['Connection target', '/connections'],
      ['Security target', '/settings/security'],
    ] as const;
    for (const [index, [title, route]] of targets.entries()) {
      await expect(page.getByText(title, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: `Open related item: ${title}` }).click();
      await expect(page).toHaveURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
      if (route !== '/settings/security') {
        await expect(page.getByTestId('topbar-workspace-selector')).toHaveValue(WORKSPACE_B);
      }
      if (index === 0) {
        await expect.poll(() => workspaceDetailCalls).toBeGreaterThan(0);
        await expect.poll(() => memberRequestWorkspaceIds).toContain(WORKSPACE_B);
        releaseWorkspaceList();
        await workspaceListFinished;
        await expect(page.getByTestId('topbar-workspace-selector')).toHaveAttribute('aria-busy', 'false');
        await expect(page.getByTestId('topbar-workspace-selector')).toHaveValue(WORKSPACE_B);
        await expect.poll(() => memberRequestWorkspaceIds.filter((id) => id === WORKSPACE_B).length).toBeGreaterThan(0);
      }
      if (title !== 'Security target') {
        await page.getByRole('link', { name: /^Notifications/ }).click();
        await expect(page.getByText(title, { exact: true })).toBeVisible();
      }
    }
    expect(workspaceDetailCalls).toBeGreaterThan(0);
  });

  test('refuses a workspace target when the authorized lookup denies access', async ({ page }) => {
    const pageResult = (items: unknown[]) => ({
      items, page: 0, size: 20, totalElements: items.length, totalPages: items.length ? 1 : 0,
    });
    const workspace = {
      id: WORKSPACE_A,
      name: 'First-page workspace',
      createdBy: USER_A,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };
    let deniedLookups = 0;

    await installAuthFixture(page);
    await page.route('**/api/v2/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v2/notifications/unread-count') {
        await fulfill(route, { count: 1 });
      } else if (url.pathname === '/api/v2/notifications' && request.method() === 'GET') {
        await fulfill(route, {
          items: [notification('20000000-0000-4000-8000-000000000006', 'Restricted workspace', false, {
            category: 'WORKSPACE', workspaceId: WORKSPACE_B,
            target: { kind: 'WORKSPACE', workspaceId: WORKSPACE_B },
          })],
          nextCursor: null,
        });
      } else {
        await route.fallback();
      }
    });
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces' && route.request().method() === 'GET') {
        await fulfill(route, pageResult([workspace]));
      } else if (url.pathname === `/api/v1/workspaces/${WORKSPACE_B}` && route.request().method() === 'GET') {
        deniedLookups += 1;
        await fulfill(route, {
          error: { code: 'FORBIDDEN', message: 'Access denied', retryable: false },
          requestId: 'e2e-denied-workspace',
        }, 403);
      } else {
        await route.fallback();
      }
    });

    await gotoAuthenticated(page);
    await page.getByRole('button', { name: 'Open related item: Restricted workspace' }).click();
    await expect(page.getByText('This item cannot be opened because access is no longer available.')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/notifications');
    await expect(page.getByTestId('topbar-workspace-selector')).toHaveValue(WORKSPACE_A);
    expect(deniedLookups).toBe(1);
  });

  test('revokes a notification-authorized workspace after a later access denial', async ({ page }) => {
    const pageResult = (items: unknown[]) => ({
      items, page: 0, size: 20, totalElements: items.length, totalPages: items.length ? 1 : 0,
    });
    const workspace = (id: string, name: string) => ({
      id,
      name,
      createdBy: USER_A,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    });
    let workspaceLookups = 0;

    await installAuthFixture(page);
    await page.route('**/api/v2/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v2/notifications/unread-count') {
        await fulfill(route, { count: 1 });
      } else if (url.pathname === '/api/v2/notifications' && request.method() === 'GET') {
        await fulfill(route, {
          items: [notification('20000000-0000-4000-8000-000000000007', 'Revoked workspace', false, {
            category: 'WORKSPACE', workspaceId: WORKSPACE_B,
            target: { kind: 'WORKSPACE', workspaceId: WORKSPACE_B },
          })],
          nextCursor: null,
        });
      } else {
        await route.fallback();
      }
    });
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces' && route.request().method() === 'GET') {
        await fulfill(route, pageResult([workspace(WORKSPACE_A, 'First-page workspace')]));
      } else if (url.pathname === `/api/v1/workspaces/${WORKSPACE_B}` && route.request().method() === 'GET') {
        workspaceLookups += 1;
        if (workspaceLookups === 1) {
          await fulfill(route, workspace(WORKSPACE_B, 'Authorized later-page workspace'));
        } else {
          await fulfill(route, {
            error: { code: 'FORBIDDEN', message: 'Access denied', retryable: false },
            requestId: 'e2e-revoked-workspace',
          }, 403);
        }
      } else if (/\/api\/v1\/workspaces\/[0-9a-f-]+\/members$/.test(url.pathname)) {
        await fulfill(route, pageResult([]));
      } else {
        await route.fallback();
      }
    });

    await gotoAuthenticated(page);
    await page.getByRole('button', { name: 'Open related item: Revoked workspace' }).click();
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByTestId('topbar-workspace-selector')).toHaveValue(WORKSPACE_B);
    await page.getByRole('link', { name: /^Notifications/ }).click();
    await page.getByRole('button', { name: 'Open related item: Revoked workspace' }).click();

    await expect(page.getByText('This item cannot be opened because access is no longer available.')).toBeVisible();
    await expect(page.getByTestId('topbar-workspace-selector')).toHaveValue(WORKSPACE_A);
    expect(new URL(page.url()).pathname).toBe('/notifications');
    expect(workspaceLookups).toBe(2);
  });

  test('clears a notification-authorized workspace when the authenticated account changes', async ({ page }) => {
    const pageResult = (items: unknown[]) => ({
      items, page: 0, size: 20, totalElements: items.length, totalPages: items.length ? 1 : 0,
    });
    const workspace = (id: string, name: string) => ({
      id,
      name,
      createdBy: USER_A,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    });

    await installAuthFixture(page);
    await page.route('**/api/auth/login', async (route) => {
      await fulfill(route, {
        accessToken: 'token-b',
        refreshToken: 'refresh-token-b',
        user: user(USER_B, 'b@example.com', 'User B'),
      });
    });
    await page.route('**/api/v2/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v2/notifications/unread-count') {
        await fulfill(route, { count: 0 });
      } else if (url.pathname === '/api/v2/notifications' && request.method() === 'GET') {
        const token = request.headers().authorization;
        await fulfill(route, {
          items: token === 'Bearer token-a'
            ? [notification('20000000-0000-4000-8000-000000000008', 'Account A workspace', false, {
              category: 'WORKSPACE', workspaceId: WORKSPACE_B,
              target: { kind: 'WORKSPACE', workspaceId: WORKSPACE_B },
            })]
            : [],
          nextCursor: null,
        });
      } else {
        await route.fallback();
      }
    });
    await page.route('**/api/v1/workspaces**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const token = request.headers().authorization;
      if (url.pathname === '/api/v1/workspaces' && request.method() === 'GET') {
        await fulfill(route, pageResult(token === 'Bearer token-b'
          ? [workspace(WORKSPACE_C, 'Account B workspace')]
          : [workspace(WORKSPACE_A, 'Account A workspace')]), 200);
      } else if (url.pathname === `/api/v1/workspaces/${WORKSPACE_B}` && request.method() === 'GET') {
        await fulfill(route, workspace(WORKSPACE_B, 'Authorized later-page workspace'));
      } else if (/\/api\/v1\/workspaces\/[0-9a-f-]+\/members$/.test(url.pathname)) {
        await fulfill(route, pageResult([]));
      } else {
        await route.fallback();
      }
    });

    await gotoAuthenticated(page);
    await page.getByRole('button', { name: 'Open related item: Account A workspace' }).click();
    await expect(page.getByTestId('topbar-workspace-selector')).toHaveValue(WORKSPACE_B);
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.locator('input[type="email"]').fill('b@example.com');
    await page.locator('input[type="password"]').fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/workspace');

    await expect(page.getByTestId('topbar-workspace-selector')).toHaveValue(WORKSPACE_C);
    await expect(page.getByTestId('topbar-workspace-selector').locator(`option[value="${WORKSPACE_B}"]`)).toHaveCount(0);
  });

  test('supersedes a pending workspace lookup when a later target is opened', async ({ page }) => {
    const pageResult = (items: unknown[]) => ({
      items, page: 0, size: 20, totalElements: items.length, totalPages: items.length ? 1 : 0,
    });
    const workspace = {
      id: WORKSPACE_A,
      name: 'First-page workspace',
      createdBy: USER_A,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };
    let releaseWorkspaceLookup!: () => void;
    let markWorkspaceLookupStarted!: () => void;
    let markWorkspaceLookupFinished!: () => void;
    const workspaceLookupHeld = new Promise<void>((resolve) => { releaseWorkspaceLookup = resolve; });
    const workspaceLookupStarted = new Promise<void>((resolve) => { markWorkspaceLookupStarted = resolve; });
    const workspaceLookupFinished = new Promise<void>((resolve) => { markWorkspaceLookupFinished = resolve; });

    await installAuthFixture(page);
    await page.route('**/api/v2/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v2/notifications/unread-count') {
        await fulfill(route, { count: 2 });
      } else if (url.pathname === '/api/v2/notifications' && request.method() === 'GET') {
        await fulfill(route, {
          items: [
            notification('20000000-0000-4000-8000-000000000007', 'Slow workspace target', false, {
              category: 'WORKSPACE', workspaceId: WORKSPACE_B,
              target: { kind: 'WORKSPACE', workspaceId: WORKSPACE_B },
            }),
            notification('20000000-0000-4000-8000-000000000008', 'Immediate security target', false, {
              category: 'SECURITY', target: { kind: 'SECURITY_SETTINGS' },
            }),
          ],
          nextCursor: null,
        });
      } else {
        await route.fallback();
      }
    });
    await page.route('**/api/v1/workspaces**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/v1/workspaces' && request.method() === 'GET') {
        await fulfill(route, pageResult([workspace]));
      } else if (url.pathname === `/api/v1/workspaces/${WORKSPACE_B}` && request.method() === 'GET') {
        markWorkspaceLookupStarted();
        await workspaceLookupHeld;
        try {
          await fulfill(route, {
            id: WORKSPACE_B,
            name: 'Authorized delayed workspace',
            createdBy: USER_A,
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
          });
        } catch {
          // A later target may abort this request; the pending navigator must stay superseded.
        } finally {
          markWorkspaceLookupFinished();
        }
      } else {
        await route.fallback();
      }
    });

    await gotoAuthenticated(page);
    await page.getByRole('button', { name: 'Open related item: Slow workspace target' }).click();
    await workspaceLookupStarted;
    await page.getByRole('button', { name: 'Open related item: Immediate security target' }).click();
    await expect(page).toHaveURL(/\/settings\/security$/);
    releaseWorkspaceLookup();
    await workspaceLookupFinished;
    await expect(page).toHaveURL(/\/settings\/security$/);
    await expect(page.getByTestId('topbar-workspace-selector')).toHaveValue(WORKSPACE_A);
    await expect(page.getByText('This item cannot be opened because access is no longer available.')).toHaveCount(0);
  });

  test('does not show a late account-A response after logout and account-B login', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/auth/login', async (route) => {
      await fulfill(route, {
        accessToken: 'token-b',
        refreshToken: 'refresh-token-b',
        user: user(USER_B, 'b@example.com', 'User B'),
      });
    });

    let releaseUserA!: () => void;
    const userAStarted = new Promise<void>((resolve) => {
      releaseUserA = resolve;
    });
    let aListStarted!: () => void;
    const aListRequest = new Promise<void>((resolve) => {
      aListStarted = resolve;
    });

    await page.route('**/api/v2/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const token = request.headers().authorization;
      if (url.pathname === '/api/v2/notifications/unread-count') {
        await fulfill(route, { count: 0 });
        return;
      }
      if (url.pathname !== '/api/v2/notifications' || request.method() !== 'GET') {
        await route.fallback();
        return;
      }
      if (token === 'Bearer token-a') {
        aListStarted();
        await userAStarted;
        await fulfill(route, {
          items: [notification(NOTIFICATION_A, 'Account A late response')],
          nextCursor: null,
        });
        return;
      }
      await fulfill(route, {
        items: [notification(NOTIFICATION_B, 'Account B notification')],
        nextCursor: null,
      });
    });

    await gotoAuthenticated(page);
    await aListRequest;
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.locator('input[type="email"]').fill('b@example.com');
    await page.locator('input[type="password"]').fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/notifications');
    await expect(page.getByText('Account B notification', { exact: true })).toBeVisible();

    releaseUserA();
    await page.waitForTimeout(50);
    await expect(page.getByText('Account B notification', { exact: true })).toBeVisible();
    await expect(page.getByText('Account A late response', { exact: true })).toHaveCount(0);
  });
});
