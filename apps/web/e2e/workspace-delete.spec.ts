import { expect, test, type Page, type Route } from '@playwright/test';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const MEMBER_ID = '10000000-0000-4000-8000-000000000002';
const WORKSPACE_NAME = 'Alpha team';

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

const workspace = {
  id: WORKSPACE_ID,
  name: WORKSPACE_NAME,
  createdBy: OWNER_ID,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

const pageResult = <T,>(items: T[]) => ({
  items,
  page: 0,
  size: 20,
  totalElements: items.length,
  totalPages: items.length ? 1 : 0,
});

const member = (id: string, name: string, email: string, role: 'OWNER' | 'MEMBER') => ({
  userId: id,
  email,
  displayName: name,
  active: true,
  role,
  canPublishWorkflow: true,
  canManageWorkflowState: false,
  joinedAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
});

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function install(page: Page, currentUserId: string, role: 'OWNER' | 'MEMBER') {
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'token-a');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await page.route('**/api/auth/me', (route) => json(route, user(
    currentUserId,
    role === 'OWNER' ? 'owner@example.com' : 'member@example.com',
    role === 'OWNER' ? 'Owner' : 'Member',
  )));
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v2/notifications/unread-count', (route) => json(route, { count: 0 }));
}

/** Stubs the workspace routes; `deleted()` flips after a successful DELETE. */
async function stubWorkspaces(
  page: Page,
  role: 'OWNER' | 'MEMBER',
  onDelete: (route: Route, body: unknown) => Promise<boolean>,
) {
  let deleted = false;
  await page.route('**/api/v1/workspaces**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/v1/workspaces' && method === 'GET') {
      return json(route, pageResult(deleted ? [] : [workspace]));
    }
    if (url.pathname === `/api/v1/workspaces/${WORKSPACE_ID}/members` && method === 'GET') {
      return json(route, pageResult([
        member(OWNER_ID, 'Owner', 'owner@example.com', 'OWNER'),
        ...(role === 'MEMBER' ? [member(MEMBER_ID, 'Member', 'member@example.com', 'MEMBER')] : []),
      ]));
    }
    if (url.pathname === `/api/v1/workspaces/${WORKSPACE_ID}` && method === 'DELETE') {
      deleted = await onDelete(route, route.request().postDataJSON());
      return;
    }
    return route.fallback();
  });
}

async function openSettings(page: Page) {
  const auth = page.waitForResponse((response) => response.url().includes('/api/auth/me'));
  await page.goto('/workspace/settings');
  await auth;
  if (new URL(page.url()).pathname === '/login') await page.goto('/workspace/settings');
}

test.describe('workspace delete', () => {
  test('owner confirms by typing the name and the workspace disappears', async ({ page }) => {
    await install(page, OWNER_ID, 'OWNER');
    let deleteBody: unknown;
    await stubWorkspaces(page, 'OWNER', async (route, body) => {
      deleteBody = body;
      await route.fulfill({ status: 204, body: '' });
      return true;
    });

    await openSettings(page);
    await expect(page.getByTestId('workspace-danger-zone')).toBeVisible();
    await page.getByTestId('workspace-delete-open').click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Delete workspace' });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox').fill('Alpha');
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox').fill('alpha TEAM');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect.poll(() => deleteBody).toEqual({ name: WORKSPACE_NAME });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByTestId('workspace-danger-zone')).toHaveCount(0);
    await expect(page.getByTestId('workspace-create-submit')).toBeVisible();
  });

  test('keeps the workspace and explains when workflows could not be stopped (503)', async ({ page }) => {
    await install(page, OWNER_ID, 'OWNER');
    await stubWorkspaces(page, 'OWNER', async (route) => {
      await json(route, { code: 'DEPENDENCY_UNAVAILABLE', message: 'unavailable', requestId: 'r1' }, 503);
      return false;
    });

    await openSettings(page);
    await page.getByTestId('workspace-delete-open').click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('textbox').fill(WORKSPACE_NAME);
    await dialog.getByRole('button', { name: 'Delete workspace' }).click();

    await expect(page.getByTestId('workspace-delete-error')).toContainText('was not deleted');
    await expect(page.getByTestId('workspace-danger-zone')).toBeVisible();
    await expect(page.getByTestId('workspace-selected-heading')).toHaveText(WORKSPACE_NAME);
  });

  test('a plain member does not see the danger zone', async ({ page }) => {
    await install(page, MEMBER_ID, 'MEMBER');
    await stubWorkspaces(page, 'MEMBER', async (route) => {
      await json(route, { code: 'FORBIDDEN' }, 403);
      return false;
    });

    await openSettings(page);
    await expect(page.getByTestId('workspace-selected-heading')).toHaveText(WORKSPACE_NAME);
    await expect(page.getByTestId('workspace-danger-zone')).toHaveCount(0);
    await expect(page.getByTestId('workspace-delete-open')).toHaveCount(0);
  });
});
