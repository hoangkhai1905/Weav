import { expect, test, type Page, type Route } from '@playwright/test';

const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '10000000-0000-4000-8000-000000000002';
const CURRENT_SESSION = '20000000-0000-4000-8000-000000000001';
const OTHER_SESSION = '20000000-0000-4000-8000-000000000002';
const PAGE_TWO_SESSION = '20000000-0000-4000-8000-000000000003';

const identityUser = (id: string, email: string, displayName: string | null) => ({
  id,
  email,
  displayName,
  avatarStorageKey: null,
  systemRole: 'USER',
  status: 'ACTIVE',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-09-22T02:00:00Z',
  emailVerifiedAt: null,
});

const sessionView = (id: string, userAgent: string, current = false) => ({
  id,
  createdAt: '2026-09-20T10:00:00Z',
  lastUsedAt: '2026-09-22T02:00:00Z',
  expiresAt: '2026-10-20T10:00:00Z',
  current,
  userAgent,
});

const sessionPage = (
  items: unknown[],
  page = 0,
  totalPages = 1,
  totalItems = items.length,
) => ({
  items,
  page,
  size: 20,
  totalItems,
  totalPages,
});

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installAuthFixture(page: Page, token = 'token-a') {
  await page.addInitScript(({ initialToken }) => {
    sessionStorage.clear();
    if (!localStorage.getItem('weav_token')) {
      localStorage.setItem('weav_token', initialToken);
    }
    localStorage.setItem('weav_lang_v1', 'EN');
  }, { initialToken: token });

  await page.route('**/api/auth/me', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }

    const isUserB = route.request().headers().authorization === 'Bearer token-b';
    await fulfillJson(
      route,
      isUserB
        ? identityUser(USER_B, 'b@example.com', 'User B')
        : identityUser(USER_A, 'a@example.com', 'User A'),
    );
  });

  await page.route('**/api/auth/login', async (route) => {
    await fulfillJson(route, {
      accessToken: 'token-b',
      refreshToken: 'refresh-token-b',
      user: identityUser(USER_B, 'b@example.com', 'User B'),
    });
  });

  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });

  await page.route('**/api/auth/sessions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, sessionPage([]));
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });

  await page.route('**/users/me/oauth-accounts', async (route) => {
    await fulfillJson(route, []);
  });

  await page.route('**/api/notifications**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/unread-count')) {
      await fulfillJson(route, { count: 0 });
      return;
    }
    await fulfillJson(route, { items: [], nextCursor: null });
  });
}

async function gotoSecurity(page: Page) {
  const waitForAuth = () => page.waitForResponse((response) => (
    response.url().includes('/api/auth/me') && response.request().method() === 'GET'
  ));
  const authResponse = waitForAuth();
  await page.goto('/settings/security', { waitUntil: 'domcontentloaded' });
  await authResponse;
  if (new URL(page.url()).pathname === '/login') {
    const retryAuthResponse = waitForAuth();
    await page.goto('/settings/security', { waitUntil: 'domcontentloaded' });
    await retryAuthResponse;
  }
  await expect(page.getByTestId('settings-profile-page')).toBeVisible();
}

test.describe('web auth session management HTTP integration', () => {
  test('loads contract metadata and navigates zero-based session pages', async ({ page }) => {
    await installAuthFixture(page);
    const sessionRequests: URL[] = [];

    await page.route('**/api/auth/sessions**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }

      const requestUrl = new URL(route.request().url());
      sessionRequests.push(requestUrl);
      const requestedPage = Number(requestUrl.searchParams.get('page'));
      if (requestedPage === 0) {
        await fulfillJson(route, sessionPage([
          { ...sessionView(CURRENT_SESSION, 'Chrome on test workstation', true), ipAddress: '198.51.100.10' },
          sessionView(OTHER_SESSION, 'Safari on test tablet'),
        ], 0, 2, 3));
        return;
      }

      await fulfillJson(route, sessionPage([
        sessionView(PAGE_TWO_SESSION, 'Edge on test laptop'),
      ], 1, 2, 3));
    });

    await gotoSecurity(page);
    await expect(page.getByText('Chrome on test workstation')).toBeVisible();
    await expect(page.getByText('Safari on test tablet', { exact: true })).toBeVisible();
    await expect(page.getByText('(current)', { exact: true })).toBeVisible();
    await expect(page.getByText('198.51.100.10', { exact: true })).toHaveCount(0);
    expect(sessionRequests[0]?.searchParams.get('page')).toBe('0');
    expect(sessionRequests[0]?.searchParams.get('size')).toBe('20');

    await page.getByTestId('sessions-next-page').click();
    await expect(page.getByText('Edge on test laptop', { exact: true })).toBeVisible();
    const pageOneRequests = sessionRequests.filter((requestUrl) => requestUrl.searchParams.get('page') === '1');
    expect(pageOneRequests).toHaveLength(1);
    expect(pageOneRequests[0]?.searchParams.get('size')).toBe('20');
  });

  test('shows loading and empty states for a delayed empty response', async ({ page }) => {
    await installAuthFixture(page);
    let releaseSessions!: () => void;
    const sessionsReleased = new Promise<void>((resolve) => { releaseSessions = resolve; });

    await page.route('**/api/auth/sessions**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await sessionsReleased;
      await fulfillJson(route, sessionPage([]));
    });

    await gotoSecurity(page);
    await expect(page.getByTestId('sessions-loading')).toBeVisible();
    releaseSessions();
    await expect(page.getByTestId('sessions-empty')).toBeVisible();
  });

  test('shows safe error and retries the session list without exposing upstream text', async ({ page }) => {
    await installAuthFixture(page);
    let getCalls = 0;
    let allowSuccess = false;

    await page.route('**/api/auth/sessions**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      getCalls += 1;
      if (!allowSuccess) {
        await fulfillJson(route, { message: 'internal session database details' }, 503);
        return;
      }
      await fulfillJson(route, sessionPage([sessionView(OTHER_SESSION, 'Safari on test tablet')]));
    });

    await gotoSecurity(page);
    await expect(page.getByTestId('sessions-error').getByText('Sessions are temporarily unavailable. Please try again.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('sessions-error')).not.toContainText('internal session database details');
    allowSuccess = true;
    await page.getByTestId('sessions-retry').click();
    await expect(page.getByText('Safari on test tablet', { exact: true })).toBeVisible();
    expect(getCalls).toBeGreaterThan(1);
  });

  test('requires confirmation, sends no request on cancel, then refetches after one-session revoke', async ({ page }) => {
    await installAuthFixture(page);
    let getCalls = 0;
    let deleteCalls = 0;
    let revoked = false;

    await page.route('**/api/auth/sessions**', async (route) => {
      if (route.request().method() === 'GET') {
        getCalls += 1;
        await fulfillJson(route, revoked
          ? sessionPage([])
          : sessionPage([sessionView(OTHER_SESSION, 'Safari on test tablet')]));
        return;
      }
      deleteCalls += 1;
      revoked = true;
      expect(new URL(route.request().url()).pathname).toBe(`/api/auth/sessions/${OTHER_SESSION}`);
      await route.fulfill({ status: 204, body: '' });
    });

    await gotoSecurity(page);
    await page.getByTestId(`session-revoke-button-${OTHER_SESSION}`).click();
    await expect(page.getByRole('heading', { name: 'Revoke this session?' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Revoke this session?' })).toHaveCount(0);
    expect(deleteCalls).toBe(0);
    await expect(page.getByText('Safari on test tablet', { exact: true })).toBeVisible();

    await page.getByTestId(`session-revoke-button-${OTHER_SESSION}`).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect.poll(() => deleteCalls).toBe(1);
    await expect.poll(() => getCalls).toBeGreaterThan(1);
    await expect(page.getByTestId('sessions-empty')).toBeVisible();
  });

  test('prevents duplicate revoke requests while the confirmed mutation is pending', async ({ page }) => {
    await installAuthFixture(page);
    let deleteCalls = 0;
    let getCalls = 0;
    let revoked = false;
    let releaseDelete!: () => void;
    const deleteReleased = new Promise<void>((resolve) => { releaseDelete = resolve; });

    await page.route('**/api/auth/sessions**', async (route) => {
      if (route.request().method() === 'GET') {
        getCalls += 1;
        await fulfillJson(route, revoked
          ? sessionPage([])
          : sessionPage([sessionView(OTHER_SESSION, 'Safari on test tablet')]));
        return;
      }
      deleteCalls += 1;
      revoked = true;
      await deleteReleased;
      await route.fulfill({ status: 204, body: '' });
    });

    await gotoSecurity(page);
    await page.getByTestId(`session-revoke-button-${OTHER_SESSION}`).click();
    const confirmButton = page.getByRole('button', { name: 'Confirm', exact: true });
    const confirmElement = await confirmButton.elementHandle();
    expect(confirmElement).not.toBeNull();
    await confirmButton.click();
    await expect.poll(() => deleteCalls).toBe(1);
    await confirmElement!.evaluate((button) => {
      button.dispatchEvent(new Event('click', { bubbles: true }));
      button.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(deleteCalls).toBe(1);
    releaseDelete();
    await expect.poll(() => getCalls).toBeGreaterThan(1);
    await expect(page.getByTestId('sessions-empty')).toBeVisible();
  });

  test('revokes all only after confirmation and returns the current session to login', async ({ page }) => {
    await installAuthFixture(page);
    let deleteCalls = 0;

    await page.route('**/api/auth/sessions**', async (route) => {
      if (route.request().method() === 'GET') {
        await fulfillJson(route, sessionPage([
          sessionView(CURRENT_SESSION, 'Chrome on test workstation', true),
          sessionView(OTHER_SESSION, 'Safari on test tablet'),
        ]));
        return;
      }
      deleteCalls += 1;
      expect(new URL(route.request().url()).pathname).toBe('/api/auth/sessions');
      await route.fulfill({ status: 204, body: '' });
    });

    await gotoSecurity(page);
    await page.getByTestId('revoke-all-sessions-button').click();
    await expect(page.getByRole('heading', { name: 'Revoke all sessions?' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Revoke all sessions?' })).toHaveCount(0);
    expect(deleteCalls).toBe(0);

    await page.getByTestId('revoke-all-sessions-button').click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect.poll(() => deleteCalls).toBe(1);
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('weav_token'))).toBeNull();
  });

  const revokeErrorCases = [
    { status: 404, message: 'This session is no longer available.' },
    { status: 429, message: 'Too many session requests. Please try again later.' },
  ];

  for (const errorCase of revokeErrorCases) {
    test(`keeps the session row after revoke ${errorCase.status}`, async ({ page }) => {
      await installAuthFixture(page);
      let deleteCalls = 0;

      await page.route('**/api/auth/sessions**', async (route) => {
        if (route.request().method() === 'GET') {
          await fulfillJson(route, sessionPage([sessionView(OTHER_SESSION, 'Safari on test tablet')]));
          return;
        }
        deleteCalls += 1;
        await fulfillJson(route, { message: 'do not expose this mutation body' }, errorCase.status);
      });

      await gotoSecurity(page);
      await page.getByTestId(`session-revoke-button-${OTHER_SESSION}`).click();
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect.poll(() => deleteCalls).toBe(1);
      await expect(page.getByTestId('sessions-error').getByText(errorCase.message, { exact: true })).toBeVisible();
      await expect(page.getByText('Safari on test tablet', { exact: true })).toBeVisible();
      await expect(page.getByTestId('sessions-error')).not.toContainText('do not expose this mutation body');
      await expect(page).not.toHaveURL(/\/login$/);
    });
  }

  const errorCases = [
    { status: 401, message: 'Your sign-in session expired. Please sign in again.' },
    { status: 403, message: 'You do not have permission to manage these sessions.' },
    { status: 404, message: 'This session is no longer available.' },
    { status: 429, message: 'Too many session requests. Please try again later.' },
  ];

  for (const errorCase of errorCases) {
    test(`maps session GET ${errorCase.status} safely`, async ({ page }) => {
      await installAuthFixture(page);
      await page.route('**/api/auth/sessions**', async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await fulfillJson(route, { message: 'do not expose this upstream body' }, errorCase.status);
      });

      await gotoSecurity(page);
      await expect(page.getByTestId('sessions-error').getByText(errorCase.message, { exact: true })).toBeVisible();
      await expect(page.getByTestId('sessions-error')).not.toContainText('do not expose this upstream body');
    });
  }

  test('maps network failure and keeps the list available for retry', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/auth/sessions**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.abort('failed');
    });

    await gotoSecurity(page);
    await expect(page.getByTestId('sessions-error').getByText('Unable to load sessions. Please try again.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('sessions-retry')).toBeVisible();
  });

  test('ignores a late session-list response after logout and account switch', async ({ page }) => {
    await installAuthFixture(page);
    let releaseUserASessions!: () => void;
    const userASessionsReleased = new Promise<void>((resolve) => { releaseUserASessions = resolve; });
    let firstUserASessions = true;

    await page.route('**/api/auth/sessions**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }

      const isUserB = route.request().headers().authorization === 'Bearer token-b';
      if (!isUserB && firstUserASessions) {
        firstUserASessions = false;
        await userASessionsReleased;
        await fulfillJson(route, sessionPage([sessionView(OTHER_SESSION, 'Stale User A session')]));
        return;
      }
      await fulfillJson(route, sessionPage([]));
    });

    await gotoSecurity(page);
    await expect(page.getByTestId('sessions-loading')).toBeVisible();
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.locator('input[type="email"]').fill('b@example.com');
    await page.locator('input[type="password"]').fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('sidebar-profile-name')).toHaveText('User B');

    const userBSecurity = page.waitForResponse((response) => (
      response.url().includes('/api/auth/me') &&
      response.request().method() === 'GET' &&
      response.request().headers().authorization === 'Bearer token-b'
    ));
    await page.goto('/settings/security');
    await userBSecurity;
    await expect(page.getByTestId('sessions-empty')).toBeVisible();

    releaseUserASessions();
    await expect(page.getByText('Stale User A session', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('sidebar-profile-name')).toHaveText('User B');
    expect(await page.evaluate(() => localStorage.getItem('weav_token'))).toBe('token-b');
  });

  test('does not log out the switched account when an old revoke resolves late', async ({ page }) => {
    await installAuthFixture(page);
    let releaseDelete!: () => void;
    const deleteReleased = new Promise<void>((resolve) => { releaseDelete = resolve; });
    let deleteStarted!: () => void;
    const deleteStartedPromise = new Promise<void>((resolve) => { deleteStarted = resolve; });

    await page.route('**/api/auth/sessions**', async (route) => {
      if (route.request().method() === 'GET') {
        await fulfillJson(route, sessionPage([sessionView(OTHER_SESSION, 'Old User A session')]));
        return;
      }
      deleteStarted();
      await deleteReleased;
      await route.fulfill({ status: 204, body: '' });
    });

    await gotoSecurity(page);
    await page.getByTestId(`session-revoke-button-${OTHER_SESSION}`).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await deleteStartedPromise;

    await page.evaluate(() => localStorage.removeItem('weav_token'));
    const switchedPage = await page.context().newPage();
    await installAuthFixture(switchedPage, 'token-b');
    await switchedPage.goto('/dashboard');
    await expect(switchedPage.getByTestId('sidebar-profile-name')).toHaveText('User B');

    releaseDelete();
    expect(await switchedPage.evaluate(() => localStorage.getItem('weav_token'))).toBe('token-b');
    await expect(switchedPage.getByTestId('sidebar-profile-name')).toHaveText('User B');
    await switchedPage.close();
  });
});
