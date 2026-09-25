import { expect, test, type Page, type Route } from '@playwright/test';

const WORKSPACE_A = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_B = '00000000-0000-4000-8000-000000000002';
const WORKSPACE_C = '00000000-0000-4000-8000-000000000003';
const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '10000000-0000-4000-8000-000000000002';

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

const workspace = (id: string, name: string, createdBy: string) => ({
  id,
  name,
  createdBy,
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

const member = (id: string, name: string, email: string) => ({
  userId: id,
  email,
  displayName: name,
  active: true,
  role: 'MEMBER',
  canPublishWorkflow: true,
  canManageWorkflowState: false,
  joinedAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
});

async function installAuthFixture(page: Page, token = 'token-a') {
  await page.addInitScript(({ initialToken }) => {
    const browserGlobal = globalThis as unknown as {
      localStorage: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
      };
    };
    if (!browserGlobal.localStorage.getItem('weav_token')) {
      browserGlobal.localStorage.setItem('weav_token', initialToken);
    }
    browserGlobal.localStorage.setItem('weav_lang_v1', 'EN');
  }, { initialToken: token });

  await page.route('**/api/auth/me', async (route) => {
    const tokenHeader = route.request().headers().authorization;
    const isUserB = tokenHeader === 'Bearer token-b';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        isUserB ? user(USER_B, 'b@example.com', 'User B') : user(USER_A, 'a@example.com', 'User A'),
      ),
    });
  });

  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/notifications/unread-count', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) });
  });
}

async function fulfillWorkspaceApi(route: Route, response: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(response),
  });
}

async function gotoAuthenticated(page: Page, path: string) {
  const authResponse = page.waitForResponse((response) => response.url().includes('/api/auth/me'));
  await page.goto(path);
  await authResponse;
  if (new URL(page.url()).pathname === '/login') await page.goto(path);
}

test.describe('workspace read and switch foundation', () => {
  test('maps PageResult, switches by an existing ID, hides stale members, and disables unsupported mutations', async ({ page }) => {
    await installAuthFixture(page);

    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces') {
        await fulfillWorkspaceApi(route, pageResult([
          workspace(WORKSPACE_A, 'Alpha Workspace', USER_A),
          workspace(WORKSPACE_B, 'Beta Workspace', USER_A),
        ]));
        return;
      }

      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members`) {
        await fulfillWorkspaceApi(route, pageResult([member('member-a', 'Member Alpha', 'alpha@example.com')]));
        return;
      }

      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_B}/members`) {
        await fulfillWorkspaceApi(route, pageResult([member('member-b', 'Member Beta', 'beta@example.com')]));
        return;
      }

      await route.fallback();
    });

    await gotoAuthenticated(page, '/workspace');

    const selector = page.getByTestId('workspace-selector');
    await expect(selector).toBeVisible();
    await expect(selector.locator('option')).toHaveText(['Alpha Workspace', 'Beta Workspace']);
    await expect(selector).toHaveValue(WORKSPACE_A);
    await expect(page.getByTestId('workspace-member-row')).toContainText('Member Alpha');
    await expect(page.getByTestId('workspace-unsupported-members')).toBeVisible();
    await expect(page.getByRole('button', { name: /add member/i })).toBeDisabled();

    await selector.selectOption(WORKSPACE_B);
    await expect(page.getByTestId('workspace-member-row')).toHaveCount(0);
    await expect(page.getByTestId('workspace-member-row')).toContainText('Member Beta');
    await expect(page.getByTestId('workspace-member-row')).not.toContainText('Member Alpha');
  });

  test('renders an explicit empty state when the authenticated user has no workspace', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces') {
        await fulfillWorkspaceApi(route, pageResult([]));
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page, '/workspace');
    await expect(page.getByTestId('workspace-empty')).toBeVisible();
    await expect(page.getByTestId('workspace-selector')).toHaveCount(0);
    await expect(page.getByTestId('workspace-member-row')).toHaveCount(0);
  });

  test('surfaces a forbidden workspace-members response without showing stale data', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces') {
        await fulfillWorkspaceApi(route, pageResult([workspace(WORKSPACE_A, 'Alpha Workspace', USER_A)]));
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members`) {
        await fulfillWorkspaceApi(route, {
          error: { code: 'FORBIDDEN', message: 'Workspace access denied.', retryable: false },
          requestId: 'fixture-forbidden',
        }, 403);
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page, '/workspace');
    await expect(page.getByTestId('workspace-members-error')).toContainText('Workspace access denied.');
    await expect(page.getByTestId('workspace-member-row')).toHaveCount(0);
  });

  test('clears workspace state/cache across logout and login as another user', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/auth/login', async (route) => {
      await fulfillWorkspaceApi(route, {
        accessToken: 'token-b',
        refreshToken: 'refresh-token-b',
        user: user(USER_B, 'b@example.com', 'User B'),
      });
    });
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const tokenHeader = route.request().headers().authorization;
      const isUserB = tokenHeader === 'Bearer token-b';
      if (url.pathname === '/api/v1/workspaces') {
        await fulfillWorkspaceApi(route, pageResult([workspace(
          WORKSPACE_A,
          isUserB ? 'User B Workspace' : 'User A Workspace',
          isUserB ? USER_B : USER_A,
        )]));
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members`) {
        await fulfillWorkspaceApi(route, pageResult([
          member(
            isUserB ? 'member-b' : 'member-a',
            isUserB ? 'Member B' : 'Member A',
            isUserB ? 'member-b@example.com' : 'member-a@example.com',
          ),
        ]));
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page, '/workspace');
    await expect(page.getByTestId('workspace-member-row')).toContainText('Member A');

    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.locator('input[type="email"]').fill('b@example.com');
    await page.locator('input[type="password"]').fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto('/workspace');
    await expect(page.getByTestId('workspace-member-row')).toContainText('Member B');
    await expect(page.getByTestId('workspace-member-row')).not.toContainText('Member A');
    await expect(page.getByTestId('workspace-selected-name')).toContainText('User B Workspace');
  });
});

test.describe('workspace-scoped OCR', () => {
  test('uses the selected real workspace ID in the OCR URL', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces') {
        await fulfillWorkspaceApi(route, pageResult([workspace(WORKSPACE_B, 'Beta Workspace', USER_A)]));
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_B}/members`) {
        await fulfillWorkspaceApi(route, pageResult([]));
        return;
      }
      await route.fallback();
    });

    let capturedUrl = '';
    await page.route('**/api/v1/workspaces/*/ocr/extractions', async (route) => {
      capturedUrl = route.request().url();
      await fulfillWorkspaceApi(route, {
        schemaVersion: '1.0',
        requestId: 'fixture-ocr',
        document: { fileName: 'contract.pdf', mimeType: 'application/pdf', pages: 1 },
        text: { rawText: 'fixture text' },
        confidence: 0.9,
        blocks: [],
        tables: [],
        metadata: { language: 'vi+en', processingTimeMs: 1, quality: 'OK', warnings: [] },
      });
    });

    await gotoAuthenticated(page, '/workspace');
    await expect(page.getByTestId('workspace-selector')).toHaveValue(WORKSPACE_B);
    const membersResponse = page.waitForResponse((response) => response.url().includes(`/api/v1/workspaces/${WORKSPACE_B}/members`));
    await page.goto('/workflows/wf-001/builder');
    await membersResponse;
    await expect(page.getByTestId('builder-workspace-context')).toContainText(WORKSPACE_B);
    await page.getByRole('button', { name: 'OCR Text Extract' }).click();
    await page.getByTestId('workflow-inspector').getByTestId('ocr-file-input').setInputFiles({
      name: 'contract.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fixture'),
    });
    await page.getByTestId('workflow-inspector').getByRole('button', { name: 'Extract text' }).click();

    await expect.poll(() => capturedUrl).not.toBe('');
    await expect(page.getByTestId('ocr-result')).toBeVisible();
    expect(capturedUrl).toContain(`/api/v1/workspaces/${WORKSPACE_B}/ocr/extractions`);
  });

  test('blocks OCR before any request when no workspace is selected', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces') {
        await fulfillWorkspaceApi(route, pageResult([]));
        return;
      }
      await route.fallback();
    });

    let ocrCalled = false;
    await page.route('**/api/v1/workspaces/*/ocr/extractions', async (route) => {
      ocrCalled = true;
      await route.abort();
    });

    await gotoAuthenticated(page, '/workflows/wf-001/builder');
    await page.getByRole('button', { name: 'OCR Text Extract' }).click();
    await page.getByTestId('workflow-inspector').getByTestId('ocr-file-input').setInputFiles({
      name: 'contract.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fixture'),
    });

    await expect(page.getByTestId('ocr-error')).toContainText('Select a workspace before uploading a document.');
    expect(ocrCalled).toBe(false);
  });
});

test.describe('workspace create and rename mutations', () => {
  test('creates a workspace from the response ID and OCR uses that selected workspace', async ({ page }) => {
    await installAuthFixture(page);
    let listCalls = 0;
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/v1/workspaces' && method === 'GET') {
        listCalls += 1;
        await fulfillWorkspaceApi(route, pageResult(
          listCalls >= 3
            ? [workspace(WORKSPACE_C, 'Created Workspace', USER_A)]
            : listCalls === 2
              ? [workspace(WORKSPACE_A, 'Alpha Workspace', USER_A), workspace(WORKSPACE_C, 'Created Workspace', USER_A)]
              : [workspace(WORKSPACE_A, 'Alpha Workspace', USER_A)],
        ));
        return;
      }
      if (url.pathname === '/api/v1/workspaces' && method === 'POST') {
        expect(route.request().postDataJSON()).toEqual({ name: 'Created Workspace' });
        await fulfillWorkspaceApi(route, workspace(WORKSPACE_C, 'Created Workspace', USER_A), 201);
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members` || url.pathname === `/api/v1/workspaces/${WORKSPACE_C}/members`) {
        await fulfillWorkspaceApi(route, pageResult([]));
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page, '/workspace');
    await page.getByTestId('workspace-create-name').fill('Created Workspace');
    await page.getByTestId('workspace-create-submit').click();
    await expect(page.getByTestId('workspace-selector')).toHaveValue(WORKSPACE_C);
    await expect(page.getByTestId('workspace-selected-name')).toContainText('Created Workspace');

    await page.goto('/workflows/wf-001/builder');
    await expect(page.getByTestId('builder-workspace-context')).toContainText(WORKSPACE_C);
    let capturedOcrUrl = '';
    await page.route('**/api/v1/workspaces/*/ocr/extractions', async (route) => {
      capturedOcrUrl = route.request().url();
      await fulfillWorkspaceApi(route, {
        schemaVersion: '1.0',
        requestId: 'fixture-create-ocr',
        document: { fileName: 'created.pdf', mimeType: 'application/pdf', pages: 1 },
        text: { rawText: 'fixture text' },
        confidence: 0.9,
        blocks: [],
        tables: [],
        metadata: { language: 'en', processingTimeMs: 1, quality: 'OK', warnings: [] },
      });
    });
    await page.getByRole('button', { name: 'OCR Text Extract' }).click();
    await page.getByTestId('workflow-inspector').getByTestId('ocr-file-input').setInputFiles({
      name: 'created.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fixture'),
    });
    await page.getByTestId('workflow-inspector').getByRole('button', { name: 'Extract text' }).click();
    await expect.poll(() => capturedOcrUrl).toContain(`/api/v1/workspaces/${WORKSPACE_C}/ocr/extractions`);
  });

  test('rejects invalid create input without sending a request', async ({ page }) => {
    await installAuthFixture(page);
    let createCalls = 0;
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces' && route.request().method() === 'GET') {
        await fulfillWorkspaceApi(route, pageResult([workspace(WORKSPACE_A, 'Alpha Workspace', USER_A)]));
        return;
      }
      if (url.pathname === '/api/v1/workspaces' && route.request().method() === 'POST') {
        createCalls += 1;
        await route.abort();
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members`) {
        await fulfillWorkspaceApi(route, pageResult([]));
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page, '/workspace');
    await page.getByTestId('workspace-create-name').fill('x'.repeat(256));
    await page.getByTestId('workspace-create-submit').click();
    await expect(page.getByTestId('workspace-create-error')).toContainText('255');
    expect(createCalls).toBe(0);
  });

  test('allows only one create mutation while the first request is pending', async ({ page }) => {
    await installAuthFixture(page);
    let createCalls = 0;
    let releaseCreate!: () => void;
    const createReleased = new Promise<void>((resolve) => { releaseCreate = resolve; });
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces' && route.request().method() === 'GET') {
        await fulfillWorkspaceApi(route, pageResult([workspace(WORKSPACE_A, 'Alpha Workspace', USER_A)]));
        return;
      }
      if (url.pathname === '/api/v1/workspaces' && route.request().method() === 'POST') {
        createCalls += 1;
        await createReleased;
        await fulfillWorkspaceApi(route, workspace(WORKSPACE_C, 'Pending Workspace', USER_A), 201);
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members`) {
        await fulfillWorkspaceApi(route, pageResult([]));
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page, '/workspace');
    await page.getByTestId('workspace-create-name').fill('Pending Workspace');
    await page.getByTestId('workspace-create-submit').click();
    await expect.poll(() => createCalls).toBe(1);
    await expect(page.getByTestId('workspace-create-submit')).toBeDisabled();
    await page.getByTestId('workspace-create-form').evaluate((form) => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(createCalls).toBe(1);
    releaseCreate();
    await expect(page.getByTestId('workspace-create-success')).toBeVisible();
  });

  test('keeps create input and shows the actual conflict without success', async ({ page }) => {
    await installAuthFixture(page);
    const successCount = 0;
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces' && route.request().method() === 'GET') {
        await fulfillWorkspaceApi(route, pageResult([workspace(WORKSPACE_A, 'Alpha Workspace', USER_A)]));
        return;
      }
      if (url.pathname === '/api/v1/workspaces' && route.request().method() === 'POST') {
        await fulfillWorkspaceApi(route, {
          error: { code: 'WORKSPACE_NAME_ALREADY_EXISTS', message: 'A workspace with this name already exists.', retryable: false },
          requestId: 'fixture-create-conflict',
        }, 409);
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members`) {
        await fulfillWorkspaceApi(route, pageResult([]));
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page, '/workspace');
    await page.getByTestId('workspace-create-name').fill('Duplicate Workspace');
    await page.getByTestId('workspace-create-submit').click();
    await expect(page.getByTestId('workspace-create-error')).toContainText('already exists');
    await expect(page.getByTestId('workspace-create-name')).toHaveValue('Duplicate Workspace');
    await expect(page.getByTestId('workspace-create-success')).toHaveCount(0);
    expect(successCount).toBe(0);
  });

  test('renames the active workspace label without changing its ID', async ({ page }) => {
    await installAuthFixture(page);
    let currentName = 'Alpha Workspace';
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces' && route.request().method() === 'GET') {
        await fulfillWorkspaceApi(route, pageResult([workspace(WORKSPACE_A, currentName, USER_A)]));
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}` && route.request().method() === 'PATCH') {
        expect(route.request().postDataJSON()).toEqual({ name: 'Renamed Workspace' });
        currentName = 'Renamed Workspace';
        await fulfillWorkspaceApi(route, workspace(WORKSPACE_A, currentName, USER_A));
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members`) {
        await fulfillWorkspaceApi(route, pageResult([]));
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page, '/workspace');
    await expect(page.getByTestId('workspace-rename-name')).toHaveValue('Alpha Workspace');
    await page.getByTestId('workspace-rename-name').fill('Renamed Workspace');
    await page.getByTestId('workspace-rename-submit').click();
    await expect(page.getByTestId('workspace-selector')).toHaveValue(WORKSPACE_A);
    await expect(page.getByTestId('workspace-selector').locator('option')).toHaveText(['Renamed Workspace']);
    await expect(page.getByTestId('workspace-selected-heading')).toHaveText('Renamed Workspace');
    await expect(page.getByTestId('workspace-rename-success')).toBeVisible();
  });

  test('keeps rename input and active state unchanged on forbidden response', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces' && route.request().method() === 'GET') {
        await fulfillWorkspaceApi(route, pageResult([workspace(WORKSPACE_A, 'Alpha Workspace', USER_A)]));
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}` && route.request().method() === 'PATCH') {
        await fulfillWorkspaceApi(route, {
          error: { code: 'FORBIDDEN', message: 'Only the workspace owner can rename it.', retryable: false },
          requestId: 'fixture-rename-forbidden',
        }, 403);
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members`) {
        await fulfillWorkspaceApi(route, pageResult([]));
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page, '/workspace');
    await page.getByTestId('workspace-rename-name').fill('Forbidden Rename');
    await page.getByTestId('workspace-rename-submit').click();
    await expect(page.getByTestId('workspace-rename-error')).toContainText('owner');
    await expect(page.getByTestId('workspace-rename-name')).toHaveValue('Forbidden Rename');
    await expect(page.getByTestId('workspace-selector')).toHaveValue(WORKSPACE_A);
    await expect(page.getByTestId('workspace-rename-success')).toHaveCount(0);
  });

  test('refreshes selection when rename reports that the workspace is no longer accessible', async ({ page }) => {
    await installAuthFixture(page);
    let listCalls = 0;
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/workspaces' && route.request().method() === 'GET') {
        listCalls += 1;
        await fulfillWorkspaceApi(route, pageResult(
          listCalls === 1 ? [workspace(WORKSPACE_A, 'Alpha Workspace', USER_A)] : [],
        ));
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}` && route.request().method() === 'PATCH') {
        await fulfillWorkspaceApi(route, {
          error: { code: 'WORKSPACE_NOT_FOUND', message: 'This workspace is no longer accessible.', retryable: false },
          requestId: 'fixture-rename-not-found',
        }, 404);
        return;
      }
      if (url.pathname === `/api/v1/workspaces/${WORKSPACE_A}/members`) {
        await fulfillWorkspaceApi(route, pageResult([]));
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page, '/workspace');
    await page.getByTestId('workspace-rename-name').fill('Lost Workspace');
    await page.getByTestId('workspace-rename-submit').click();
    await expect(page.getByTestId('workspace-empty')).toBeVisible();
    await expect(page.getByTestId('workspace-members-error')).toContainText('no longer accessible');
    await expect(page.getByTestId('workspace-selector')).toHaveCount(0);
  });

  test('does not write a create result into a different account after switching users', async ({ page }) => {
    await installAuthFixture(page);
    await page.route('**/api/auth/login', async (route) => {
      await fulfillWorkspaceApi(route, {
        accessToken: 'token-b',
        refreshToken: 'refresh-token-b',
        user: user(USER_B, 'b@example.com', 'User B'),
      });
    });
    let releaseCreate!: () => void;
    let createFinished!: () => void;
    const createReleased = new Promise<void>((resolve) => { releaseCreate = resolve; });
    const createFinishedPromise = new Promise<void>((resolve) => { createFinished = resolve; });
    await page.route('**/api/v1/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const isUserB = route.request().headers().authorization === 'Bearer token-b';
      if (url.pathname === '/api/v1/workspaces' && method === 'GET') {
        await fulfillWorkspaceApi(route, pageResult([workspace(
          isUserB ? WORKSPACE_B : WORKSPACE_A,
          isUserB ? 'User B Workspace' : 'User A Workspace',
          isUserB ? USER_B : USER_A,
        )]));
        return;
      }
      if (url.pathname === '/api/v1/workspaces' && method === 'POST') {
        await createReleased;
        await fulfillWorkspaceApi(route, workspace(WORKSPACE_C, 'User A Created', USER_A), 201);
        createFinished();
        return;
      }
      if (url.pathname.endsWith('/members')) {
        await fulfillWorkspaceApi(route, pageResult([]));
        return;
      }
      await route.fallback();
    });

    await gotoAuthenticated(page, '/workspace');
    await page.getByTestId('workspace-create-name').fill('User A Created');
    await page.getByTestId('workspace-create-submit').click();
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.locator('input[type="email"]').fill('b@example.com');
    await page.locator('input[type="password"]').fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    releaseCreate();
    await createFinishedPromise;
    await page.goto('/workspace');
    await expect(page.getByTestId('workspace-selector')).toHaveValue(WORKSPACE_B);
    await expect(page.getByTestId('workspace-selector').locator('option')).toHaveText(['User B Workspace']);
    await expect(page.getByText('User A Created')).toHaveCount(0);
  });
});
