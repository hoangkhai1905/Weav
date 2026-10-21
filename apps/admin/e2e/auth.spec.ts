import { expect, test, type Page, type Route } from '@playwright/test';

const GATEWAY = 'http://localhost:3000';
const NOT_ADMIN = /no admin access|không có quyền quản trị/i;
const BAD_LOGIN = /wrong email or password|chưa đúng/i;

const session = (systemRole: 'ADMIN' | 'USER', refreshToken = 'r1', accessToken = 'a1') => ({
  accessToken,
  refreshToken,
  user: { id: 'u1', email: 'root@weav.test', displayName: 'Root', systemRole },
});
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Stubs the Gateway; returns call counters. */
async function stubGateway(page: Page, opts: { role?: 'ADMIN' | 'USER'; loginStatus?: number; refresh?: 'ok' | 'fail'; firstUsers401?: boolean } = {}) {
  const calls = { login: 0, logout: 0, refresh: 0, users: 0 };
  await page.route(`${GATEWAY}/api/auth/login`, (route) => {
    calls.login++;
    return opts.loginStatus ? json(route, opts.loginStatus, { message: 'nope' }) : json(route, 200, session(opts.role ?? 'ADMIN'));
  });
  await page.route(`${GATEWAY}/api/auth/logout`, (route) => {
    calls.logout++;
    return route.fulfill({ status: 204 });
  });
  await page.route(`${GATEWAY}/api/auth/refresh`, (route) => {
    calls.refresh++;
    return opts.refresh === 'fail' ? json(route, 401, { message: 'expired' }) : json(route, 200, session('ADMIN', 'r2', 'a2'));
  });
  await page.route(`${GATEWAY}/api/admin/users**`, (route) => {
    calls.users++;
    const authorized = route.request().headers()['authorization'] === 'Bearer a2';
    if (opts.firstUsers401 && !authorized) return json(route, 401, { message: 'expired' });
    return json(route, 200, { items: [], page: 0, size: 1, totalItems: 7, totalPages: 7 });
  });
  return calls;
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('root@weav.test');
  await page.getByLabel(/mật khẩu|password/i).fill('secret-123');
  await page.getByRole('button', { name: /đăng nhập|sign in/i }).click();
}

test('an admin signs in and lands on the overview', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && consoleErrors.push(msg.text()));
  await stubGateway(page);
  await signIn(page);
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByTestId('nav-users')).toBeVisible();
  await expect(page.getByText('Weav Admin').first()).toBeVisible();
  await expect(page.getByTestId('overview-users-total')).toHaveText('7');
  expect(consoleErrors).toEqual([]);
});

test('a non-admin is refused and signed out', async ({ page }) => {
  const calls = await stubGateway(page, { role: 'USER' });
  await signIn(page);
  await expect(page.getByRole('alert')).toContainText(NOT_ADMIN);
  expect(calls.logout).toBe(1);
  await expect(page).toHaveURL(/\/login$/);
});

test('wrong password shows a friendly error', async ({ page }) => {
  await stubGateway(page, { loginStatus: 401 });
  await signIn(page);
  await expect(page.getByRole('alert')).toContainText(BAD_LOGIN);
  await expect(page).toHaveURL(/\/login$/);
});

test('an expired token refreshes once then retries', async ({ page }) => {
  const calls = await stubGateway(page, { firstUsers401: true });
  await signIn(page);
  await expect(page.getByTestId('overview-users-total')).toHaveText('7');
  expect(calls.refresh).toBe(1);
  expect(calls.users).toBe(2);
});

test('a failed refresh returns to login without looping', async ({ page }) => {
  const calls = await stubGateway(page, { firstUsers401: true, refresh: 'fail' });
  await signIn(page);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: /đăng nhập|sign in/i })).toBeVisible();
  expect(calls.refresh).toBe(1);
});

test('protected routes redirect to login without a session', async ({ page }) => {
  await page.goto('/users');
  await expect(page).toHaveURL(/\/login$/);
});
