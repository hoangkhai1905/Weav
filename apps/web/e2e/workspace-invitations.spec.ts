import { expect, test, type Page, type Route } from '@playwright/test';

const WORKSPACE_A = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_B = '00000000-0000-4000-8000-000000000002';
const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';

const workspace = (id: string, name: string) => ({
  id,
  name,
  createdBy: OWNER,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
});

const pageResult = <T,>(items: T[]) => ({ items, page: 0, size: 20, totalElements: items.length, totalPages: items.length ? 1 : 0 });

const member = (id: string, name: string, email: string, role: 'OWNER' | 'MEMBER') => ({
  userId: id,
  email,
  displayName: name,
  active: true,
  role,
  canPublishWorkflow: true,
  canManageWorkflowState: true,
  joinedAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
});

const ownerInvitation = (id: string, email: string, status = 'PENDING') => ({
  id,
  workspaceId: WORKSPACE_A,
  email,
  status,
  invitedBy: OWNER,
  createdAt: '2026-10-10T00:00:00Z',
  expiresAt: '2026-10-17T00:00:00Z',
  lastSentAt: '2026-10-10T00:00:00Z',
});

const myInvitation = (id: string, workspaceName: string) => ({
  id,
  workspaceId: WORKSPACE_B,
  workspaceName,
  invitedByName: 'Workspace Owner',
  expiresAt: '2026-10-17T00:00:00Z',
});

async function fulfill(route: Route, body: unknown, status = 200) {
  if (status === 204) return route.fulfill({ status, body: '' });
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const apiError = (code: string, message = code) => ({ code, message, requestId: 'req-1' });

/** Collects console errors so each test can assert the page stayed clean. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function installAuth(page: Page, userId = OWNER, emailVerifiedAt: string | null = '2026-08-01T00:00:00Z') {
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'token-invitations');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await page.route('**/api/auth/me', (route) => fulfill(route, {
    id: userId,
    email: 'user@example.test',
    displayName: 'Workspace Owner',
    avatarUrl: null,
    systemRole: 'USER',
    status: 'ACTIVE',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    emailVerifiedAt,
  }));
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v2/notifications/unread-count', (route) => fulfill(route, { count: 0 }));
}

async function gotoPath(page: Page, path: string) {
  const authResponse = page.waitForResponse((response) => response.url().includes('/api/auth/me'));
  await page.goto(path);
  await authResponse;
  if (new URL(page.url()).pathname === '/login') await page.goto(path);
}

test.describe('workspace invitations: owner side', () => {
  test('unknown e-mail offers an invitation; the pending list resends and revokes', async ({ page }) => {
    const consoleErrors = watchConsole(page);
    await installAuth(page);
    let invitations: ReturnType<typeof ownerInvitation>[] = [];
    let createBody: unknown;
    let resendAnswer: 'too_soon' | 'ok' = 'too_soon';
    let invitationListRequests = 0;
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const base = `/api/v1/workspaces/${WORKSPACE_A}`;
      if (url.pathname === '/api/v1/workspaces' && method === 'GET') return fulfill(route, pageResult([workspace(WORKSPACE_A, 'Alpha')]));
      if (url.pathname === `${base}/members` && method === 'GET') return fulfill(route, pageResult([member(OWNER, 'Workspace Owner', 'owner@example.test', 'OWNER')]));
      if (url.pathname === `${base}/members` && method === 'POST') return fulfill(route, apiError('USER_NOT_FOUND'), 404);
      if (url.pathname === `${base}/invitations` && method === 'GET') {
        invitationListRequests += 1;
        return fulfill(route, { items: invitations });
      }
      if (url.pathname === `${base}/invitations` && method === 'POST') {
        createBody = route.request().postDataJSON();
        const created = ownerInvitation('30000000-0000-4000-8000-000000000001', 'new.person@example.test');
        invitations = [created];
        return fulfill(route, created, 201);
      }
      if (url.pathname.endsWith('/resend') && method === 'POST') {
        if (resendAnswer === 'too_soon') return fulfill(route, apiError('INVITATION_RESEND_TOO_SOON'), 429);
        return fulfill(route, invitations[0]);
      }
      if (url.pathname.startsWith(`${base}/invitations/`) && method === 'DELETE') {
        invitations = [];
        return fulfill(route, null, 204);
      }
      return route.fallback();
    });

    await gotoPath(page, '/workspace/members');
    await expect(page.getByTestId('workspace-member-email')).toBeEnabled();
    await page.getByTestId('workspace-member-email').fill('new.person@example.test');
    await page.getByTestId('workspace-member-add-submit').click();

    await expect(page.getByTestId('workspace-invite-prompt')).toContainText('No Weav account exists with this email');
    await expect(page.getByTestId('workspace-member-error')).toHaveCount(0);
    await page.getByTestId('workspace-invite-send').click();

    expect(createBody).toEqual({ email: 'new.person@example.test' });
    await expect(page.getByTestId('workspace-invite-prompt')).toHaveCount(0);
    const row = page.getByTestId('workspace-invitation-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('new.person@example.test');

    await row.getByTestId('workspace-invitation-resend').click();
    await expect(page.getByTestId('workspace-member-error')).toContainText('wait 10 minutes');
    resendAnswer = 'ok';
    await row.getByTestId('workspace-invitation-resend').click();
    await expect(page.getByTestId('workspace-member-error')).toHaveCount(0);

    await row.getByTestId('workspace-invitation-revoke').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByTestId('workspace-invitation-row')).toHaveCount(0);
    expect(invitationListRequests).toBeGreaterThan(1);
    expect(consoleErrors.filter((text) => !text.includes('429') && !text.includes('404'))).toEqual([]);
  });

  test('maps INVITATION_EXISTS and shows the Expired badge without a resend button', async ({ page }) => {
    await installAuth(page);
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const base = `/api/v1/workspaces/${WORKSPACE_A}`;
      if (url.pathname === '/api/v1/workspaces' && method === 'GET') return fulfill(route, pageResult([workspace(WORKSPACE_A, 'Alpha')]));
      if (url.pathname === `${base}/members` && method === 'GET') return fulfill(route, pageResult([member(OWNER, 'Workspace Owner', 'owner@example.test', 'OWNER')]));
      if (url.pathname === `${base}/members` && method === 'POST') return fulfill(route, apiError('USER_NOT_FOUND'), 404);
      if (url.pathname === `${base}/invitations` && method === 'GET') return fulfill(route, { items: [ownerInvitation('30000000-0000-4000-8000-000000000002', 'old@example.test', 'EXPIRED')] });
      if (url.pathname === `${base}/invitations` && method === 'POST') return fulfill(route, apiError('INVITATION_EXISTS'), 409);
      return route.fallback();
    });

    await gotoPath(page, '/workspace/members');
    await expect(page.getByTestId('workspace-invitation-expired')).toBeVisible();
    await expect(page.getByTestId('workspace-invitation-resend')).toHaveCount(0);
    await page.getByTestId('workspace-member-email').fill('dup@example.test');
    await page.getByTestId('workspace-member-add-submit').click();
    await page.getByTestId('workspace-invite-send').click();
    await expect(page.getByTestId('workspace-member-error')).toContainText('already has a pending invitation');
  });

  test('a plain member never loads or sees the pending list', async ({ page }) => {
    await installAuth(page, OTHER);
    let listRequests = 0;
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const base = `/api/v1/workspaces/${WORKSPACE_A}`;
      if (url.pathname === '/api/v1/workspaces' && method === 'GET') return fulfill(route, pageResult([workspace(WORKSPACE_A, 'Alpha')]));
      if (url.pathname === `${base}/members` && method === 'GET') {
        return fulfill(route, pageResult([
          member(OWNER, 'Workspace Owner', 'owner@example.test', 'OWNER'),
          member(OTHER, 'Plain Member', 'user@example.test', 'MEMBER'),
        ]));
      }
      if (url.pathname.includes('/invitations')) {
        listRequests += 1;
        return fulfill(route, { items: [ownerInvitation('30000000-0000-4000-8000-000000000003', 'secret@example.test')] });
      }
      return route.fallback();
    });

    await gotoPath(page, '/workspace/members');
    await expect(page.getByTestId('workspace-unsupported-members')).toBeVisible();
    await expect(page.getByTestId('workspace-invitations')).toHaveCount(0);
    expect(listRequests).toBe(0);
  });
});

test('owner list load failure shows an alert with retry', async ({ page }) => {
  await installAuth(page);
  let fail = true;
  await page.route('**/api/v1/workspaces**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const base = `/api/v1/workspaces/${WORKSPACE_A}`;
    if (url.pathname === '/api/v1/workspaces' && method === 'GET') return fulfill(route, pageResult([workspace(WORKSPACE_A, 'Alpha')]));
    if (url.pathname === `${base}/members` && method === 'GET') return fulfill(route, pageResult([member(OWNER, 'Workspace Owner', 'owner@example.test', 'OWNER')]));
    if (url.pathname === `${base}/invitations` && method === 'GET') {
      if (fail) return fulfill(route, apiError('WORKSPACE_UNAVAILABLE'), 503);
      return fulfill(route, { items: [ownerInvitation('30000000-0000-4000-8000-000000000004', 'later@example.test')] });
    }
    return route.fallback();
  });
  await gotoPath(page, '/workspace/members');
  await expect(page.getByTestId('workspace-invitations-error')).toBeVisible();
  fail = false;
  await page.getByTestId('workspace-invitations-retry').click();
  await expect(page.getByTestId('workspace-invitation-row')).toContainText('later@example.test');
  await expect(page.getByTestId('workspace-invitations-error')).toHaveCount(0);
});

test.describe('workspace invitations: invitee side', () => {
  /** Signed-in user with no workspace yet, holding two invitations. */
  async function installInvitee(page: Page, options: { emailVerified?: boolean; acceptStatus?: number; acceptCode?: string } = {}) {
    const state = {
      items: [
        myInvitation('40000000-0000-4000-8000-000000000001', 'Beta team'),
        myInvitation('40000000-0000-4000-8000-000000000002', 'Gamma team'),
      ],
      workspaces: [] as ReturnType<typeof workspace>[],
      declined: [] as string[],
    };
    await installAuth(page, OTHER);
    await page.route('**/api/v1/invitations**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/v1/invitations' && method === 'GET') {
        return fulfill(route, { items: options.emailVerified === false ? [] : state.items, emailVerified: options.emailVerified !== false });
      }
      if (url.pathname.endsWith('/accept') && method === 'POST') {
        if (options.acceptStatus && options.acceptStatus !== 410) return fulfill(route, apiError(options.acceptCode ?? 'X'), options.acceptStatus);
        if (options.acceptStatus === 410) {
          state.items = [];
          return fulfill(route, apiError('INVITATION_GONE'), 410);
        }
        state.workspaces = [workspace(WORKSPACE_B, 'Beta team')];
        state.items = state.items.filter((item) => !url.pathname.includes(item.id));
        return fulfill(route, { workspaceId: WORKSPACE_B });
      }
      if (url.pathname.endsWith('/decline') && method === 'POST') {
        state.declined.push(url.pathname);
        state.items = state.items.filter((item) => !url.pathname.includes(item.id));
        return fulfill(route, null, 204);
      }
      return route.fallback();
    });
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces' && route.request().method() === 'GET') return fulfill(route, pageResult(state.workspaces));
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_B}/members`) {
        return fulfill(route, pageResult([member(OTHER, 'Workspace Owner', 'user@example.test', 'MEMBER')]));
      }
      return route.fallback();
    });
    return state;
  }

  test('dashboard banner shows the count and links to /invitations', async ({ page }) => {
    const consoleErrors = watchConsole(page);
    await installInvitee(page);
    await gotoPath(page, '/dashboard');
    const banner = page.getByTestId('dashboard-invitations-banner');
    await expect(banner).toContainText('2 workspace invitations');
    await banner.getByRole('link', { name: 'View invitations' }).click();
    await expect(page).toHaveURL(/\/invitations$/);
    await expect(page.getByTestId('invitation-card')).toHaveCount(2);
    expect(consoleErrors).toEqual([]);
  });

  test('accepting switches to the new workspace; declining removes the card', async ({ page }) => {
    const consoleErrors = watchConsole(page);
    const state = await installInvitee(page);
    await gotoPath(page, '/invitations');
    await expect(page.getByTestId('invitation-card')).toHaveCount(2);

    await page.getByTestId('invitation-card').filter({ hasText: 'Gamma team' }).getByTestId('invitation-decline').click();
    await expect(page.getByTestId('invitation-card')).toHaveCount(1);
    expect(state.declined).toHaveLength(1);

    await page.getByTestId('invitation-card').filter({ hasText: 'Beta team' }).getByTestId('invitation-accept').click();
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByTestId('topbar-workspace-selector')).toHaveValue(WORKSPACE_B);
    expect(consoleErrors).toEqual([]);
  });

  test('an unverified e-mail shows the notice linking to Settings', async ({ page }) => {
    await installInvitee(page, { emailVerified: false });
    await gotoPath(page, '/invitations');
    const notice = page.getByTestId('invitations-unverified');
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('link')).toHaveAttribute('href', '/settings/profile');
    await expect(page.getByTestId('invitation-card')).toHaveCount(0);
  });

  test('410 on accept shows the expired message and refreshes the list', async ({ page }) => {
    await installInvitee(page, { acceptStatus: 410 });
    await gotoPath(page, '/invitations');
    await page.getByTestId('invitation-accept').first().click();
    await expect(page.getByTestId('invitations-error')).toContainText('expired or was revoked');
    await expect(page.getByTestId('invitation-card')).toHaveCount(0);
    await expect(page).toHaveURL(/\/invitations$/);
  });

  test('accept maps 404 INVITATION_NOT_FOUND and 409 EMAIL_NOT_VERIFIED', async ({ page }) => {
    await installInvitee(page, { acceptStatus: 404, acceptCode: 'INVITATION_NOT_FOUND' });
    await gotoPath(page, '/invitations');
    await page.getByTestId('invitation-accept').first().click();
    await expect(page.getByTestId('invitations-error')).toContainText('expired or was revoked');
  });

  test('accept maps 409 EMAIL_NOT_VERIFIED', async ({ page }) => {
    await installInvitee(page, { acceptStatus: 409, acceptCode: 'EMAIL_NOT_VERIFIED' });
    await gotoPath(page, '/invitations');
    await page.getByTestId('invitation-accept').first().click();
    await expect(page.getByTestId('invitations-error')).toContainText('Verify your email');
  });

  test('no banner when there are no invitations or the e-mail is unverified', async ({ page }) => {
    await installInvitee(page, { emailVerified: false });
    await gotoPath(page, '/dashboard');
    await expect(page.getByTestId('dashboard-invitations-banner')).toHaveCount(0);
  });

  test('no banner when the list is empty', async ({ page }) => {
    const state = await installInvitee(page);
    state.items = [];
    await gotoPath(page, '/dashboard');
    await expect(page.getByTestId('dashboard-invitations-banner')).toHaveCount(0);
  });
});
