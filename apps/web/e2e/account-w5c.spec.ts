import { expect, test, type Page, type Route } from '@playwright/test';

const WORKSPACE = '00000000-0000-4000-8000-000000000001';
const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '10000000-0000-4000-8000-000000000002';
const CONN_NEW = '20000000-0000-4000-8000-000000000001';
const CONN_ACTIVE = '20000000-0000-4000-8000-000000000002';
const CHALLENGE_ID = 'A'.repeat(43);

const identityUser = (systemRole: 'USER' | 'ADMIN') => ({
  id: USER_A,
  email: 'a@example.com',
  displayName: 'User A',
  avatarStorageKey: null,
  systemRole,
  status: 'ACTIVE',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  emailVerifiedAt: null,
});

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installAuth(page: Page, systemRole: 'USER' | 'ADMIN' = 'USER') {
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'token-a');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await page.route('**/api/auth/me', (route) => json(route, identityUser(systemRole)));
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/auth/sessions**', (route) => json(route, { items: [], page: 0, size: 20, totalItems: 0, totalPages: 0 }));
  await page.route('**/users/me/oauth-accounts', (route) => json(route, []));
  await page.route('**/api/v2/notifications**', (route) => (
    new URL(route.request().url()).pathname.endsWith('/unread-count')
      ? json(route, { count: 0 })
      : json(route, { items: [], nextCursor: null })
  ));
}

const pageResult = <T,>(items: T[]) => ({ items, page: 0, size: 20, totalElements: items.length, totalPages: items.length ? 1 : 0 });
const workspace = { id: WORKSPACE, name: 'Alpha', createdBy: USER_A, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' };

test.describe('account: register and password', () => {
  test('register shows the server field error next to the password field', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('weav_lang_v1', 'EN'));
    await page.route('**/api/auth/register', (route) => json(route, {
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ field: 'password', message: 'Password must be between 8 and 72 characters' }] },
    }, 400));
    await page.goto('/register');
    await page.getByLabel('Full name').fill('New User');
    await page.getByLabel('Email').fill('new@example.com');
    await page.getByLabel('Password').fill('abcdefgh');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Password must be 8 to 72 characters.' })).toBeVisible();
  });

  test('register blocks a short password before any request', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('weav_lang_v1', 'EN'));
    let requests = 0;
    await page.route('**/api/auth/register', async (route) => { requests += 1; await json(route, {}, 201); });
    await page.goto('/register');
    await page.getByLabel('Full name').fill('New User');
    await page.getByLabel('Email').fill('new@example.com');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByText('Password must be 8 to 72 characters.')).toBeVisible();
    expect(requests).toBe(0);
  });

  test('change password with a wrong current password says so and keeps the session', async ({ page }) => {
    await installAuth(page);
    await page.route('**/api/auth/change-password', (route) => json(route, {
      error: { code: 'UNAUTHORIZED', message: 'Authentication failed', details: [] },
    }, 401));
    await page.goto('/settings/security');
    await page.getByLabel('Current password').first().fill('wrong-password');
    await page.getByLabel('New password', { exact: true }).fill('new-password-1');
    await page.getByLabel('Confirm new password').fill('new-password-1');
    await page.getByTestId('change-password-button').click();
    await expect(page.getByTestId('password-error')).toHaveText('The current password is incorrect.');
    expect(new URL(page.url()).pathname).toBe('/settings/security');
    expect(await page.evaluate(() => localStorage.getItem('weav_token'))).toBe('token-a');
  });
});

test.describe('account: forgot password resume', () => {
  test('keeps the challenge across a reload and never stores the code', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('weav_lang_v1', 'EN'));
    await page.route('**/api/auth/forgot-password', (route) => json(route, { challengeId: CHALLENGE_ID, expiresIn: 300, retryAfter: 60 }, 202));
    await page.goto('/forgot-password');
    await page.getByLabel('Email address').fill('person@example.com');
    await page.getByTestId('request-reset-button').click();
    await expect(page.getByTestId('complete-reset-button')).toBeVisible();
    await page.getByLabel('Verification code').fill('123456');

    await page.reload();
    await page.getByTestId('resume-reset-button').click();
    await expect(page.getByTestId('complete-reset-button')).toBeVisible();
    const stored = await page.evaluate(() => sessionStorage.getItem('weav_forgot_challenge_v1'));
    expect(stored).not.toContain('123456');
    expect(JSON.parse(stored ?? '{}')).toEqual({ challengeId: CHALLENGE_ID, email: 'person@example.com', expiresAt: expect.any(Number) });
  });
});

test.describe('workspace members', () => {
  test('maps USER_NOT_FOUND and shows full rights for the owner', async ({ page }) => {
    await installAuth(page);
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/v1/workspaces' && method === 'GET') return json(route, pageResult([workspace]));
      if (url.pathname.endsWith('/members') && method === 'GET') {
        return json(route, pageResult([{
          userId: USER_A, email: 'a@example.com', displayName: 'User A', active: true, role: 'OWNER',
          canPublishWorkflow: false, canManageWorkflowState: false, joinedAt: '2026-08-02T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z',
        }]));
      }
      if (url.pathname.endsWith('/members') && method === 'POST') {
        // workspace-service sends a flat body: { code, message, requestId }.
        const email = (route.request().postDataJSON() as { email: string }).email;
        return json(route, email === 'lost@example.com'
          ? { code: 'RESOURCE_NOT_FOUND', message: 'Workspace was not found', requestId: 'r2' }
          : { code: 'USER_NOT_FOUND', message: 'Identity user was not found', requestId: 'r1' }, 404);
      }
      return route.fallback();
    });
    await page.goto('/workspace/members');
    const publish = page.getByTestId(`workspace-member-publish-${USER_A}`);
    await expect(publish).toContainText('Publish: Allowed');
    await expect(page.getByTestId(`workspace-member-manage-${USER_A}`)).toContainText('Pause/resume: Allowed');
    await page.getByTestId('workspace-member-email').fill('nobody@example.com');
    await page.getByTestId('workspace-member-add-submit').click();
    // W7-A1: an unknown e-mail now offers an email invitation instead of a dead-end error.
    await expect(page.getByTestId('workspace-invite-prompt')).toContainText('No Weav account exists with this email');
    // A RESOURCE_NOT_FOUND 404 (caller lost access) must not claim the user does not exist.
    await page.getByTestId('workspace-member-email').fill('lost@example.com');
    await page.getByTestId('workspace-member-add-submit').click();
    await expect(page.getByTestId('workspace-invite-prompt')).toHaveCount(0);
    await expect(page.getByTestId('workspace-member-error')).toBeVisible();
  });

  test('the overview has no invented environment card', async ({ page }) => {
    await installAuth(page);
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces') return json(route, pageResult([workspace]));
      if (url.pathname.endsWith('/members')) return json(route, pageResult([]));
      return route.fallback();
    });
    await page.goto('/workspace');
    await expect(page.getByTestId('workspace-selected-heading')).toBeVisible();
    await expect(page.getByText('Production')).toHaveCount(0);
  });
});

test.describe('connections', () => {
  const connection = (id: string, provider: string, status: string, hasCredential: boolean, lastVerifiedAt: string | null) => ({
    id, workspaceId: WORKSPACE, createdBy: USER_A, name: `Conn ${provider}`, provider, authType: 'OAUTH2', status, config: null,
    hasCredential, credentialExpiresAt: null, lastVerifiedAt, canManage: true, canAttach: true,
    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
  });

  test('one-step create goes straight to Google consent', async ({ page }) => {
    await installAuth(page);
    let authorizeCalls = 0;
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/v1/workspaces') return json(route, pageResult([workspace]));
      if (url.pathname.endsWith('/members')) return json(route, pageResult([]));
      if (url.pathname.endsWith('/oauth/authorize')) {
        authorizeCalls += 1;
        return json(route, { authorizationUrl: 'https://accounts.google.test/consent' });
      }
      if (url.pathname.endsWith('/connections') && method === 'POST') return json(route, connection(CONN_NEW, 'GMAIL', 'DISABLED', false, null), 201);
      if (url.pathname.endsWith('/connections')) return json(route, []);
      return route.fallback();
    });
    await page.route('https://accounts.google.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>consent</p>' }));
    await page.goto('/workspace/connections');
    await page.getByTestId('connections-create-open').click();
    await page.getByTestId('connection-create-name').fill('Work Gmail');
    await page.getByTestId('connection-create-submit').click();
    await page.waitForURL('https://accounts.google.test/consent');
    expect(authorizeCalls).toBe(1);
  });

  test('never-connected shows "Not connected"; active rows can be disabled from the menu', async ({ page }) => {
    await installAuth(page);
    let disabled = false;
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/v1/workspaces') return json(route, pageResult([workspace]));
      if (url.pathname.endsWith('/members')) return json(route, pageResult([]));
      if (url.pathname.endsWith(`/${CONN_ACTIVE}/disable`) && method === 'POST') {
        disabled = true;
        return json(route, connection(CONN_ACTIVE, 'GOOGLE_SHEETS', 'DISABLED', true, '2026-08-01T00:00:00Z'));
      }
      if (url.pathname.endsWith('/connections')) {
        return json(route, [
          connection(CONN_NEW, 'GMAIL', 'INVALID', false, null),
          connection(CONN_ACTIVE, 'GOOGLE_SHEETS', disabled ? 'DISABLED' : 'ACTIVE', true, '2026-08-01T00:00:00Z'),
        ]);
      }
      return route.fallback();
    });
    await page.goto('/workspace/connections');
    await expect(page.getByTestId(`connection-status-${CONN_NEW}`)).toHaveText('Not connected');
    await expect(page.getByTestId(`connection-oauth-${CONN_NEW}`)).toHaveText('Connect');
    await page.getByTestId(`connection-row-${CONN_NEW}`).getByTestId('connection-row-menu').click();
    await expect(page.getByTestId(`connection-test-${CONN_NEW}`)).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByTestId(`connection-row-${CONN_ACTIVE}`).getByTestId('connection-row-menu').click();
    await page.getByTestId(`connection-disable-${CONN_ACTIVE}`).click();
    await expect(page.getByTestId(`connection-status-${CONN_ACTIVE}`)).toHaveAttribute('data-status', 'DISABLED');
    expect(disabled).toBe(true);
  });

  test('delete uses an in-app dialog, not window.confirm', async ({ page }) => {
    await installAuth(page);
    let removed = false;
    page.on('dialog', (dialog) => { void dialog.dismiss(); throw new Error('native dialog used'); });
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/v1/workspaces') return json(route, pageResult([workspace]));
      if (url.pathname.endsWith('/members')) return json(route, pageResult([]));
      if (url.pathname.endsWith(`/${CONN_ACTIVE}`) && method === 'DELETE') { removed = true; return route.fulfill({ status: 204, body: '' }); }
      if (url.pathname.endsWith('/connections')) return json(route, removed ? [] : [connection(CONN_ACTIVE, 'GOOGLE_SHEETS', 'ACTIVE', true, '2026-08-01T00:00:00Z')]);
      return route.fallback();
    });
    await page.goto('/workspace/connections');
    await page.getByTestId(`connection-row-${CONN_ACTIVE}`).getByTestId('connection-row-menu').click();
    await page.getByTestId(`connection-delete-${CONN_ACTIVE}`).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete connection' }).click();
    await expect.poll(() => removed).toBe(true);
  });
});

test.describe('admin users', () => {
  test('is visible for ADMIN and lists users', async ({ page }) => {
    await installAuth(page, 'ADMIN');
    await page.route('**/api/admin/users**', (route) => json(route, {
      items: [{ id: USER_B, email: 'b@example.com', displayName: 'User B', systemRole: 'USER', status: 'ACTIVE', createdAt: '2026-08-01T00:00:00Z', emailVerifiedAt: null, avatarPresent: false }],
      page: 0, size: 20, totalItems: 1, totalPages: 1,
    }));
    await page.goto('/admin/users');
    await expect(page.getByTestId('admin-users-page')).toBeVisible();
    await expect(page.getByTestId('admin-user-row')).toContainText('b@example.com');
  });

  test('redirects a normal user away', async ({ page }) => {
    await installAuth(page, 'USER');
    await page.goto('/admin/users');
    await expect(page.getByTestId('admin-users-page')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).pathname).not.toBe('/admin/users');
  });
});
