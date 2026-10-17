import { expect, test, type Page, type Route } from '@playwright/test';

// Simple node UI: schema fields show label, hint and example; advanced fields sit under "Thêm tùy chọn" (backend stubbed).

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workflowId = '00000000-0000-4000-8000-000000000002';
const base = `**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}`;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const draft = (extraNodes: Array<{ id: string; type: string; config: Record<string, unknown> }> = []) => ({
  workflowId,
  name: 'Simple nodes',
  status: 'DRAFT',
  schemaVersion: '1.0',
  definition: {
    schemaVersion: '1.0',
    nodes: [{ id: 'manual', type: 'trigger.manual', config: {} }, ...extraNodes],
    // Publish needs every step reachable; the publish-error fixtures name their step tg1.
    edges: extraNodes.filter((node) => node.id === 'tg1').map((node) => ({ id: 'e1', source: 'manual', target: node.id })),
    variables: {},
  },
  editorState: {
    nodes: {
      manual: { name: 'Manual trigger', position: { x: 100, y: 120 } },
      ...Object.fromEntries(extraNodes.map((node, index) => [node.id, { name: node.type, position: { x: 100, y: 300 + index * 120 } }])),
    },
  },
  currentVersionId: null,
  createdAt: '2026-10-10T10:00:00Z',
  updatedAt: '2026-10-10T10:00:00Z',
  publishedAt: null,
  triggers: [],
});

async function stubBackend(page: Page, extraNodes: Array<{ id: string; type: string; config: Record<string, unknown> }> = []) {
  let current: Record<string, unknown> = draft(extraNodes);
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'playwright-test-token');
    localStorage.setItem('weav_lang_v1', 'VI');
  });
  await page.route('**/api/auth/me', (route) => json(route, { id: '00000000-0000-4000-8000-000000000010', email: 'test@example.test', displayName: 'Playwright User', avatarUrl: null, systemRole: 'USER', status: 'ACTIVE', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', emailVerifiedAt: null }));
  await page.route('**/api/v2/notifications/unread-count', (route) => json(route, { count: 0 }));
  const workspace = { id: workspaceId, name: 'Real Workspace', createdBy: '00000000-0000-4000-8000-000000000010', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' };
  await page.route(`**/api/v1/workspaces/${workspaceId}`, (route) => json(route, workspace));
  await page.route('**/api/v1/workspaces?**', (route) => json(route, { items: [workspace], page: 0, size: 100, totalElements: 1, totalPages: 1 }));
  await page.route(`**/api/v1/workspaces/${workspaceId}/connections**`, (route) => json(route, []));
  await page.route(/\/workflows\?page=/, (route) => json(route, { items: [{ workflowId, name: 'Simple nodes', status: 'DRAFT' }], page: 0, size: 100, totalElements: 1, totalPages: 1 }));
  await page.route(base, (route) => json(route, current));
  await page.route(`${base}/draft`, (route) => {
    current = { ...current, ...(route.request().postDataJSON() as object) };
    return json(route, current);
  });
}

async function openBuilder(page: Page) {
  await page.goto(`/workflows/${workflowId}/builder`);
  await expect(page.getByTestId('workflow-title')).toHaveValue('Simple nodes');
}

async function addNode(page: Page, nodeType: string) {
  await page.getByTestId('workflow-add-step').click();
  await page.locator(`[data-testid="workflow-palette-item"][data-node-type="${nodeType}"]`).click();
}

test('schema fields show label, hint and example', async ({ page }) => {
  await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'discord.send_message');
  const field = page.getByTestId('field-content');
  await expect(page.locator('#field-discord-send_message-content-label')).toContainText('Nội dung tin nhắn');
  await expect(page.locator('#field-discord-send_message-content-hint')).toContainText('Tối đa 2000 ký tự');
  await expect(field).toHaveAttribute('aria-describedby', /field-discord-send_message-content-hint/);
  await expect(page.locator('[data-placeholder="Ví dụ: Đơn hàng mới vừa được tạo"], [placeholder="Ví dụ: Đơn hàng mới vừa được tạo"]')).toHaveCount(1);
});

test('advanced fields are collapsed until they hold a value', async ({ page }) => {
  await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'google.calendar');
  const section = page.getByTestId('schema-advanced');
  await expect(section.locator('summary')).toHaveText('Thêm tùy chọn (1)');
  await expect(section).not.toHaveAttribute('open', /.*/);
  await expect(page.getByTestId('field-location')).toBeHidden();
  await section.locator('summary').click();
  await expect(page.getByTestId('field-location')).toBeVisible();
});

test('an advanced field with a saved value starts open', async ({ page }) => {
  await stubBackend(page, [{ id: 'cal', type: 'google.calendar', config: { operation: 'create', location: 'Hà Nội' } }]);
  await openBuilder(page);
  await page.getByTestId('rf__node-cal').getByTestId('workflow-node').click();
  await expect(page.getByTestId('schema-advanced')).toHaveAttribute('open', '');
  await expect(page.getByTestId('field-location')).toHaveText('Hà Nội');
});

test('email extras sit under Thêm tùy chọn and open when set', async ({ page }) => {
  await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'email.send');
  const section = page.getByTestId('email-advanced');
  await expect(section.locator('summary')).toContainText('Thêm tùy chọn (');
  await expect(section).not.toHaveAttribute('open', /.*/);
});

test('email extras start open when one is set', async ({ page }) => {
  await stubBackend(page, [{ id: 'mail', type: 'email.send', config: { replyTo: 'a@example.test' } }]);
  await openBuilder(page);
  await page.getByTestId('rf__node-mail').getByTestId('workflow-node').click();
  await expect(page.getByTestId('email-advanced')).toHaveAttribute('open', '');
});

test('node id lives in the technical footer', async ({ page }) => {
  await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'http.request');
  const footer = page.getByTestId('inspector-technical');
  await expect(footer.locator('summary')).toHaveText('Chi tiết kỹ thuật');
  await expect(page.getByTestId('inspector-node-id')).toBeHidden();
  await footer.locator('summary').click();
  await expect(page.getByTestId('inspector-node-id')).toHaveText('http_1');
  await expect(page.getByTestId('inspector-node-id-copy')).toBeVisible();
});

test('telegram extras are closed on a new step and open when one is set', async ({ page }) => {
  await stubBackend(page, [{ id: 'tg', type: 'telegram.send_message', config: { parseMode: 'HTML' } }]);
  await openBuilder(page);
  await addNode(page, 'telegram.send_message');
  await expect(page.getByTestId('telegram-advanced').locator('summary')).toContainText('Thêm tùy chọn (');
  await expect(page.getByTestId('telegram-advanced')).not.toHaveAttribute('open', /.*/);
  await page.getByTestId('rf__node-tg').getByTestId('workflow-node').click();
  await expect(page.getByTestId('telegram-advanced')).toHaveAttribute('open', '');
});

test('hand-written mapping fields are reachable by their label', async ({ page }) => {
  await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'http.request');
  await expect(page.getByLabel(/^URL/)).toBeVisible();
  await page.getByLabel(/^URL/).click();
  await page.keyboard.type('https://example.test');
  await expect(page.locator('#http-url')).toContainText('https://example.test');
  await addNode(page, 'telegram.send_message');
  await expect(page.getByLabel('Nội dung tin nhắn')).toBeVisible();
});

const TG_CONNECTION = '20000000-0000-4000-8000-000000000003';
const namedTelegram = [{ id: 'tg1', type: 'telegram.send_message', config: { connectionId: TG_CONNECTION, chatId: '1', text: 'hi' } }];

// An active Telegram connection, so the step is complete and Publish is enabled (the 400 is stubbed).
async function stubTelegramConnection(page: Page, provider = 'TELEGRAM') {
  await page.route(`**/api/v1/workspaces/${workspaceId}/connections**`, (route) => json(route, [{
    id: TG_CONNECTION, workspaceId, createdBy: '00000000-0000-4000-8000-000000000010', name: 'Bot', provider, authType: 'API_KEY',
    status: 'ACTIVE', config: null, hasCredential: true, credentialExpiresAt: null, lastVerifiedAt: null, canManage: true,
    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
  }]));
}

async function stubPublishError(page: Page, field: string, message: string) {
  await page.route(`${base}/publish`, (route) =>
    json(route, { error: { code: 'VALIDATION_ERROR', message: 'Workflow definition is invalid', details: [{ field, message }] } }, 400));
}



test('publish error names the step and the field', async ({ page }) => {
  await stubBackend(page, namedTelegram);
  await stubTelegramConnection(page);
  await page.route(`${base}`, (route) => json(route, { ...draft(namedTelegram), editorState: { nodes: { manual: { name: 'Manual trigger', position: { x: 100, y: 120 } }, tg1: { name: 'Gửi tin Telegram', position: { x: 100, y: 300 } } } } }));
  await stubPublishError(page, 'nodes[tg1].config.text', 'REQUIRED_FIELD_MISSING: text is required');
  await openBuilder(page);
  await page.getByTestId('workflow-publish').click();
  const issue = page.getByText("Bước 'Gửi tin Telegram': cần điền 'Nội dung tin nhắn'");
  await expect(issue.first()).toBeVisible();
  await expect(page.getByText(/nodes\[|config\./)).toHaveCount(0);
});

test('unknown field falls back to a name, never a key', async ({ page }) => {
  await stubBackend(page, namedTelegram);
  await stubTelegramConnection(page);
  await stubPublishError(page, 'nodes[tg1].config.legacyThing', 'UNKNOWN_CONFIG_FIELD: nope');
  await openBuilder(page);
  await page.getByTestId('workflow-publish').click();
  await expect(page.getByText(/legacyThing/).first()).toBeVisible();
  await expect(page.getByText(/undefined|builder\.field\./)).toHaveCount(0);
});

test('readiness banner lists missing fields by label', async ({ page }) => {
  await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'telegram.send_message');
  await expect(page.getByTestId('integration-readiness')).toContainText(/Cần điền: .*Nội dung tin nhắn/);
  // The banner uses the label the field itself shows.
  for (const id of ['telegram-text', 'telegram-chat-id']) {
    const fieldLabel = ((await page.locator(`#${id}-label`).textContent()) ?? '').replace(/[*]/g, '').trim();
    expect(fieldLabel).not.toBe('');
    await expect(page.getByTestId('integration-readiness')).toContainText(fieldLabel);
  }
  await expect(page.locator('#telegram-chat-id-label')).toContainText('Gửi tới');
});

test('advanced section opens for a publish error', async ({ page }) => {
  await stubBackend(page, namedTelegram);
  await stubTelegramConnection(page);
  await stubPublishError(page, 'nodes[tg1].config.parseMode', 'INVALID_ENUM_VALUE: parseMode bad');
  await openBuilder(page);
  await page.getByTestId('rf__node-tg1').getByTestId('workflow-node').click();
  await expect(page.getByTestId('telegram-advanced')).not.toHaveAttribute('open', /.*/);
  await page.getByTestId('workflow-publish').click();
  await expect(page.getByTestId('telegram-advanced')).toHaveAttribute('open', '');
});

test('email reply with blank subject is ready', async ({ page }) => {
  const reply = [{ id: 'mail1', type: 'email.send', config: { connectionId: TG_CONNECTION, to: 'a@example.test', body: 'hi', replyToMessageId: 'msg-1' } }];
  await stubBackend(page, reply);
  await stubTelegramConnection(page, 'GMAIL');
  await openBuilder(page);
  await page.getByTestId('rf__node-mail1').getByTestId('workflow-node').click();
  await expect(page.getByTestId('email-config')).toBeVisible();
  await expect(page.getByTestId('integration-readiness')).toHaveCount(0);
  await expect(page.getByText(/Cần điền/)).toHaveCount(0);
});
