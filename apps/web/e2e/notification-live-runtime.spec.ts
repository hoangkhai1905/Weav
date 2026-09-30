import { createHmac, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test, type Page, type Route } from '@playwright/test';

test.use({ trace: 'off' });

const liveNotificationsEnabled = process.env.WEAV_E2E_LIVE_NOTIFICATIONS === '1';

const USER_ID = '90000000-0000-4000-8000-000000000008';
const WORKSPACE_ONE = 'Task8 Live Workspace One';
const WORKSPACE_TWO = 'Task8 Live Workspace Two';
const RENAMED_WORKSPACE = 'Task8 Renamed Workspace';

function createSyntheticAccessToken() {
  const secret = process.env.WEAV_TASK8_JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('WEAV_TASK8_JWT_SECRET must be a test-only secret of at least 32 bytes.');
  }

  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: 'weav-identity',
    aud: ['weav-api'],
    sub: USER_ID,
    jti: randomUUID(),
    sid: randomUUID(),
    token_use: 'access',
    system_role: 'USER',
    user_status: 'ACTIVE',
    iat: now,
    nbf: now,
    exp: now + 1800,
  });
  const signedContent = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(signedContent).digest('base64url');
  return `${signedContent}.${signature}`;
}

async function installSyntheticIdentity(page: Page) {
  const token = createSyntheticAccessToken();
  await page.addInitScript((accessToken) => {
    localStorage.setItem('weav_token', accessToken);
    localStorage.setItem('weav_lang_v1', 'EN');
  }, token);
  await page.route('**/api/auth/me', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: USER_ID,
        email: 'task8-runtime@example.invalid',
        displayName: 'Task 8 Runtime User',
        avatarUrl: null,
        systemRole: 'USER',
        status: 'ACTIVE',
        createdAt: '2026-09-28T00:00:00.000Z',
        updatedAt: '2026-09-28T00:00:00.000Z',
        emailVerifiedAt: null,
      }),
    });
  });
}

async function refreshUntilWorkspaceNotifications(page: Page) {
  const titles = page.getByText('Workspace created', { exact: true });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await titles.count() === 2) return;
    await page.getByRole('button', { name: 'Refresh' }).click();
    try {
      await expect(titles).toHaveCount(2, { timeout: 500 });
      return;
    } catch {
      // Outbox publication and broker consumption are asynchronous; refresh on the next bounded turn.
    }
  }
  await expect(titles).toHaveCount(2);
}

test.skip(
  !liveNotificationsEnabled,
  'Live notification runtime is opt-in; set WEAV_E2E_LIVE_NOTIFICATIONS=1 for the disposable stack.',
);

test('real workspace outbox events reach the v2 inbox; a rename shows one toast without a self milestone', async ({ page }, testInfo) => {
  const httpEvidence = new Set<string>();
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/v1/workspaces') && !url.pathname.startsWith('/api/v2/notifications')) return;
    const path = url.pathname.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,36}(?=\/|$)/gi, '/:id');
    httpEvidence.add(`${response.request().method()} ${path} ${response.status()}`);
  });

  await installSyntheticIdentity(page);
  await page.goto('/workspace');
  await expect(page.getByTestId('workspace-create-form')).toBeVisible();

  for (const [index, name] of [WORKSPACE_ONE, WORKSPACE_TWO].entries()) {
    await page.getByTestId('workspace-create-name').fill(name);
    await page.getByTestId('workspace-create-submit').click();
    const createToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Workspace created.' });
    await expect(createToast).toHaveCount(1);
    await expect(page.getByTestId('workspace-create-name')).toHaveValue('');
    if (index === 0) {
      await createToast.getByRole('button', { name: 'Close toast' }).click();
      await expect(createToast).toHaveCount(0);
    }
  }

  await page.getByRole('link', { name: /^Notifications/ }).click();
  await refreshUntilWorkspaceNotifications(page);
  await expect(page.getByText('2 unread', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open related item: Workspace created/ })).toHaveCount(2);

  const firstWorkspaceNotification = page.locator('article').filter({ hasText: WORKSPACE_ONE });
  await firstWorkspaceNotification.getByRole('button', { name: /Mark as read/ }).click();
  await expect(firstWorkspaceNotification.getByText('Read', { exact: true })).toBeVisible();
  await expect(page.getByText('1 unread', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByText('0 unread', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Workspace', exact: true }).click();
  await page.getByTestId('workspace-selector').selectOption({ label: WORKSPACE_ONE });
  await page.getByTestId('workspace-rename-name').fill(RENAMED_WORKSPACE);
  await page.getByTestId('workspace-rename-submit').click();
  await expect(page.getByText('Workspace renamed.', { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('workspace-selected-heading')).toHaveText(RENAMED_WORKSPACE);

  await page.getByRole('link', { name: /^Notifications/ }).click();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('0 unread', { exact: true })).toBeVisible();
  await expect(page.getByText('Workspace created', { exact: true })).toHaveCount(2);

  // Allow the asynchronous outbox/broker/consumer pipeline to settle; confirm absence
  // from fresh server reads rather than relying on one immediate, possibly stale read.
  const notificationListPath = '/api/v2/notifications';
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const listResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.pathname === notificationListPath;
    });
    await page.getByRole('button', { name: 'Refresh' }).click();
    const listResponse = await listResponsePromise;
    expect(listResponse.status()).toBe(200);
    const list = await listResponse.json() as { items: Array<{ eventType: string }> };
    expect(list.items.filter((item) => item.eventType === 'workspace.created')).toHaveLength(2);
    expect(list.items.some((item) => item.eventType === 'workspace.renamed')).toBe(false);
    await expect(page.getByText('Workspace renamed', { exact: true })).toHaveCount(0);
    if (attempt < 14) await page.waitForTimeout(1000);
  }

  const evidence = [...httpEvidence].sort();
  expect(evidence).toContain('POST /api/v1/workspaces 201');
  expect(evidence).toContain('PATCH /api/v1/workspaces/:id 200');
  expect(evidence).toContain('GET /api/v2/notifications 200');
  expect(evidence).toContain('GET /api/v2/notifications/unread-count 200');
  expect(evidence).toContain('PATCH /api/v2/notifications/:id/read 200');
  expect(evidence).toContain('POST /api/v2/notifications/read-all 200');
  // Evidence is deliberately limited to method, normalized path and status; never log headers or bodies.
  console.info(`Task8 live HTTP evidence: ${evidence.join('; ')}; rename negative readbacks=15 over 14s`);
  const evidencePath = process.env.WEAV_TASK8_HTTP_EVIDENCE_PATH;
  if (evidencePath) await writeFile(evidencePath, evidence.join('\n'), { encoding: 'utf8', flag: 'wx' });
  await testInfo.attach('task8-live-http-status-evidence', {
    body: Buffer.from(evidence.join('\n')),
    contentType: 'text/plain',
  });
});
