import { expect, test, type Page, type Route } from '@playwright/test';

const WORKSPACE_A = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_B = '00000000-0000-4000-8000-000000000002';
const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '10000000-0000-4000-8000-000000000002';
const USER_C = '10000000-0000-4000-8000-000000000003';

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

const workspace = (id: string, name: string) => ({
  id,
  name,
  createdBy: USER_A,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
});

const pageResult = <T,>(items: T[]) => ({
  items,
  page: 0,
  size: 20,
  totalElements: items.length,
  totalPages: items.length ? 1 : 0,
});

const member = (
  id: string,
  name: string,
  email: string,
  role: 'OWNER' | 'MEMBER' = 'MEMBER',
  canPublishWorkflow = true,
  canManageWorkflowState = false,
) => ({
  userId: id,
  email,
  displayName: name,
  active: true,
  role,
  canPublishWorkflow,
  canManageWorkflowState,
  joinedAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
});

async function installAuthFixture(page: Page, token = 'token-a') {
  await page.addInitScript(({ initialToken }) => {
    localStorage.setItem('weav_token', initialToken);
    localStorage.setItem('weav_lang_v1', 'EN');
  }, { initialToken: token });

  await page.route('**/api/auth/me', async (route) => {
    const isUserB = route.request().headers().authorization === 'Bearer token-b';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(isUserB ? user(USER_B, 'b@example.com', 'User B') : user(USER_A, 'a@example.com', 'User A')),
    });
  });
  await page.route('**/api/auth/logout', async (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/notifications/unread-count', async (route) => (
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) })
  ));
}

async function fulfill(route: Route, response: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) });
}

async function gotoWorkspace(page: Page) {
  const authResponse = page.waitForResponse((response) => response.url().includes('/api/auth/me'));
  await page.goto('/workspace');
  await authResponse;
  if (new URL(page.url()).pathname === '/login') await page.goto('/workspace');
}

test.describe('workspace member Gateway integration', () => {
  test('adds an existing Identity user by email and maps the created member', async ({ page }) => {
    await installAuthFixture(page);
    let members = [
      member(USER_A, 'User A', 'a@example.com', 'OWNER'),
      member(USER_B, 'User B', 'b@example.com'),
    ];
    let addBody: unknown;
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/v1/workspaces' && method === 'GET') return fulfill(route, pageResult([workspace(WORKSPACE_A, 'Alpha')]));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members` && method === 'GET') return fulfill(route, pageResult(members));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members` && method === 'POST') {
        addBody = route.request().postDataJSON();
        const created = member(USER_C, 'User C', 'c@example.com');
        members = [...members, created];
        return fulfill(route, created, 201);
      }
      return route.fallback();
    });

    await gotoWorkspace(page);
    await expect(page.getByTestId(`workspace-member-publish-${USER_A}`)).toBeDisabled();
    await expect(page.getByTestId(`workspace-member-remove-${USER_A}`)).toHaveCount(0);
    await page.getByTestId('workspace-member-email').fill('c@example.com');
    await page.getByTestId('workspace-member-add-submit').click();

    expect(addBody).toEqual({ email: 'c@example.com' });
    await expect(page.getByTestId('workspace-member-row')).toHaveCount(3);
    await expect(page.getByTestId('workspace-member-row').filter({ hasText: 'User C' })).toContainText('c@example.com');
    await expect(page.getByTestId('workspace-member-email')).toHaveValue('');
  });

  test('updates both permission fields on the real member userId route and blocks duplicate submit', async ({ page }) => {
    await installAuthFixture(page);
    let members = [
      member(USER_A, 'User A', 'a@example.com', 'OWNER'),
      member(USER_B, 'User B', 'b@example.com', 'MEMBER', false, false),
    ];
    const requests: unknown[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/v1/workspaces' && method === 'GET') return fulfill(route, pageResult([workspace(WORKSPACE_A, 'Alpha')]));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members` && method === 'GET') return fulfill(route, pageResult(members));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members/${USER_B}/permissions` && method === 'PATCH') {
        requests.push(route.request().postDataJSON());
        await pending;
        const body = route.request().postDataJSON() as { canPublishWorkflow: boolean; canManageWorkflowState: boolean };
        members = members.map((item) => item.userId === USER_B ? { ...item, ...body } : item);
        return fulfill(route, members[1]);
      }
      return route.fallback();
    });

    await gotoWorkspace(page);
    const publish = page.getByTestId(`workspace-member-publish-${USER_B}`);
    await publish.click();
    await expect(publish).toBeDisabled();
    await publish.click({ force: true });
    expect(requests).toHaveLength(1);
    release();
    await expect(publish).toContainText('Allowed');
    expect(requests).toEqual([{ canPublishWorkflow: true, canManageWorkflowState: false }]);

    await page.getByTestId(`workspace-member-manage-${USER_B}`).click();
    await expect(page.getByTestId(`workspace-member-manage-${USER_B}`)).toContainText('Allowed');
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual({ canPublishWorkflow: true, canManageWorkflowState: true });
  });

  test('validates add input and preserves it with contract error without success', async ({ page }) => {
    await installAuthFixture(page);
    let addCalls = 0;
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/v1/workspaces' && method === 'GET') return fulfill(route, pageResult([workspace(WORKSPACE_A, 'Alpha')]));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members` && method === 'GET') return fulfill(route, pageResult([member(USER_A, 'User A', 'a@example.com', 'OWNER')]));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members` && method === 'POST') {
        addCalls += 1;
        return fulfill(route, { error: { code: 'USER_ALREADY_MEMBER', message: 'Identity user is already a workspace member' } }, 409);
      }
      return route.fallback();
    });

    await gotoWorkspace(page);
    await page.getByTestId('workspace-member-add-submit').click();
    await expect(page.getByTestId('workspace-member-error')).toContainText('required');
    expect(addCalls).toBe(0);
    await page.getByTestId('workspace-member-email').fill('already@example.com');
    await page.getByTestId('workspace-member-add-submit').click();
    await expect(page.getByTestId('workspace-member-error')).toContainText('already a workspace member');
    await expect(page.getByTestId('workspace-member-email')).toHaveValue('already@example.com');
    await expect(page.getByTestId('workspace-member-success')).toHaveCount(0);
  });

  test('gates member mutations for a non-owner while leaving remains available', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/v1/workspaces' && method === 'GET') return fulfill(route, pageResult([workspace(WORKSPACE_A, 'Alpha')]));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members` && method === 'GET') return fulfill(route, pageResult([
        member(USER_A, 'User A', 'a@example.com', 'MEMBER'),
        member(USER_B, 'User B', 'b@example.com', 'MEMBER'),
      ]));
      return route.fallback();
    });

    await gotoWorkspace(page);
    await expect(page.getByTestId('workspace-member-add-submit')).toBeDisabled();
    await expect(page.getByTestId(`workspace-member-publish-${USER_B}`)).toBeDisabled();
    await expect(page.getByTestId(`workspace-member-manage-${USER_B}`)).toBeDisabled();
    await expect(page.getByTestId(`workspace-member-remove-${USER_B}`)).toBeDisabled();
    await expect(page.getByTestId('workspace-leave')).toBeVisible();
  });

  test('requires remove confirmation, preserves cancel, then removes the selected member', async ({ page }) => {
    await installAuthFixture(page);
    let members = [
      member(USER_A, 'User A', 'a@example.com', 'OWNER'),
      member(USER_B, 'User B', 'b@example.com'),
    ];
    let removeCalls = 0;
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/v1/workspaces' && method === 'GET') return fulfill(route, pageResult([workspace(WORKSPACE_A, 'Alpha')]));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members` && method === 'GET') return fulfill(route, pageResult(members));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members/${USER_B}` && method === 'DELETE') {
        removeCalls += 1;
        members = members.filter((item) => item.userId !== USER_B);
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fallback();
    });

    await gotoWorkspace(page);
    await page.getByTestId(`workspace-member-remove-${USER_B}`).click();
    await expect(page.getByRole('heading', { name: 'Remove workspace member' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(removeCalls).toBe(0);
    await page.getByTestId(`workspace-member-remove-${USER_B}`).click();
    await page.getByRole('button', { name: 'Remove member' }).click();
    await expect(page.getByTestId('workspace-member-row').filter({ hasText: 'User B' })).toHaveCount(0);
    expect(removeCalls).toBe(1);
  });

  test('leaves as a member, clears the active workspace, and selects the remaining workspace', async ({ page }) => {
    await installAuthFixture(page);
    let listCalls = 0;
    let leaveCalls = 0;
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/v1/workspaces' && method === 'GET') {
        listCalls += 1;
        return fulfill(route, pageResult(listCalls === 1 ? [workspace(WORKSPACE_A, 'Alpha'), workspace(WORKSPACE_B, 'Beta')] : [workspace(WORKSPACE_B, 'Beta')]));
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members` && method === 'GET') return fulfill(route, pageResult([
        member(USER_A, 'User A', 'a@example.com', 'MEMBER'),
        member(USER_B, 'User B', 'b@example.com', 'MEMBER'),
      ]));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members/me` && method === 'DELETE') {
        leaveCalls += 1;
        return route.fulfill({ status: 204, body: '' });
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_B}/members` && method === 'GET') return fulfill(route, pageResult([]));
      return route.fallback();
    });

    await gotoWorkspace(page);
    await page.getByTestId('workspace-leave').click();
    await page.getByRole('button', { name: 'Leave workspace' }).click();
    await expect(page.getByTestId('workspace-selector')).toHaveValue(WORKSPACE_B);
    await expect(page.getByTestId('workspace-selected-heading')).toContainText('Beta');
    expect(leaveCalls).toBe(1);
  });

  test('does not apply a late permission response after switching workspace', async ({ page }) => {
    await installAuthFixture(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let permissionCalls = 0;
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/v1/workspaces' && method === 'GET') return fulfill(route, pageResult([workspace(WORKSPACE_A, 'Alpha'), workspace(WORKSPACE_B, 'Beta')]));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members` && method === 'GET') return fulfill(route, pageResult([
        member(USER_A, 'User A', 'a@example.com', 'OWNER'),
        member(USER_B, 'User B', 'b@example.com', 'MEMBER', false, false),
      ]));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_B}/members` && method === 'GET') return fulfill(route, pageResult([
        member(USER_A, 'User A', 'a@example.com', 'OWNER'),
        member(USER_C, 'User C', 'c@example.com', 'MEMBER', false, false),
      ]));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members/${USER_B}/permissions` && method === 'PATCH') {
        permissionCalls += 1;
        await pending;
        return fulfill(route, member(USER_B, 'User B', 'b@example.com', 'MEMBER', true, false));
      }
      return route.fallback();
    });

    await gotoWorkspace(page);
    await page.getByTestId(`workspace-member-publish-${USER_B}`).click();
    await page.getByTestId('workspace-selector').selectOption(WORKSPACE_B);
    await expect(page.getByTestId('workspace-member-row')).toHaveCount(2);
    release();
    await expect(page.getByTestId('workspace-selected-heading')).toContainText('Beta');
    expect(permissionCalls).toBe(1);
    await expect(page.getByTestId(`workspace-member-publish-${USER_C}`)).toContainText('Restricted');
  });

});
