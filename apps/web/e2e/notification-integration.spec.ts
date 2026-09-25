import { expect, test, type Page, type Route } from '@playwright/test';

const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '10000000-0000-4000-8000-000000000002';
const NOTIFICATION_A = '20000000-0000-4000-8000-000000000001';
const NOTIFICATION_B = '20000000-0000-4000-8000-000000000002';

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
  userId = USER_A,
  read = false,
) => ({
  id,
  userId,
  executionId: null,
  provider: 'EXPO_PUSH',
  eventType: 'workflow.completed',
  title,
  message: `${title} message`,
  status: 'SENT',
  read,
  readAt: read ? '2026-09-22T02:01:00Z' : null,
  scheduledAt: null,
  sentAt: '2026-09-22T02:00:00Z',
  createdAt: '2026-09-22T02:00:00Z',
  updatedAt: '2026-09-22T02:01:00Z',
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

    await page.route('**/api/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      authHeaders.push(request.headers().authorization ?? '');

      if (url.pathname === '/api/notifications/unread-count') {
        await fulfill(route, { count: 2 });
        return;
      }

      if (url.pathname !== '/api/notifications' || request.method() !== 'GET') {
        await route.fallback();
        return;
      }

      const cursor = url.searchParams.get('cursor');
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
    await expect(page.getByText('Delivered', { exact: true })).toBeVisible();
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

    await page.route('**/api/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/notifications/unread-count') {
        await fulfill(route, { count: isRead ? 0 : 1 });
        return;
      }
      if (url.pathname === '/api/notifications' && request.method() === 'GET') {
        await fulfill(route, {
          items: [notification(NOTIFICATION_A, 'Read me', USER_A, isRead)],
          nextCursor: null,
        });
        return;
      }
      if (url.pathname === `/api/notifications/${NOTIFICATION_A}/read` && request.method() === 'PATCH') {
        readCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        isRead = true;
        await fulfill(route, { item: notification(NOTIFICATION_A, 'Read me', USER_A, true) });
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

    await page.route('**/api/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/notifications/unread-count') {
        await fulfill(route, { count: isRead ? 0 : 1 });
        return;
      }
      if (url.pathname === '/api/notifications' && request.method() === 'GET') {
        await fulfill(route, {
          items: [notification(NOTIFICATION_A, 'Retry all', USER_A, isRead)],
          nextCursor: null,
        });
        return;
      }
      if (url.pathname === '/api/notifications/read-all' && request.method() === 'POST') {
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

    await page.route('**/api/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/notifications/unread-count') {
        await fulfill(route, { count: 0 });
        return;
      }
      if (url.pathname === '/api/notifications' && request.method() === 'GET') {
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

    await page.route('**/api/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const token = request.headers().authorization;
      if (url.pathname === '/api/notifications/unread-count') {
        await fulfill(route, { count: 0 });
        return;
      }
      if (url.pathname !== '/api/notifications' || request.method() !== 'GET') {
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
        items: [notification(NOTIFICATION_B, 'Account B notification', USER_B)],
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
