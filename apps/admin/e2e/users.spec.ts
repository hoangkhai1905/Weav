import { expect, test, type Page } from '@playwright/test';
import { GATEWAY, json, signedInAs } from './support.js';

type Status = 'ACTIVE' | 'DISABLED';
interface StubUser {
  id: string;
  email: string;
  displayName: string | null;
  systemRole: 'USER' | 'ADMIN';
  status: Status;
  createdAt: string;
  emailVerifiedAt: string | null;
  avatarPresent: boolean;
}

const user = (id: string, email: string, extra: Partial<StubUser> = {}): StubUser => ({
  id,
  email,
  displayName: null,
  systemRole: 'USER',
  status: 'ACTIVE',
  createdAt: '2026-03-04T12:00:00Z',
  emailVerifiedAt: '2026-03-05T12:00:00Z',
  avatarPresent: false,
  ...extra,
});

const root = user('u1', 'root@weav.test', { displayName: 'Root', systemRole: 'ADMIN' });

/** Stubs /api/admin/users*; returns the recorded list queries, PATCH bodies and a mutable store. */
async function stubUsers(page: Page, store: StubUser[], opts: { total?: number; patchStatus?: number } = {}) {
  const lists: URLSearchParams[] = [];
  const patches: unknown[] = [];
  await page.route(`${GATEWAY}/api/admin/users**`, async (route) => {
    const url = new URL(route.request().url());
    const detail = url.pathname.match(/^\/api\/admin\/users\/([^/]+)(\/status)?$/);
    if (!detail) {
      lists.push(url.searchParams);
      const pageNo = Number(url.searchParams.get('page') ?? 0);
      const status = url.searchParams.get('status');
      const rows = status ? store.filter((u) => u.status === status) : store;
      return json(route, 200, { items: rows, page: pageNo, size: 20, totalItems: opts.total ?? rows.length, totalPages: Math.max(1, Math.ceil((opts.total ?? rows.length) / 20)) });
    }
    const target = store.find((u) => u.id === detail[1]);
    if (!target) return json(route, 404, { message: 'not found' });
    if (detail[2]) {
      patches.push(route.request().postDataJSON());
      if (opts.patchStatus) return json(route, opts.patchStatus, { message: 'refused' });
      target.status = route.request().postDataJSON().status;
    }
    return json(route, 200, target);
  });
  return { lists, patches };
}

test.beforeEach(async ({ page }) => {
  await signedInAs(page, { id: root.id, email: root.email, displayName: root.displayName });
});

test('lists users with debounced search and status filter', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && consoleErrors.push(msg.text()));
  const { lists } = await stubUsers(page, [root, user('u2', 'smoke@example.com'), user('u3', 'off@example.com', { status: 'DISABLED' })], { total: 22 });

  await page.goto('/users');
  await expect(page.getByTestId('users-page-info')).toHaveText('Page 1 of 2 · 22 users');
  expect(lists).toHaveLength(1);
  expect(lists[0].get('page')).toBe('0');
  expect(lists[0].get('size')).toBe('20');
  expect(lists[0].has('search')).toBe(false);
  expect(lists[0].has('status')).toBe(false);

  await page.getByLabel('Search by email or name').pressSequentially('smo');
  await expect.poll(() => lists.length).toBe(2);
  await page.waitForTimeout(500); // no further request after the debounce
  expect(lists).toHaveLength(2);
  expect(lists[1].get('search')).toBe('smo');

  await page.getByLabel('Status').selectOption('DISABLED');
  await expect.poll(() => lists.length).toBe(3);
  expect(lists[2].get('status')).toBe('DISABLED');
  expect(lists[2].get('search')).toBe('smo');
  expect(consoleErrors).toEqual([]);
});

test('disables only after confirming and shows the email', async ({ page }) => {
  const { patches } = await stubUsers(page, [root, user('u2', 'b@example.com')]);
  await page.goto('/users');

  await page.getByRole('button', { name: 'Disable: b@example.com' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('b@example.com');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(patches).toHaveLength(0);

  await page.getByRole('button', { name: 'Disable: b@example.com' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByRole('button', { name: 'Enable: b@example.com' })).toBeVisible();
  await expect(page.getByTestId('user-row').filter({ hasText: 'b@example.com' })).toContainText('Disabled');
  expect(patches).toEqual([{ status: 'DISABLED' }]);
});

test('enabling needs no confirmation, and a refused change shows a friendly message', async ({ page }) => {
  const { patches } = await stubUsers(page, [root, user('u2', 'b@example.com', { status: 'DISABLED' })], { patchStatus: 409 });
  await page.goto('/users');
  await page.getByRole('button', { name: 'Enable: b@example.com' }).click();
  await expect(page.getByRole('alert')).toHaveText(/This account cannot be changed/);
  expect(patches).toEqual([{ status: 'ACTIVE' }]);
});

test('no toggle for ADMIN rows or the signed-in admin', async ({ page }) => {
  await stubUsers(page, [root, user('u9', 'other-admin@weav.test', { systemRole: 'ADMIN' }), user('u2', 'b@example.com')]);
  await page.goto('/users');
  await expect(page.getByTestId('user-row')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^(Disable|Enable):/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Disable: b@example.com' })).toBeVisible();
});

test('a failed load shows an error with Retry', async ({ page }) => {
  let fail = true;
  await page.route(`${GATEWAY}/api/admin/users**`, (route) =>
    fail ? json(route, 500, { message: 'boom' }) : json(route, 200, { items: [user('u2', 'b@example.com')], page: 0, size: 20, totalItems: 1, totalPages: 1 }),
  );
  await page.goto('/users');
  await expect(page.getByRole('alert')).toContainText('Could not load the users');
  fail = false;
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('b@example.com')).toBeVisible();
});

test('user detail shows profile and owned workspaces', async ({ page }) => {
  const store = [root, user('u2', 'owner@example.com', { displayName: 'Olive Owner', emailVerifiedAt: null })];
  await stubUsers(page, store);
  const workspaceQueries: URLSearchParams[] = [];
  await page.route(`${GATEWAY}/api/admin/workspaces**`, (route) => {
    workspaceQueries.push(new URL(route.request().url()).searchParams);
    return json(route, 200, {
      items: [{ id: 'w1', name: 'Marketing', ownerId: 'u2', ownerEmail: 'owner@example.com', ownerDisplayName: 'Olive Owner', memberCount: 3, createdAt: '2026-04-01T12:00:00Z' }],
      page: 0, size: 100, totalElements: 1, totalPages: 1,
    });
  });

  await page.goto('/users/u2');
  await expect(page.getByRole('heading', { name: 'Olive Owner' })).toBeVisible();
  await expect(page.getByText('owner@example.com').first()).toBeVisible();
  await expect(page.getByText('Email not verified')).toBeVisible();
  await expect(page.getByText('4 Mar 2026')).toBeVisible();
  const workspace = page.getByRole('link', { name: /Marketing/ });
  await expect(workspace).toContainText('3 members');
  await expect(workspace).toHaveAttribute('href', '/executions?workspaceId=w1');
  expect(workspaceQueries[0].get('ownerId')).toBe('u2');
  expect(workspaceQueries[0].get('size')).toBe('100');

  await page.getByRole('button', { name: 'Disable: owner@example.com' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByRole('button', { name: 'Enable: owner@example.com' })).toBeVisible();
});

test('user detail without workspaces, and an unknown user', async ({ page }) => {
  await stubUsers(page, [root, user('u2', 'owner@example.com')]);
  await page.route(`${GATEWAY}/api/admin/workspaces**`, (route) => json(route, 200, { items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }));
  await page.goto('/users/u2');
  await expect(page.getByText('This user does not own any workspace yet.')).toBeVisible();

  await page.goto('/users/nobody');
  await expect(page.getByRole('heading', { name: 'User not found' })).toBeVisible();
  await page.getByRole('link', { name: /Back to users/ }).click();
  await expect(page).toHaveURL(/\/users$/);
});
