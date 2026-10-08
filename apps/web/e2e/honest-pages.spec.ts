import { expect, test, type Page, type Route } from '@playwright/test';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const newWorkflowId = '00000000-0000-4000-8000-0000000000aa';
const userId = '00000000-0000-4000-8000-000000000010';
const userEmail = 'owner@example.test';
const base = `/api/v1/workspaces/${workspaceId}/workflows`;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const pageOf = (items: unknown[]) => ({ items, page: 0, size: 100, totalElements: items.length, totalPages: items.length ? 1 : 0 });
const workspace = { id: workspaceId, name: 'Honest Workspace', createdBy: userId, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', role: 'OWNER' };
const detail = (name: string) => ({
  workflowId: newWorkflowId, name, description: null, status: 'DRAFT', schemaVersion: '1.0', currentVersionId: null,
  createdAt: '2026-09-24T10:00:00Z', updatedAt: '2026-09-24T10:00:00Z', definition: { schemaVersion: '1.0', nodes: [], edges: [], variables: {} }, editorState: { nodes: {} },
});

interface Recorded { method: string; path: string; body: unknown }

/** Stubs the backend, records every /api request and lets each test override single routes. */
async function setup(
  page: Page,
  options: {
    workspaces?: unknown[];
    connections?: unknown[];
    generate?: (body: Record<string, unknown>, call: number) => unknown;
  } = {},
) {
  const requests: Recorded[] = [];
  let generateCalls = 0;
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'playwright-test-token');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const raw = request.postData();
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ method, path, body });
    if (path === '/api/auth/me') return json(route, { id: userId, email: userEmail, displayName: 'Owner' });
    if (path === '/api/v1/workspaces' && method === 'GET') return json(route, pageOf(options.workspaces ?? [workspace]));
    if (path === '/api/v1/workspaces' && method === 'POST') return json(route, { ...workspace, name: body?.name ?? workspace.name }, 201);
    if (path === `/api/v1/workspaces/${workspaceId}/connections`) return json(route, options.connections ?? []);
    if (path === `${base}/generate`) return json(route, options.generate?.(body, generateCalls++) ?? { status: 'unsupported', reasons: [{ code: 'OUT_OF_SCOPE' }] });
    if (path === base && method === 'POST') return json(route, { workflowId: newWorkflowId, status: 'DRAFT' }, 201);
    if (path === base) return json(route, { items: [], page: 0, size: 100, totalElements: 0 });
    if (path === `${base}/${newWorkflowId}/draft`) return json(route, detail(body?.name ?? 'Draft'));
    if (path === `${base}/${newWorkflowId}`) return json(route, detail('Draft'));
    return json(route, { items: [], page: 0, size: 20, totalElements: 0 });
  });
  return requests;
}

test.describe('honest pages', () => {
  test('AI generator sends the prompt, asks the needs_input questions and creates the draft from the result', async ({ page }) => {
    const definition = {
      schemaVersion: '1.0',
      nodes: [
        { id: 'manual_trigger', type: 'trigger.manual', config: {} },
        { id: 'send_mail', type: 'email.send', config: { to: userEmail, subject: 'Hi', body: 'Hello' } },
      ],
      edges: [{ id: 'edge_1', source: 'manual_trigger', target: 'send_mail' }],
      variables: {},
    };
    const requests = await setup(page, {
      connections: [{ id: '20000000-0000-4000-8000-000000000001', workspaceId, createdBy: userId, name: 'Work Gmail', provider: 'GMAIL', authType: 'OAUTH2', status: 'ACTIVE', config: null, hasCredential: true, credentialExpiresAt: null, lastVerifiedAt: null, canManage: true, canAttach: true, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }],
      generate: (_body, call) => call === 0
        ? { status: 'needs_input', questions: [{ code: 'VALUE', field: 'email.send.to' }, { code: 'CONNECTION', field: 'email.send' }] }
        : { status: 'ready', name: 'Gửi thư chào', definition, layout: { manual_trigger: { name: 'Chạy thủ công', x: 80, y: 160 }, send_mail: { name: 'Gửi email', x: 360, y: 160 } } },
    });
    await page.goto('/ai/workflow-generator');

    await expect(page.getByTestId('ai-generator-page')).toBeVisible();
    await expect(page.getByText('5 steps ready')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'What should this workflow do?' }).fill('Send me a greeting email');
    await page.getByRole('button', { name: 'Generate workflow', exact: true }).click();

    // needs_input: the recipient defaults to the signed-in user's email and the connection is a select.
    await expect(page.getByLabel(/Which address should the email go to/)).toHaveValue(userEmail);
    await expect(page.getByRole('button', { name: 'Send answers' })).toBeDisabled();
    await page.getByLabel(/Pick a connection for this step/).selectOption({ label: 'Work Gmail' });
    await page.getByRole('button', { name: 'Send answers' }).click();

    await expect(page.getByTestId('ai-generator-preview')).toContainText('Gửi thư chào');
    const generateCalls = requests.filter((entry) => entry.path === `${base}/generate`);
    expect(generateCalls).toHaveLength(2);
    expect(generateCalls[0].body).toMatchObject({ prompt: 'Send me a greeting email' });
    expect(generateCalls[1].body).toMatchObject({ prompt: 'Send me a greeting email', answers: { 'email.send.to': userEmail } });
    expect((generateCalls[1].body as { connections: Record<string, string> }).connections).toEqual({ 'email.send': '20000000-0000-4000-8000-000000000001' });

    await page.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForURL(`**/workflows/${newWorkflowId}/builder`);
    const saved = requests.find((entry) => entry.method === 'PUT' && entry.path === `${base}/${newWorkflowId}/draft`);
    expect(saved?.body).toMatchObject({ name: 'Gửi thư chào', definition });
    expect(JSON.stringify(requests)).not.toContain('wf-prod-8492');
  });

  test('the template button saves the full definition as a draft and opens the builder', async ({ page }) => {
    const requests = await setup(page);
    await page.goto('/workflows/new');
    await page.getByTestId('template-telegram-auto-reply').getByRole('button', { name: /Use template/ }).click();
    await page.waitForURL(`**/workflows/${newWorkflowId}/builder`);

    const created = requests.find((entry) => entry.method === 'POST' && entry.path === base);
    expect(created?.body).toMatchObject({ name: 'Telegram auto-reply bot' });
    const saved = requests.find((entry) => entry.method === 'PUT' && entry.path === `${base}/${newWorkflowId}/draft`);
    const definition = (saved?.body as { definition: { nodes: Array<{ id: string; type: string; config: Record<string, unknown> }>; edges: unknown[] } }).definition;
    expect(definition.nodes.map((node) => node.id)).toEqual(['telegram_trigger', 'send_reply']);
    expect(definition.nodes[1].config.chatId).toBe('{{ trigger.input.message.chat.id }}');
    expect(definition.nodes.every((node) => !('connectionId' in node.config))).toBe(true);
    expect(definition.edges).toHaveLength(1);
  });

  test('the Telegram page lists the workspace bot connections and calls no /api/telegram endpoint', async ({ page }) => {
    const requests = await setup(page, {
      connections: [{ id: '20000000-0000-4000-8000-000000000003', workspaceId, createdBy: userId, name: 'Shop bot', provider: 'TELEGRAM', authType: 'TOKEN', status: 'ACTIVE', config: null, hasCredential: true, credentialExpiresAt: null, lastVerifiedAt: null, canManage: true, canAttach: true, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }],
    });
    await page.goto('/telegram');
    await expect(page.getByRole('heading', { name: /Connect a Telegram bot/ })).toBeVisible();
    await expect(page.getByText('Shop bot')).toBeVisible();
    await expect(page.getByText('@BotFather', { exact: false }).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('/run wf-001');
    expect(requests.filter((entry) => entry.path.startsWith('/api/telegram'))).toEqual([]);
  });

  test('a user without a workspace sees the create card instead of a failed data load', async ({ page }) => {
    const requests = await setup(page, { workspaces: [] });
    await page.goto('/dashboard');
    const card = page.getByTestId('first-workspace-card');
    await expect(card).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Retry');
    await card.getByLabel('Workspace name').fill('Team Alpha');
    await card.getByRole('button', { name: 'Create workspace' }).click();
    await expect.poll(() => requests.some((entry) => entry.method === 'POST' && entry.path === '/api/v1/workspaces')).toBe(true);
    expect(requests.find((entry) => entry.method === 'POST' && entry.path === '/api/v1/workspaces')?.body).toMatchObject({ name: 'Team Alpha' });
  });

  test('the sidebar links to Telegram and the notification center, and /assistant has its own breadcrumb', async ({ page }) => {
    await setup(page);
    await page.goto('/assistant');
    await expect(page.getByTestId('topbar-breadcrumb-current')).toHaveText('AI Assistant');
    const sidebar = page.getByTestId('app-sidebar');
    await expect(sidebar.getByRole('link', { name: 'Telegram Bot', exact: true })).toHaveAttribute('href', '/telegram');
    await expect(sidebar.getByRole('link', { name: 'Notification center', exact: true })).toHaveAttribute('href', '/notifications');
  });
});
