import { expect, test, type Page, type Route } from '@playwright/test';

const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '10000000-0000-4000-8000-000000000002';

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

  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });

  await page.route('**/api/auth/sessions**', async (route) => {
    await fulfillJson(route, { items: [], page: 0, size: 20, totalItems: 0, totalPages: 0 });
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
  await page.goto('/settings/security');
  await authResponse;
  if (new URL(page.url()).pathname === '/login') {
    const retryAuthResponse = waitForAuth();
    await page.goto('/settings/security');
    await retryAuthResponse;
  }
  await expect(page.getByTestId('settings-profile-page')).toBeVisible();
  await expect(page.getByTestId('change-password-button')).toBeVisible();
}

async function fillPasswordForm(page: Page, currentPassword = 'current-password', newPassword = 'new-password') {
  const passwordSection = page.locator('section').filter({ hasText: 'Change your local password and review active sessions.' });
  await passwordSection.getByLabel('Current password').fill(currentPassword);
  await passwordSection.getByLabel('New password', { exact: true }).fill(newPassword);
  await passwordSection.getByLabel('Confirm new password').fill(newPassword);
}

function passwordField(page: Page, label: string) {
  return page.locator('section').filter({ hasText: 'Change your local password and review active sessions.' }).getByLabel(label, { exact: true });
}

test.describe('web change-password HTTP integration', () => {
  test('sends the exact payload and clears the local session after Identity 204', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/auth/change-password', async (route) => {
      await route.fulfill({ status: 204, body: '' });
    });

    await gotoSecurity(page);
    await fillPasswordForm(page);
    const requestPromise = page.waitForRequest((request) => (
      request.url().includes('/api/auth/change-password') && request.method() === 'POST'
    ));
    await page.getByTestId('change-password-button').click();
    const request = await requestPromise;

    expect(request.postDataJSON()).toEqual({
      currentPassword: 'current-password',
      newPassword: 'new-password',
    });
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('weav_token'))).toBeNull();
  });

  test('blocks password values outside the Identity length and UTF-8 byte policy', async ({ page }) => {
    await installAuthFixture(page);
    let changePasswordCalls = 0;
    await page.route('**/api/auth/change-password', async (route) => {
      changePasswordCalls += 1;
      await route.fulfill({ status: 204, body: '' });
    });

    await gotoSecurity(page);
    await fillPasswordForm(page, 'short', 'valid-new-password');
    await page.getByTestId('change-password-button').click();
    await expect(page.getByTestId('password-error')).toHaveText(
      'Passwords must be 8–72 characters and no more than 72 UTF-8 bytes.',
    );
    expect(changePasswordCalls).toBe(0);

    const unicodePassword = 'é'.repeat(37);
    await fillPasswordForm(page, 'valid-current-password', unicodePassword);
    await page.getByTestId('change-password-button').click();
    await expect(page.getByTestId('password-error')).toHaveText(
      'Passwords must be 8–72 characters and no more than 72 UTF-8 bytes.',
    );
    expect(changePasswordCalls).toBe(0);
    await expect(passwordField(page, 'Current password')).toHaveValue('valid-current-password');
    await expect(passwordField(page, 'New password')).toHaveValue(unicodePassword);
  });

  test('requires matching new-password confirmation without sending a request', async ({ page }) => {
    await installAuthFixture(page);
    let changePasswordCalls = 0;
    await page.route('**/api/auth/change-password', async (route) => {
      changePasswordCalls += 1;
      await route.fulfill({ status: 204, body: '' });
    });

    await gotoSecurity(page);
    const passwordSection = page.locator('section').filter({ hasText: 'Change your local password and review active sessions.' });
    await passwordSection.getByLabel('Current password').fill('valid-current-password');
    await passwordSection.getByLabel('New password', { exact: true }).fill('valid-new-password');
    await passwordSection.getByLabel('Confirm new password').fill('different-new-password');
    await page.getByTestId('change-password-button').click();

    await expect(page.getByTestId('password-error')).toHaveText('New passwords do not match.');
    expect(changePasswordCalls).toBe(0);
  });

  test('shows a safe wrong-current-password error and preserves the draft', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/auth/change-password', async (route) => {
      await fulfillJson(route, {
        error: { code: 'UNAUTHORIZED', message: 'Authentication failed', details: [] },
      }, 401);
    });

    await gotoSecurity(page);
    await fillPasswordForm(page);
    await page.getByTestId('change-password-button').click();

    await expect(page.getByTestId('password-error')).toHaveText('Invalid credentials or expired session.');
    await expect(passwordField(page, 'Current password')).toHaveValue('current-password');
    await expect(passwordField(page, 'New password')).toHaveValue('new-password');
    await expect(passwordField(page, 'Confirm new password')).toHaveValue('new-password');
    expect(await page.evaluate(() => localStorage.getItem('weav_token'))).toBe('token-a');
  });

  test('maps rate limiting to a safe message without echoing the response body', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/auth/change-password', async (route) => {
      await fulfillJson(route, {
        error: { code: 'RATE_LIMITED', message: 'secret password material must not render', details: [] },
      }, 429);
    });

    await gotoSecurity(page);
    await fillPasswordForm(page);
    await page.getByTestId('change-password-button').click();

    await expect(page.getByTestId('password-error')).toHaveText('Too many attempts. Please try again later.');
    await expect(page.getByText('secret password material must not render', { exact: true })).toHaveCount(0);
    await expect(passwordField(page, 'New password')).toHaveValue('new-password');
  });

  test('shows a safe network error and keeps the password fields', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/auth/change-password', async (route) => {
      await route.abort('failed');
    });

    await gotoSecurity(page);
    await fillPasswordForm(page);
    await page.getByTestId('change-password-button').click();

    await expect(page.getByTestId('password-error')).toHaveText('Sign-in service unavailable. Please try again.');
    await expect(passwordField(page, 'Current password')).toHaveValue('current-password');
    await expect(passwordField(page, 'New password')).toHaveValue('new-password');
  });

  test('allows only one change-password request while the first request is pending', async ({ page }) => {
    await installAuthFixture(page);
    let changePasswordCalls = 0;
    let releaseChangePassword!: () => void;
    const changePasswordReleased = new Promise<void>((resolve) => { releaseChangePassword = resolve; });
    await page.route('**/api/auth/change-password', async (route) => {
      changePasswordCalls += 1;
      await changePasswordReleased;
      await route.fulfill({ status: 204, body: '' });
    });

    await gotoSecurity(page);
    await fillPasswordForm(page);
    const button = page.getByTestId('change-password-button');
    await button.click();
    await expect.poll(() => changePasswordCalls).toBe(1);
    await expect(button).toBeDisabled();
    await button.evaluate((element) => {
      element.dispatchEvent(new Event('click', { bubbles: true }));
      element.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(changePasswordCalls).toBe(1);

    releaseChangePassword();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('ignores a late response after logout and account switch', async ({ page }) => {
    await installAuthFixture(page);
    let releaseChangePassword!: () => void;
    const changePasswordReleased = new Promise<void>((resolve) => { releaseChangePassword = resolve; });
    let changePasswordCompleted!: () => void;
    const changePasswordCompletion = new Promise<void>((resolve) => { changePasswordCompleted = resolve; });

    await page.route('**/api/auth/change-password', async (route) => {
      await changePasswordReleased;
      await route.fulfill({ status: 204, body: '' });
      changePasswordCompleted();
    });
    await page.route('**/api/auth/login', async (route) => {
      await fulfillJson(route, {
        accessToken: 'token-b',
        refreshToken: 'refresh-token-b',
        user: identityUser(USER_B, 'b@example.com', 'User B'),
      });
    });

    await gotoSecurity(page);
    await fillPasswordForm(page);
    await page.getByTestId('change-password-button').click();
    await expect.poll(() => page.url()).toContain('/settings/security');

    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.locator('input[type="email"]').fill('b@example.com');
    await page.locator('input[type="password"]').fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('sidebar-profile-name')).toHaveText('User B');

    releaseChangePassword();
    await changePasswordCompletion;
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('sidebar-profile-name')).toHaveText('User B');
    expect(await page.evaluate(() => localStorage.getItem('weav_token'))).toBe('token-b');
  });
});
