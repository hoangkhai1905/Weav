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

  await page.route('**/api/notifications**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/unread-count')) {
      await fulfillJson(route, { count: 0 });
      return;
    }
    await fulfillJson(route, { items: [], nextCursor: null });
  });
}

async function gotoProfile(page: Page) {
  const waitForAuth = () => page.waitForResponse((response) => (
    response.url().includes('/api/auth/me') && response.request().method() === 'GET'
  ));
  const authResponse = waitForAuth();
  await page.goto('/settings/profile');
  await authResponse;
  if (new URL(page.url()).pathname === '/login') {
    const retryAuthResponse = waitForAuth();
    await page.goto('/settings/profile');
    await retryAuthResponse;
  }
  await expect(page.getByTestId('settings-profile-page')).toBeVisible();
}

test.describe('web profile HTTP integration', () => {
  test('loads and saves only the editable displayName while syncing current-user UI', async ({ page }) => {
    await installAuthFixture(page);
    let patchBody: unknown;
    await page.route('**/api/auth/me', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.fallback();
        return;
      }

      patchBody = route.request().postDataJSON();
      await fulfillJson(route, identityUser(USER_A, 'a@example.com', 'Updated Web Name'));
    });

    await gotoProfile(page);
    const nameInput = page.locator('#profile-name');
    const emailInput = page.locator('#profile-email');
    await expect(nameInput).toHaveValue('User A');
    await expect(emailInput).toHaveValue('a@example.com');
    await expect(emailInput).toHaveAttribute('readonly', '');
    await expect(nameInput).toHaveAttribute('maxlength', '120');

    await nameInput.fill('Updated Web Name');
    await page.getByRole('button', { name: 'Save profile' }).click();

    await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible();
    expect(patchBody).toEqual({ displayName: 'Updated Web Name' });
    await expect(page.getByTestId('sidebar-profile-name')).toHaveText('Updated Web Name');
    await expect(page.getByTestId('topbar-user-avatar')).toHaveText('UW');
    expect(await page.evaluate(() => localStorage.getItem('weav_token'))).toBe('token-a');
  });

  test('preserves an unsaved profile draft when current-user refresh updates account data', async ({ page }) => {
    await installAuthFixture(page);
    let authGetCalls = 0;
    await page.route('**/api/auth/me', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }

      authGetCalls += 1;
      await fulfillJson(route, identityUser(
        USER_A,
        'a@example.com',
        authGetCalls === 1
          ? 'User A'
          : authGetCalls === 2
            ? 'Refreshed Server Name'
            : 'Refreshed While Editing',
      ));
    });
    await page.route('**/api/auth/otp/request', async (route) => {
      await fulfillJson(route, { challengeId: 'challenge-1', expiresIn: 300, retryAfter: 0 });
    });
    await page.route('**/api/auth/otp/verify', async (route) => {
      await fulfillJson(route, { purpose: 'EMAIL_VERIFICATION', verified: true });
    });

    await gotoProfile(page);
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByTestId('settings-profile-page')).toBeVisible();
    const nameInput = page.locator('#profile-name');
    await expect(nameInput).toHaveValue('User A');

    await page.getByRole('button', { name: 'Send code' }).click();
    await page.locator('input[placeholder="6-digit code"]').fill('123456');
    await page.getByRole('button', { name: 'Verify' }).click();

    await expect.poll(() => authGetCalls).toBe(2);
    await expect(nameInput).toHaveValue('Refreshed Server Name');
    await nameInput.fill('Keep local draft');

    await page.getByRole('button', { name: 'Send code' }).click();
    await page.locator('input[placeholder="6-digit code"]').fill('123456');
    await page.getByRole('button', { name: 'Verify' }).click();

    await expect.poll(() => authGetCalls).toBe(3);
    await expect(nameInput).toHaveValue('Keep local draft');
    await expect(page.getByTestId('sidebar-profile-name')).toHaveText('Refreshed While Editing');
  });

  test('shows loading while GET is pending and preserves input after a failed PATCH', async ({ page }) => {
    await installAuthFixture(page);
    let releaseProfile!: () => void;
    const profileReleased = new Promise<void>((resolve) => { releaseProfile = resolve; });
    let patchCalls = 0;

    await page.route('**/api/auth/me', async (route) => {
      if (route.request().method() === 'GET') {
        await profileReleased;
        await fulfillJson(route, identityUser(USER_A, 'a@example.com', 'User A'));
        return;
      }

      patchCalls += 1;
      await fulfillJson(route, {
        error: { code: 'IDENTITY_UNAVAILABLE', message: 'Identity service unavailable', details: [] },
        status: 503,
      }, 503);
    });

    await page.goto('/settings/profile');
    await expect(page.getByTestId('profile-loading')).toBeVisible();
    releaseProfile();
    await expect(page.locator('#profile-name')).toHaveValue('User A');

    await page.locator('#profile-name').fill('Keep this input');
    await page.getByRole('button', { name: 'Save profile' }).click();

    await expect.poll(() => patchCalls).toBe(1);
    await expect(page.getByTestId('profile-error')).toBeVisible();
    await expect(page.locator('#profile-name')).toHaveValue('Keep this input');
    await expect(page.getByText('Profile saved.', { exact: true })).toHaveCount(0);
  });

  test('allows only one profile PATCH while the first request is pending', async ({ page }) => {
    await installAuthFixture(page);
    let patchCalls = 0;
    let releasePatch!: () => void;
    const patchReleased = new Promise<void>((resolve) => { releasePatch = resolve; });

    await page.route('**/api/auth/me', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.fallback();
        return;
      }

      patchCalls += 1;
      await patchReleased;
      await fulfillJson(route, identityUser(USER_A, 'a@example.com', 'Pending Name'));
    });

    await gotoProfile(page);
    await page.locator('#profile-name').fill('Pending Name');
    const saveButton = page.getByTestId('profile-save-button');
    await saveButton.click();
    await expect.poll(() => patchCalls).toBe(1);
    await expect(saveButton).toBeDisabled();
    await saveButton.evaluate((button) => {
      button.dispatchEvent(new Event('click', { bubbles: true }));
      button.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(patchCalls).toBe(1);

    releasePatch();
    await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible();
  });

  test('blocks a displayName longer than the Identity contract without sending PATCH', async ({ page }) => {
    await installAuthFixture(page);
    let patchCalls = 0;
    await page.route('**/api/auth/me', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.fallback();
        return;
      }

      patchCalls += 1;
      await fulfillJson(route, identityUser(USER_A, 'a@example.com', 'Should not save'));
    });

    await gotoProfile(page);
    const nameInput = page.locator('#profile-name');
    await nameInput.evaluate((input) => input.removeAttribute('maxlength'));
    await nameInput.fill('x'.repeat(121));
    await page.getByTestId('profile-save-button').click();

    await expect(page.getByText('Display name must be 120 characters or fewer.', { exact: true })).toBeVisible();
    expect(patchCalls).toBe(0);
    await expect(nameInput).toHaveValue('x'.repeat(121));
  });

  test('ignores a late profile response after logout and account switch', async ({ page }) => {
    await installAuthFixture(page);
    let releasePatch!: () => void;
    const patchReleased = new Promise<void>((resolve) => { releasePatch = resolve; });
    let patchStarted!: () => void;
    const patchStartedPromise = new Promise<void>((resolve) => { patchStarted = resolve; });

    await page.route('**/api/auth/me', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.fallback();
        return;
      }

      patchStarted();
      await patchReleased;
      await fulfillJson(route, identityUser(USER_A, 'a@example.com', 'Stale User A'));
    });

    await page.route('**/api/auth/login', async (route) => {
      await fulfillJson(route, {
        accessToken: 'token-b',
        refreshToken: 'refresh-token-b',
        user: identityUser(USER_B, 'b@example.com', 'User B'),
      });
    });

    await gotoProfile(page);
    await page.locator('#profile-name').fill('Stale User A');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await patchStartedPromise;

    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.locator('input[type="email"]').fill('b@example.com');
    await page.locator('input[type="password"]').fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(await page.evaluate(() => localStorage.getItem('weav_token'))).toBe('token-b');
    await expect(page.getByTestId('sidebar-profile-name')).toHaveText('User B');

    releasePatch();
    const currentUserResponse = page.waitForResponse((response) => (
      response.url().includes('/api/auth/me') &&
      response.request().method() === 'GET' &&
      response.request().headers().authorization === 'Bearer token-b'
    ));
    await page.goto('/settings/profile');
    const response = await currentUserResponse;
    expect(response.request().headers().authorization).toBe('Bearer token-b');
    await expect(page.locator('#profile-name')).toHaveValue('User B');
    await expect(page.getByTestId('sidebar-profile-name')).toHaveText('User B');
    await expect(page.getByTestId('topbar-user-avatar')).toHaveText('UB');
    await expect(page.getByText('Stale User A', { exact: true })).toHaveCount(0);
  });
});
