import { expect, test, type Page, type Route } from '@playwright/test';

// Simple node UI: schema fields show label, hint and example; advanced fields sit under "Thêm tùy chọn" (backend stubbed).

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workflowId = '00000000-0000-4000-8000-000000000002';
const base = `**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}`;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

type StubNode = { id: string; type: string; config: Record<string, unknown> };
type StubGraph = { edges?: Array<[string, string]>; names?: Record<string, string> };

const draft = (extraNodes: StubNode[] = [], graph: StubGraph = {}) => ({
  workflowId,
  name: 'Simple nodes',
  status: 'DRAFT',
  schemaVersion: '1.0',
  definition: {
    schemaVersion: '1.0',
    nodes: [{ id: 'manual', type: 'trigger.manual', config: {} }, ...extraNodes],
    // Publish needs every step reachable; the publish-error fixtures name their step tg1.
    edges: graph.edges ? graph.edges.map(([source, target], index) => ({ id: `g${index}`, source, target })) : extraNodes.filter((node) => node.id === 'tg1' || node.id === 'http_1').map((node) => ({ id: 'e1', source: extraNodes.some((other) => other.id === 'tgt') ? 'tgt' : 'manual', target: node.id })),
    variables: {},
  },
  editorState: {
    nodes: {
      manual: { name: 'Manual trigger', position: { x: 100, y: 120 } },
      ...Object.fromEntries(extraNodes.map((node, index) => [node.id, { name: graph.names?.[node.id] ?? node.type, position: { x: 100, y: 300 + index * 120 } }])),
    },
  },
  currentVersionId: null,
  createdAt: '2026-10-10T10:00:00Z',
  updatedAt: '2026-10-10T10:00:00Z',
  publishedAt: null,
  triggers: [],
});

async function stubBackend(page: Page, extraNodes: StubNode[] = [], graph: StubGraph = {}) {
  let current: Record<string, unknown> = draft(extraNodes, graph);
  const savedDrafts: Array<Record<string, unknown>> = [];
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
    savedDrafts.push(current);
    return json(route, current);
  });
  return savedDrafts;
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

test('telegram reply target and other chat have distinct labels', async ({ page }) => {
  await stubBackend(page, [
    { id: 'tgt', type: 'trigger.telegram', config: {} },
    { id: 'tg1', type: 'telegram.send_message', config: { connectionId: TG_CONNECTION, chatId: '', text: 'hi' } },
  ]);
  await stubTelegramConnection(page);
  await openBuilder(page);
  await page.getByTestId('rf__node-tg1').getByTestId('workflow-node').click();
  await page.getByTestId('telegram-chat-target').selectOption('custom');
  await expect(page.getByLabel('Gửi tới', { exact: false })).toHaveCount(1);
  await expect(page.getByLabel('Gửi tới', { exact: false })).toHaveAttribute('data-testid', 'telegram-chat-target');
  await expect(page.getByLabel('Cuộc trò chuyện khác')).toHaveAttribute('id', 'telegram-chat-id');
});

test('advanced section stays open after clearing its value', async ({ page }) => {
  await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'google.calendar');
  const section = page.getByTestId('schema-advanced');
  await section.locator('summary').click();
  await expect(section).toHaveAttribute('open', '');
  const field = page.getByTestId('field-location');
  await field.click();
  await page.keyboard.type('Hà Nội');
  await expect(field).toHaveText('Hà Nội');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await expect(field).toHaveText('');
  await expect(section).toHaveAttribute('open', '');
});

test('email reply target and custom recipient have distinct labels', async ({ page }) => {
  await stubBackend(page, [
    { id: 'tgt', type: 'trigger.gmail', config: {} },
    { id: 'tg1', type: 'email.send', config: { connectionId: TG_CONNECTION } },
  ]);
  await stubTelegramConnection(page, 'GMAIL');
  await openBuilder(page);
  await page.getByTestId('rf__node-tg1').getByTestId('workflow-node').click();
  await page.getByTestId('email-target').selectOption('custom');
  await expect(page.getByLabel('Gửi tới', { exact: false })).toHaveCount(1);
  await expect(page.getByLabel('Gửi tới', { exact: false })).toHaveAttribute('data-testid', 'email-target');
  await expect(page.getByLabel('Địa chỉ người nhận')).toHaveAttribute('id', 'email-to');
});

test('no english schema description shows as a hint in vietnamese', async ({ page }) => {
  await stubBackend(page);
  await openBuilder(page);
  const inspector = page.getByTestId('workflow-inspector');
  await addNode(page, 'telegram.send_message');
  await expect(inspector).toContainText('Nội dung tin nhắn');
  await expect(inspector).not.toContainText('Message text to send.');
  await addNode(page, 'http.request');
  await expect(inspector.getByTestId('http-request-config')).toBeVisible();
  await expect(inspector).not.toContainText('HTTP method:');
});

test('publish error for an unnamed step uses the step type name, not its id', async ({ page }) => {
  await stubBackend(page, [{ id: 'http_1', type: 'http.request', config: { method: 'GET', url: 'https://example.test' } }]);
  await page.route(base, (route) => json(route, { ...draft([{ id: 'http_1', type: 'http.request', config: { method: 'GET', url: 'https://example.test' } }]), editorState: { nodes: { manual: { name: 'Manual trigger', position: { x: 100, y: 120 } } } } }));
  await stubPublishError(page, 'nodes[http_1].config.url', 'REQUIRED_FIELD_MISSING: url is required');
  await openBuilder(page);
  await page.getByTestId('workflow-publish').click();
  await expect(page.getByText(/Bước 'HTTP Request'/).first()).toBeVisible();
  await expect(page.getByTestId('workflow-builder-error')).not.toContainText('http_1');
});

test('email body has no required marker', async ({ page }) => {
  await stubBackend(page);
  await stubTelegramConnection(page, 'GMAIL');
  await openBuilder(page);
  await addNode(page, 'email.send');
  await expect(page.getByTestId('email-config')).toBeVisible();
  await expect(page.locator('#email-to-label')).toContainText('*');
  await expect(page.locator('#email-subject-label')).toContainText('*');
  await expect(page.locator('#email-body-label')).not.toContainText('*');
});

test('delete button names the step, not its id', async ({ page }) => {
  await stubBackend(page, [{ id: 'http_1', type: 'http.request', config: { method: 'GET', url: 'https://example.test' } }]);
  await openBuilder(page);
  await page.getByTestId('rf__node-http_1').getByTestId('workflow-node').click();
  const name = await page.getByTestId('rf__node-http_1').locator('span.font-semibold').first().innerText();
  const del = page.getByTestId('workflow-node-delete');
  await expect(del).toHaveAttribute('aria-label', new RegExp(name));
  await expect(del).not.toHaveAttribute('aria-label', /http_1/);
});

// Data menu: nearest step first, search, run values, named input, orphan chips.
const MAIL_CHAIN: StubNode[] = [
  { id: 'tgt', type: 'trigger.gmail', config: {} },
  { id: 'ai1', type: 'ai.summarize', config: {} },
  { id: 'tg1', type: 'telegram.send_message', config: { connectionId: TG_CONNECTION, chatId: '1', text: '' } },
];
const mailGraph: StubGraph = { edges: [['tgt', 'ai1'], ['ai1', 'tg1']], names: { tgt: 'Thư mới', ai1: 'Tóm tắt thư', tg1: 'Báo Telegram' } };

async function openDataMenu(page: Page, nodeId: string) {
  await page.getByTestId(`rf__node-${nodeId}`).getByTestId('workflow-node').click();
  await page.getByTestId('mapping-data-toggle').first().click();
  return page.getByTestId('mapping-data-menu');
}

test('data menu lists the nearest step first with plain labels', async ({ page }) => {
  await stubBackend(page, MAIL_CHAIN, mailGraph);
  await stubTelegramConnection(page);
  await openBuilder(page);
  const menu = await openDataMenu(page, 'tg1');
  const headings = await menu.locator('[data-testid="mapping-data-group"] > p').allInnerTexts();
  expect(headings.slice(0, 2)).toEqual(['Tóm tắt thư', 'Dữ liệu kích hoạt']);
  const items = await menu.getByTestId('mapping-data-item').allInnerTexts();
  expect(items.length).toBeGreaterThan(5);
  for (const text of items) expect(text).not.toMatch(/nodes\.|output\.|\{\{/);
});

test('search appears with more than 8 items', async ({ page }) => {
  await stubBackend(page, MAIL_CHAIN, mailGraph);
  await stubTelegramConnection(page);
  await openBuilder(page);
  const menu = await openDataMenu(page, 'tg1');
  await menu.getByLabel('Tìm dữ liệu').fill('nguoi gui');
  const items = menu.getByTestId('mapping-data-item');
  await expect(items.first()).toBeVisible();
  for (const text of await items.allInnerTexts()) expect(text.toLowerCase()).toMatch(/gửi/);
  expect(await items.count()).toBeLessThan(8);
});

test('Khác group offers time, run and workflow name', async ({ page }) => {
  await stubBackend(page, MAIL_CHAIN, mailGraph);
  await stubTelegramConnection(page);
  await openBuilder(page);
  const menu = await openDataMenu(page, 'tg1');
  const other = menu.getByTestId('mapping-data-group').filter({ has: page.getByText('Khác', { exact: true }) });
  for (const path of ['now', 'run.id', 'workflow.name']) await expect(other.locator(`[data-path="${path}"]`)).toHaveCount(1);
});

test('orphan chip turns amber and keeps the value', async ({ page }) => {
  const mapping = '{{ nodes.ai1.output.summary }}';
  const chain = MAIL_CHAIN.map((node) => (node.id === 'tg1' ? { ...node, config: { ...node.config, text: mapping } } : node));
  const saved = await stubBackend(page, chain, mailGraph);
  await stubTelegramConnection(page);
  await openBuilder(page);
  await page.getByTestId('rf__node-tg1').getByTestId('workflow-node').click();
  await expect(page.locator('#telegram-text').getByTestId('mapping-chip')).toContainText('Tóm tắt thư');
  await page.getByTestId('rf__node-ai1').getByTestId('workflow-node').click();
  await page.getByTestId('workflow-node-delete').click();
  await page.getByTestId('rf__node-tg1').getByTestId('workflow-node').click();
  await expect(page.locator('#telegram-text').getByTestId('mapping-chip')).toContainText('Dữ liệu này không còn — chọn lại');
  await page.getByTestId('workflow-save').click();
  await expect.poll(() => saved.length).toBeGreaterThan(0);
  const last = saved[saved.length - 1] as { definition: { nodes: Array<{ id: string; config: { text?: string } }> } };
  expect(last.definition.nodes.find((node) => node.id === 'tg1')?.config.text).toBe(mapping);
});

test('manual trigger offers a named input', async ({ page }) => {
  await stubBackend(page, [{ id: 'tg1', type: 'telegram.send_message', config: { connectionId: TG_CONNECTION, chatId: '1', text: '' } }]);
  await stubTelegramConnection(page);
  await openBuilder(page);
  const menu = await openDataMenu(page, 'tg1');
  await expect(menu.getByText('Dữ liệu gửi vào')).toBeVisible();
  const name = menu.getByPlaceholder('Tên trường, ví dụ ten_khach');
  const add = menu.getByTestId('mapping-data-named-add');
  await name.fill('ten khach');
  await expect(add).toBeDisabled();
  await name.fill('ten_khach');
  await add.click();
  await expect(page.locator('#telegram-text').getByTestId('mapping-chip')).toHaveAttribute('data-mapping', '{{ trigger.input.ten_khach }}');
});
