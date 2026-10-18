import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  await expect(section.locator('summary')).toHaveText('Thêm tùy chọn (6)');
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
  await expect(page.getByRole('textbox', { name: /^URL/ })).toBeVisible();
  await page.getByRole('textbox', { name: /^URL/ }).click();
  await page.keyboard.type('https://example.test');
  await expect(page.locator('#http-url')).toContainText('https://example.test');
  await addNode(page, 'telegram.send_message');
  await expect(page.getByRole('textbox', { name: 'Nội dung tin nhắn', exact: true })).toBeVisible();
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
  await expect(page.getByRole('textbox', { name: 'Cuộc trò chuyện khác', exact: true })).toHaveAttribute('id', 'telegram-chat-id');
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
  await expect(page.getByRole('textbox', { name: 'Địa chỉ người nhận', exact: true })).toHaveAttribute('id', 'email-to');
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
  await expect(page.getByText(/Bước 'Gọi dịch vụ web'/).first()).toBeVisible();
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

async function openDataMenu(page: Page, nodeId: string, fieldId?: string) {
  await page.getByTestId(`rf__node-${nodeId}`).getByTestId('workflow-node').click();
  // Every data field has its own button: name the field when the step has more than one.
  const toggle = fieldId ? page.locator(`#${fieldId}`).locator('xpath=ancestor::*[.//*[@data-testid="mapping-data-toggle"]][1]').getByTestId('mapping-data-toggle') : page.getByTestId('mapping-data-toggle').first();
  await toggle.click();
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
  const menu = await openDataMenu(page, 'tg1', 'telegram-text');
  await expect(menu.getByText('Dữ liệu gửi vào')).toBeVisible();
  const name = menu.getByPlaceholder('Tên trường, ví dụ ten_khach');
  const add = menu.getByTestId('mapping-data-named-add');
  await name.fill('ten khach');
  await expect(add).toBeDisabled();
  await expect(menu.getByRole('alert')).toContainText('khoảng trắng');
  await name.fill('ten_khach');
  await add.click();
  await expect(page.locator('#telegram-text').getByTestId('mapping-chip')).toHaveAttribute('data-mapping', '{{ trigger.input.ten_khach }}');
});

test('orphan chip after the link to its step is removed keeps the value', async ({ page }) => {
  const mapping = '{{ nodes.ai1.output.summary }}';
  const chain = MAIL_CHAIN.map((node) => (node.id === 'tg1' ? { ...node, config: { ...node.config, text: mapping } } : node));
  const saved = await stubBackend(page, chain, mailGraph);
  await stubTelegramConnection(page);
  await openBuilder(page);
  await page.getByTestId('rf__node-tg1').getByTestId('workflow-node').click();
  await expect(page.locator('#telegram-text').getByTestId('mapping-chip')).toContainText('Tóm tắt thư');
  // The step stays on the canvas; only its link into the Telegram step goes, so it is no longer before it.
  await page.getByTestId('rf__edge-g1').locator('.react-flow__edge-interaction').dispatchEvent('click');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('rf__edge-g1')).toHaveCount(0);
  await expect(page.getByTestId('rf__node-ai1')).toBeVisible();
  await page.getByTestId('rf__node-tg1').getByTestId('workflow-node').click();
  await expect(page.locator('#telegram-text').getByTestId('mapping-chip')).toContainText('Dữ liệu này không còn — chọn lại');
  await page.getByTestId('workflow-save').click();
  await expect.poll(() => saved.length).toBeGreaterThan(0);
  const last = saved[saved.length - 1] as { definition: { nodes: Array<{ id: string; config: { text?: string } }>; edges: Array<{ id: string }> } };
  expect(last.definition.edges.map((edge) => edge.id)).not.toContain('g1');
  expect(last.definition.nodes.find((node) => node.id === 'tg1')?.config.text).toBe(mapping);
});

// A data field's own "+ Dữ liệu" button sits in its FieldShell (the div that holds the field's label).
const dataToggles = (page: Page, fieldId: string) => page.locator(`div:has(> #${fieldId}-label)`).getByTestId('mapping-data-toggle');

test('every data field has its own + Dữ liệu button', async ({ page }) => {
  await stubBackend(page, [
    { id: 'http_1', type: 'http.request', config: { url: 'https://example.test', method: 'POST' } },
    { id: 'sheet_1', type: 'google.sheets', config: { operation: 'append', spreadsheetId: 'abc', range: 'A1', values: [['x', 'y']] } },
    { id: 'mail_1', type: 'email.send', config: { to: 'a@example.test', subject: 's', body: 'b' } },
  ], { edges: [['manual', 'http_1'], ['http_1', 'sheet_1'], ['sheet_1', 'mail_1']] });
  await openBuilder(page);
  const fieldsByNode: Record<string, string[]> = {
    http_1: ['http-url', 'http-body'],
    sheet_1: ['google-spreadsheet-id', 'google-range', 'google-cell-0-0', 'google-cell-0-1'],
    mail_1: ['email-to', 'email-subject', 'email-body'],
  };
  for (const [nodeId, ids] of Object.entries(fieldsByNode)) {
    await page.getByTestId(`rf__node-${nodeId}`).getByTestId('workflow-node').click();
    for (const id of ids) {
      if (id.startsWith('google-cell')) await expect(page.locator(`#${id}`).locator('xpath=../..').getByTestId('mapping-data-toggle')).toHaveCount(1);
      else await expect(dataToggles(page, id)).toHaveCount(1);
    }
    await expect(page.getByTestId('variable-picker')).toHaveCount(0);
    await expect(page.getByTestId('variable-picker-toggle')).toHaveCount(0);
  }
});

test('mapping in a number field round-trips', async ({ page }) => {
  const mapping = '{{ nodes.a.output.n }}';
  const saved = await stubBackend(page, [
    { id: 'a', type: 'http.request', config: { url: 'https://example.test' } },
    { id: 'fd1', type: 'format.datetime', config: { operation: 'add', value: '2026-01-01', amount: mapping, unit: 'days' } },
  ], { edges: [['manual', 'a'], ['a', 'fd1']] });
  await openBuilder(page);
  await page.getByTestId('rf__node-fd1').getByTestId('workflow-node').click();
  await expect(page.getByLabel('Dùng dữ liệu từ bước trước')).toBeChecked();
  await expect(page.locator('#field-format-datetime-amount').getByTestId('mapping-chip')).toHaveCount(1);
  await expect(page.getByText('Nhập số nguyên', { exact: false })).toHaveCount(0);
  await page.getByTestId('workflow-save').click();
  await expect.poll(() => saved.length).toBeGreaterThan(0);
  const last = saved[saved.length - 1] as { definition: { nodes: Array<{ id: string; config: { amount?: unknown } }> } };
  expect(last.definition.nodes.find((node) => node.id === 'fd1')?.config.amount).toBe(mapping);
});

test('ticking use-data over a typed number gives a data field', async ({ page }) => {
  const saved = await stubBackend(page, [
    { id: 'a', type: 'http.request', config: { url: 'https://example.test' } },
    { id: 'fd1', type: 'format.datetime', config: { operation: 'add', value: '2026-01-01', amount: 5, unit: 'days' } },
  ], { edges: [['manual', 'a'], ['a', 'fd1']] });
  await openBuilder(page);
  await page.getByTestId('rf__node-fd1').getByTestId('workflow-node').click();
  await page.getByTestId('field-amount-use-data').check();
  await expect(dataToggles(page, 'field-format-datetime-amount')).toHaveCount(1);
  // The typed 5 is gone, so inserting data gives exactly the mapping, never `5{{ ... }}`.
  await dataToggles(page, 'field-format-datetime-amount').click();
  await page.getByTestId('mapping-data-item').first().click();
  await page.getByTestId('workflow-save').click();
  await expect.poll(() => saved.length).toBeGreaterThan(0);
  const last = saved[saved.length - 1] as { definition: { nodes: Array<{ id: string; config: { amount?: unknown } }> } };
  expect(last.definition.nodes.find((node) => node.id === 'fd1')?.config.amount).toMatch(/^\{\{ nodes\.a\.output\.[\w.[\]]+ \}\}$/);
});

test('removing the chip of a number data field keeps the data field', async ({ page }) => {
  await stubBackend(page, [
    { id: 'a', type: 'http.request', config: { url: 'https://example.test' } },
    { id: 'fd1', type: 'format.datetime', config: { operation: 'add', value: '2026-01-01', amount: '{{ nodes.a.output.status }}', unit: 'days' } },
  ], { edges: [['manual', 'a'], ['a', 'fd1']] });
  await openBuilder(page);
  await page.getByTestId('rf__node-fd1').getByTestId('workflow-node').click();
  const field = page.locator('#field-format-datetime-amount');
  await field.getByRole('button', { name: /Bỏ dữ liệu này/ }).click();
  await expect(field.getByTestId('mapping-chip')).toHaveCount(0);
  await expect(page.getByTestId('field-amount-use-data')).toBeChecked();
  await expect(dataToggles(page, 'field-format-datetime-amount')).toHaveCount(1);
});

test('a path deeper than a listed one is not reported as gone', async ({ page }) => {
  await stubBackend(page, [
    { id: 'http_1', type: 'http.request', config: { url: 'https://example.test' } },
    { id: 'tg1', type: 'telegram.send_message', config: { connectionId: TG_CONNECTION, chatId: '1', text: '{{ nodes.http_1.output.data.name }}' } },
  ], { edges: [['manual', 'http_1'], ['http_1', 'tg1']] });
  await stubTelegramConnection(page);
  await openBuilder(page);
  await page.getByTestId('rf__node-tg1').getByTestId('workflow-node').click();
  const chip = page.locator('#telegram-text').getByTestId('mapping-chip');
  await expect(chip).toHaveCount(1);
  await expect(chip).not.toContainText('không còn');
  await expect(chip).not.toContainText('data.name');
  await expect(chip).toContainText('Name');
});

test('the data button names its field and a search without a match says so', async ({ page }) => {
  await stubBackend(page, MAIL_CHAIN, mailGraph);
  await stubTelegramConnection(page);
  await openBuilder(page);
  const menu = await openDataMenu(page, 'tg1', 'telegram-text');
  await expect(page.getByRole('button', { name: /^Chèn dữ liệu vào .+/ })).toHaveCount(await page.getByTestId('mapping-data-toggle').count());
  await menu.getByLabel('Tìm dữ liệu').fill('zzzzqq');
  await expect(menu.getByText('Không tìm thấy dữ liệu')).toBeVisible();
});

test('typing a comma list over a stored list saves a list', async ({ page }) => {
  const saved = await stubBackend(page, [{ id: 'mail_1', type: 'email.send', config: { to: 'x@example.test', subject: 's', body: 'b', cc: ['y@example.test'] } }], { edges: [['manual', 'mail_1']] });
  await openBuilder(page);
  await page.getByTestId('rf__node-mail_1').getByTestId('workflow-node').click();
  await page.getByTestId('field-cc').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('a@example.test, b@example.test');
  await page.getByTestId('workflow-save').click();
  await expect.poll(() => saved.length).toBeGreaterThan(0);
  const last = saved[saved.length - 1] as { definition: { nodes: Array<{ id: string; config: { cc?: unknown } }> } };
  expect(last.definition.nodes.find((node) => node.id === 'mail_1')?.config.cc).toEqual(['a@example.test', 'b@example.test']);
});

type CatalogModule = {
  NODE_CATALOG: Array<{ type: string; outputs: Array<{ name: string }> }>;
  OUTPUTS_BY_OPERATION: Record<string, Record<string, string[]>>;
};
// nodeCatalog.ts is bundler-style source, so tsc -b (node16 e2e project) cannot import it: load it from the dev server in the page.
const loadCatalog = (page: Page): Promise<CatalogModule> =>
  page.evaluate((url) => import(/* @vite-ignore */ url) as Promise<CatalogModule>, '/src/lib/constants/nodeCatalog.ts');

test('every output path has a vi and en label', async ({ page }) => {
  await stubBackend(page);
  await openBuilder(page);
  const { NODE_CATALOG, OUTPUTS_BY_OPERATION } = await loadCatalog(page);
  const { TRANSLATIONS } = await import('../src/lib/i18n/translations.js');
  const wanted = new Set<string>();
  for (const item of NODE_CATALOG) for (const output of item.outputs) wanted.add(`builder.var.path.${item.type}.${output.name}`);
  for (const [type, operations] of Object.entries(OUTPUTS_BY_OPERATION)) {
    for (const paths of Object.values(operations)) for (const path of paths) wanted.add(`builder.var.path.${type}.${path}`);
  }
  const missing = [...wanted].flatMap((key) => (['VI', 'EN'] as const).filter((lang) => !TRANSLATIONS[lang][key]).map((lang) => `${lang} ${key}`));
  expect(missing).toEqual([]);
  // Plain words for non-technical users: no jargon, at most four words.
  const jargon = /\b(ID|JSON|cron|payload|node|config)\b/i;
  const bad = [...wanted].flatMap((key) => (['VI', 'EN'] as const).map((lang) => ({ key: `${lang} ${key}`, text: TRANSLATIONS[lang][key] ?? '' })))
    .filter(({ text }) => jargon.test(text) || text.trim().split(/\s+/).length > 4)
    .map(({ key, text }) => `${key}: ${text}`);
  expect(bad).toEqual([]);
  // Non-catalog keys (for example webhook bank fields) are shown in the data menu too: same banned words.
  const existing = (['VI', 'EN'] as const).flatMap((lang) => Object.entries(TRANSLATIONS[lang])
    .filter(([key, text]) => key.startsWith('builder.var.path.') && jargon.test(text))
    .map(([key, text]) => `${lang} ${key}: ${text}`));
  expect(existing).toEqual([]);
});

const LEAK = /\bbuilder\.[a-z_]+\./;

// The builder has no language control, so a pass picks its language from sessionStorage and reloads.
async function useLanguageSwitch(page: Page) {
  await page.addInitScript(() => {
    const lang = sessionStorage.getItem('test_lang');
    if (lang) localStorage.setItem('weav_lang_v1', lang);
  });
}
async function switchLanguage(page: Page, code: 'VI' | 'EN') {
  await page.evaluate((lang) => sessionStorage.setItem('test_lang', lang), code);
  await page.reload();
  await expect(page.getByTestId('workflow-title')).toHaveValue('Simple nodes');
}

test('no builder. keys leak in either language, and the same step switches language', async ({ page }) => {
  test.setTimeout(240_000);
  await stubBackend(page, MAIL_CHAIN, mailGraph);
  await stubTelegramConnection(page);
  await useLanguageSwitch(page);
  await openBuilder(page);
  const inspector = page.getByTestId('workflow-inspector');
  const texts: string[] = [];
  for (const code of ['VI', 'EN'] as const) {
    await switchLanguage(page, code);
    const menu = await openDataMenu(page, 'tg1');
    await expect(menu).toBeVisible();
    expect((await menu.innerText()).match(LEAK), `data menu ${code}`).toBeNull();
    await page.keyboard.press('Escape');
    texts.push(await inspector.innerText());
    expect(texts.at(-1)!.match(LEAK), `tg1 ${code}`).toBeNull();
  }
  expect(texts[0]).not.toEqual(texts[1]);
  expect(texts[0]).toContain('Nội dung');
  expect(texts[1]).toContain('Message');
});

test('no builder. keys leak for any node type or operation', async ({ page }) => {
  test.setTimeout(300_000);
  await stubBackend(page);
  await openBuilder(page);
  const { NODE_CATALOG, OUTPUTS_BY_OPERATION } = await loadCatalog(page);
  const inspector = page.getByTestId('workflow-inspector');
  // Every type through the palette, then the operation-dependent steps with each operation as a saved step.
  const operational: StubNode[] = Object.entries(OUTPUTS_BY_OPERATION).flatMap(([type, operations]) =>
    Object.keys(operations).map((operation) => ({ id: `op_${type.replace(/\W/g, '_')}_${operation}`, type, config: { operation } })));
  await stubBackend(page, operational, { names: Object.fromEntries(operational.map((node) => [node.id, `Step ${node.id}`])) });
  await useLanguageSwitch(page);
  await openBuilder(page);
  for (const code of ['EN', 'VI'] as const) {
    await switchLanguage(page, code);
    for (const { type } of NODE_CATALOG) {
      await addNode(page, type);
      await expect(inspector).toBeVisible();
      expect((await inspector.innerText()).match(LEAK), `${type} ${code}`).toBeNull();
    }
    for (const node of operational) {
      await page.getByTestId(`rf__node-${node.id}`).getByTestId('workflow-node').dispatchEvent('click');
      // The inspector must now show THIS step (unique name), so a missed click cannot re-scan stale text.
      await expect(inspector.getByText(`Step ${node.id}`, { exact: true })).toBeVisible();
      await expect(inspector).toBeVisible();
      expect((await inspector.innerText()).match(LEAK), `${node.id} ${code}`).toBeNull();
    }
  }
});

// Wording pass: the shared check for a step's inspector (Task 8 triggers/messaging, reused by Task 9).
const JARGON = /\b(ID|JSON|cron|payload|node|config)\b/i;

type InspectedField = { label: string; hint: string; control: 'select' | 'checkbox' | 'text' | 'none'; placeholder: string };

// The e2e project is type-checked without the DOM lib, so the page-side code sees only this shape.
type DomNode = {
  id: string; tagName: string; textContent: string | null;
  querySelectorAll(selector: string): DomNode[];
  closest(selector: string): DomNode | null;
  getAttribute(name: string): string | null;
  ownerDocument: { getElementById(id: string): DomNode | null };
};

// Composite editors (a row of conditions, the rows of cells) label their parts themselves; only their label text is checked.
const COMPOSITE = '[data-testid="condition-config"], [data-testid="google-row-editor"]';

/** Every field the open inspector renders through FieldShell or as a SchemaField checkbox, plus every label/legend text. */
async function inspectFields(page: Page): Promise<{ fields: InspectedField[]; labels: string[] }> {
  return page.getByTestId('workflow-inspector').evaluate((element, composite) => {
    const root = element as unknown as DomNode;
    const doc = root.ownerDocument;
    const clean = (text: string | null | undefined) => (text ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    const fields: InspectedField[] = [];
    for (const label of Array.from(root.querySelectorAll('label[id$="-label"]'))) {
      if (label.closest(composite)) continue;
      const base = label.id.replace(/-label$/, '');
      const control = doc.getElementById(base);
      fields.push({
        label: clean(label.textContent),
        hint: clean(doc.getElementById(`${base}-hint`)?.textContent),
        control: !control ? 'none' : control.tagName === 'SELECT' ? 'select' : 'text',
        placeholder: control?.getAttribute('placeholder') ?? control?.getAttribute('data-placeholder') ?? '',
      });
    }
    for (const box of Array.from(root.querySelectorAll('input[type="checkbox"][id]'))) {
      fields.push({ label: clean(box.closest('label')?.textContent), hint: clean(doc.getElementById(`${box.id}-hint`)?.textContent), control: 'checkbox', placeholder: '' });
    }
    const labels = Array.from(root.querySelectorAll('label, legend'))
      .filter((node) => !node.closest('[data-testid="inspector-technical"]'))
      .map((node) => clean(node.textContent));
    return { fields, labels };
  }, COMPOSITE);
}

/** Plain wording of the selected step: short jargon-free labels, a hint under each, and an "Ví dụ:" placeholder in every text box.
 *  Returns what is wrong (it asserts nothing itself). `minFields` makes a step whose fields are silently skipped (a label with no control) fail. */
async function collectWordingProblems(page: Page, stepName: string, nodeId: string, minFields: number) {
  await page.getByTestId(`rf__node-${nodeId}`).getByTestId('workflow-node').dispatchEvent('click');
  await expect(page.getByTestId('workflow-inspector').getByText(stepName, { exact: true })).toBeVisible();
  const { fields, labels } = await inspectFields(page);
  const problems: string[] = [];
  if (fields.length < minFields) problems.push(`${stepName}: only ${fields.length} fields inspected, expected at least ${minFields}`);
  for (const field of fields) {
    const name = `${stepName} / ${field.label || '(no label)'}`;
    if (!field.label) problems.push(`${name}: empty label`);
    if (JARGON.test(field.label)) problems.push(`${name}: jargon in label`);
    if (field.label.split(/\s+/).length > 4) problems.push(`${name}: label longer than four words`);
    if (!field.hint) problems.push(`${name}: no hint`);
    if (field.control === 'none') problems.push(`${name}: no control with the label's id`);
    if (field.control === 'text' && !field.placeholder.startsWith('Ví dụ:')) problems.push(`${name}: placeholder is "${field.placeholder}"`);
  }
  for (const label of labels) if (JARGON.test(label)) problems.push(`${stepName} / ${label}: jargon in a label`);
  return problems;
}

test('wording: triggers and messaging', async ({ page }) => {
  test.setTimeout(240_000);
  const steps: StubNode[] = [
    { id: 'sched', type: 'trigger.schedule', config: { cron: '0 0 9 * * *', timezone: 'Asia/Ho_Chi_Minh' } },
    { id: 'sched_adv', type: 'trigger.schedule', config: { cron: '0 0 0 L * ?', timezone: 'Asia/Ho_Chi_Minh' } },
    { id: 'hook', type: 'trigger.webhook', config: {} },
    { id: 'tgt', type: 'trigger.telegram', config: {} },
    { id: 'gm', type: 'trigger.gmail', config: {} },
    { id: 'wfe', type: 'trigger.workflow_event', config: { events: ['FAILED'] } },
    { id: 'mail', type: 'email.send', config: {} },
    { id: 'tg1', type: 'telegram.send_message', config: {} },
    { id: 'dc', type: 'discord.send_message', config: {} },
    { id: 'sl', type: 'slack.send_message', config: {} },
    { id: 'tm', type: 'teams.send_message', config: {} },
    { id: 'http_1', type: 'http.request', config: { method: 'POST' } },
    { id: 'wf_cmd', type: 'weav.workflow', config: { operation: 'command' } },
    { id: 'wf_run', type: 'weav.workflow', config: { operation: 'run' } },
    { id: 'wf_fail', type: 'weav.workflow', config: { operation: 'list_failures' } },
  ];
  const names = Object.fromEntries(steps.map((step) => [step.id, `Step ${step.id}`]));
  await stubBackend(page, steps, { edges: [['gm', 'mail'], ['tgt', 'tg1']], names });
  await stubTelegramConnection(page);
  await openBuilder(page);
  // Fields each step must render through FieldShell (steps with their own inspector render none); a skipped field fails the count.
  const minFields: Record<string, number> = { sched: 0, sched_adv: 0, hook: 0, tgt: 1, gm: 3, wfe: 0, mail: 11, tg1: 7, dc: 3, sl: 2, tm: 3, http_1: 4, wf_cmd: 2, wf_run: 0, wf_fail: 1 };
  const problems = [...await collectWordingProblems(page, 'Manual trigger', 'manual', 1)];
  for (const { id } of steps) problems.push(...await collectWordingProblems(page, `Step ${id}`, id, minFields[id]));
  expect(problems).toEqual([]);
});

// The fields a schema flags with x-weav-ui.advanced, read from the same JSON file the app and the backend load.
const NODES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/workflow-schema/nodes');
const flaggedFields = (type: string): string[] => {
  const schema = JSON.parse(readFileSync(resolve(NODES_DIR, `${type}.json`), 'utf8')) as { properties: Record<string, { 'x-weav-ui'?: { advanced?: boolean } }> };
  return Object.entries(schema.properties).filter(([, property]) => property['x-weav-ui']?.advanced).map(([name]) => name);
};

test('flagged fields of triggers and messaging sit under Thêm tùy chọn', async ({ page }) => {
  test.setTimeout(120_000);
  // [step type, section test id, test id of each flagged field inside the section]
  const cases: Array<[string, string, (name: string) => string]> = [
    ['email.send', 'email-advanced', (name) => (name === 'attachments' ? 'attachment-add' : `field-${name}`)],
    ['telegram.send_message', 'telegram-advanced', (name) => `field-${name}`],
    ['http.request', 'http-advanced', (name) => (name === 'headers' || name === 'query' ? `http-${name}` : `field-${name}`)],
    ['trigger.gmail', 'schema-advanced', (name) => `field-${name}`],
    ['discord.send_message', 'schema-advanced', (name) => `field-${name}`],
    ['teams.send_message', 'schema-advanced', (name) => `field-${name}`],
  ];
  const nodes: StubNode[] = cases.map(([type], index) => ({ id: `n${index}`, type, config: {} }));
  await stubBackend(page, nodes, { names: Object.fromEntries(nodes.map((node) => [node.id, `Step ${node.id}`])) });
  await stubTelegramConnection(page);
  await openBuilder(page);
  for (const [index, [type, sectionId, testIdFor]] of cases.entries()) {
    await page.getByTestId(`rf__node-n${index}`).getByTestId('workflow-node').dispatchEvent('click');
    await expect(page.getByTestId('workflow-inspector').getByText(`Step n${index}`, { exact: true })).toBeVisible();
    const flagged = flaggedFields(type);
    expect(flagged.length, type).toBeGreaterThan(0);
    const section = page.getByTestId(sectionId);
    await expect(section.locator('summary'), type).toContainText(`Thêm tùy chọn (${flagged.length})`);
    for (const name of flagged) await expect(section.getByTestId(testIdFor(name)), `${type}.${name}`).toHaveCount(1);
  }
});

test('wording: google, logic, ai, ocr', async ({ page }) => {
  test.setTimeout(300_000);
  // [step, minimum FieldShell fields (steps with their own editor render none)]
  const steps: Array<[StubNode, number]> = [
    [{ id: 'sh_read', type: 'google.sheets', config: { operation: 'read' } }, 4],
    [{ id: 'sh_add', type: 'google.sheets', config: { operation: 'append' } }, 5],
    [{ id: 'sh_find', type: 'google.sheets', config: { operation: 'lookup' } }, 7],
    [{ id: 'dr_up', type: 'google.drive', config: { operation: 'upload' } }, 7],
    [{ id: 'dr_list', type: 'google.drive', config: { operation: 'list' } }, 5],
    [{ id: 'dr_get', type: 'google.drive', config: { operation: 'download' } }, 3],
    [{ id: 'cal_new', type: 'google.calendar', config: { operation: 'create' } }, 11],
    [{ id: 'cal_list', type: 'google.calendar', config: { operation: 'list' } }, 7],
    [{ id: 'if_one', type: 'logic.condition', config: { left: '', operator: 'eq', right: '' } }, 0],
    [{ id: 'if_many', type: 'logic.condition', config: { combinator: 'and', conditions: [{ left: '', operator: 'eq', right: '' }] } }, 0],
    [{ id: 'sw', type: 'logic.switch', config: { cases: ['a'] } }, 1],
    [{ id: 'set', type: 'data.set', config: { fields: { ten: 'An' } } }, 0],
    [{ id: 'dt_now', type: 'format.datetime', config: { operation: 'now' } }, 2],
    [{ id: 'dt_add', type: 'format.datetime', config: { operation: 'add' } }, 5],
    [{ id: 'dt_fmt', type: 'format.datetime', config: { operation: 'format' } }, 5],
    [{ id: 'dt_conv', type: 'format.datetime', config: { operation: 'convert' } }, 3],
    [{ id: 'tx_up', type: 'format.text', config: { operation: 'upper' } }, 2],
    [{ id: 'tx_rep', type: 'format.text', config: { operation: 'replace' } }, 4],
    [{ id: 'tx_split', type: 'format.text', config: { operation: 'split' } }, 3],
    [{ id: 'tx_num', type: 'format.text', config: { operation: 'number_format' } }, 4],
    [{ id: 'ai_ext', type: 'ai.extract', config: {} }, 2],
    [{ id: 'ai_cls', type: 'ai.classify', config: {} }, 2],
    [{ id: 'ai_sum', type: 'ai.summarize', config: {} }, 2],
    [{ id: 'ai_gen', type: 'ai.generate', config: {} }, 3],
    [{ id: 'ocr_url', type: 'ocr.extract', config: { fileUrl: 'https://example.test/a.pdf' } }, 3],
    [{ id: 'ocr_art', type: 'ocr.extract', config: { artifactId: 'art-1' } }, 3],
    [{ id: 'ocr_file', type: 'ocr.extract', config: { file: '{{ trigger.input.file }}' } }, 3],
  ];
  const nodes: StubNode[] = [{ id: 'tgt', type: 'trigger.telegram', config: {} }, ...steps.map(([node]) => node)];
  const names = Object.fromEntries(nodes.map((step) => [step.id, `Step ${step.id}`]));
  // The Telegram trigger hands a file to the OCR step, so its file picker has options.
  await stubBackend(page, nodes, { edges: [['tgt', 'ocr_file']], names });
  await openBuilder(page);
  const problems: string[] = [];
  for (const [step, minFields] of steps) problems.push(...await collectWordingProblems(page, `Step ${step.id}`, step.id, minFields));
  expect(problems).toEqual([]);
});

test('Calendar create shows at most four fields before Thêm tùy chọn', async ({ page }) => {
  await stubBackend(page, [{ id: 'cal', type: 'google.calendar', config: { operation: 'create' } }], { names: { cal: 'Step cal' } });
  await openBuilder(page);
  await page.getByTestId('rf__node-cal').getByTestId('workflow-node').dispatchEvent('click');
  await expect(page.getByTestId('workflow-inspector').getByText('Step cal', { exact: true })).toBeVisible();
  // Labelled fields outside the advanced section, without the account picker.
  const visible = await page.getByTestId('schema-config').evaluate((element) => {
    const root = element as unknown as DomNode;
    return Array.from(root.querySelectorAll('label[id$="-label"]'))
      .filter((label) => !label.closest('[data-testid="schema-advanced"]') && !label.id.includes('connectionId'))
      .map((label) => (label.textContent ?? '').replace(/\*/g, '').trim());
  });
  expect(visible.length).toBeLessThanOrEqual(4);
  expect(visible).toEqual(['Thao tác', 'Tiêu đề', 'Bắt đầu', 'Kết thúc']);
  await expect(page.getByTestId('schema-advanced').locator('summary')).toContainText('Thêm tùy chọn (6)');
});

test('flagged fields of google, logic, AI and OCR sit under Thêm tùy chọn', async ({ page }) => {
  test.setTimeout(180_000);
  // [step type, config, section test id, flagged fields shown for this config, locator of one field inside the section]
  type Section = ReturnType<Page['getByTestId']>;
  type Place = (section: Section, name: string) => ReturnType<Section['locator']>;
  const byTestId: Place = (section, name) => section.getByTestId(`field-${name}`);
  const cases: Array<[string, Record<string, unknown>, string, string[], Place]> = [
    ['google.sheets', { operation: 'lookup' }, 'sheets-advanced', ['limit'], byTestId],
    ['google.sheets', { operation: 'append' }, 'sheets-advanced', ['valueInputOption'], byTestId],
    ['google.drive', { operation: 'upload' }, 'schema-advanced', ['mimeType', 'folderId'], byTestId],
    ['google.drive', { operation: 'list' }, 'schema-advanced', ['folderId', 'pageSize'], byTestId],
    ['google.calendar', { operation: 'create' }, 'schema-advanced', ['calendarId', 'timeZone', 'description', 'location', 'attendees', 'sendInvitations'], byTestId],
    ['google.calendar', { operation: 'list' }, 'schema-advanced', ['calendarId', 'maxResults', 'query'], byTestId],
    ['format.datetime', { operation: 'format' }, 'schema-advanced', ['locale'], byTestId],
    ['format.text', { operation: 'number_format' }, 'schema-advanced', ['decimals', 'locale'], byTestId],
    ['format.text', { operation: 'split' }, 'schema-advanced', ['separator'], byTestId],
    ['ai.extract', {}, 'ai-advanced', ['instructions'], byTestId],
    ['ai.summarize', {}, 'ai-advanced', ['maxLength'], byTestId],
    ['ai.generate', {}, 'schema-advanced', ['instructions', 'maxLength'], byTestId],
    ['ocr.extract', { fileUrl: 'https://example.test/a.pdf' }, 'ocr-advanced', ['language', 'detectTables'], (section, name) => (name === 'language' ? section.locator('#ocr-language') : section.getByTestId('ocr-detect-tables'))],
  ];
  const nodes: StubNode[] = cases.map(([type, config], index) => ({ id: `n${index}`, type, config }));
  await stubBackend(page, nodes, { names: Object.fromEntries(nodes.map((node) => [node.id, `Step ${node.id}`])) });
  await openBuilder(page);
  const covered = new Map<string, Set<string>>();
  for (const [index, [type, , sectionId, shown, place]] of cases.entries()) {
    await page.getByTestId(`rf__node-n${index}`).getByTestId('workflow-node').dispatchEvent('click');
    await expect(page.getByTestId('workflow-inspector').getByText(`Step n${index}`, { exact: true })).toBeVisible();
    const flagged = flaggedFields(type);
    const section = page.getByTestId(sectionId);
    await expect(section.locator('summary'), `${type} ${index}`).toContainText(`Thêm tùy chọn (${shown.length})`);
    for (const name of shown) {
      expect(flagged, `${type}.${name} is flagged in the schema`).toContain(name);
      await expect(place(section, name), `${type}.${name}`).toHaveCount(1);
      covered.set(type, (covered.get(type) ?? new Set()).add(name));
    }
  }
  // No flag in a schema goes untested.
  for (const type of new Set(cases.map(([caseType]) => caseType))) expect([...(covered.get(type) ?? [])].sort(), type).toEqual([...flaggedFields(type)].sort());
});

test('palette search finds a step by its type, its name or its description', async ({ page }) => {
  await stubBackend(page);
  await openBuilder(page);
  await page.getByTestId('workflow-add-step').click();
  const search = page.getByRole('dialog').getByRole('textbox');
  const items = page.getByTestId('workflow-palette-item');
  await search.fill('http');
  await expect(items.filter({ hasText: 'Gọi dịch vụ web' })).toHaveCount(1);
  await search.fill('ocr');
  await expect(page.locator('[data-testid="workflow-palette-item"][data-node-type="ocr.extract"]')).toHaveCount(1);
  await search.fill('SWITCH');
  await expect(page.locator('[data-testid="workflow-palette-item"][data-node-type="logic.switch"]')).toHaveCount(1);
  await search.fill('zzzz-no-step');
  await expect(items).toHaveCount(0);
});

// Visible node, blocker, error and message texts stay in plain words and never show raw data syntax.
test('node, blocker, error and message texts have no raw syntax or jargon', async () => {
  const { TRANSLATIONS } = await import('../src/lib/i18n/translations.js');
  const banned = /\b(JSON|cron|payload|node)\b/i;
  // Allowlist: a key whose banned word is legitimate (product name), with a comment saying why. None needed today.
  const allowed = new Set<string>([]);
  const bad: string[] = [];
  for (const lang of ['VI', 'EN'] as const) {
    for (const [key, text] of Object.entries(TRANSLATIONS[lang])) {
      const checked = /^builder\.(node|blocker|err)\./.test(key) || key.startsWith('builder.cfg.msg_');
      if (!checked || allowed.has(key)) continue;
      const isName = key.startsWith('builder.node.') && !key.endsWith('_desc');
      if (text.includes('{{') || banned.test(text) || (isName && /\bID\b/.test(text))) bad.push(`${lang} ${key}: ${text}`);
    }
  }
  expect(bad).toEqual([]);
});

// Task 11: the whole first-time path, and the live-check polish.
test('first-time user: new Gmail -> Telegram without typing {{', async ({ page }) => {
  const GMAIL_CONNECTION = '20000000-0000-4000-8000-000000000004';
  const connection = (id: string, provider: string, name: string) => ({
    id, workspaceId, createdBy: '00000000-0000-4000-8000-000000000010', name, provider, authType: provider === 'GMAIL' ? 'OAUTH2' : 'API_KEY',
    status: 'ACTIVE', config: null, hasCredential: true, credentialExpiresAt: null, lastVerifiedAt: null, canManage: true, canAttach: true,
    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
  });
  const savedDrafts = await stubBackend(page);
  await page.route(`**/api/v1/workspaces/${workspaceId}/connections**`, (route) =>
    json(route, [connection(GMAIL_CONNECTION, 'GMAIL', 'Gmail của tôi'), connection(TG_CONNECTION, 'TELEGRAM', 'Bot của tôi')]));
  // A blank workflow: no steps yet.
  await page.route(base, (route) => json(route, { ...draft(), definition: { schemaVersion: '1.0', nodes: [], edges: [], variables: {} }, editorState: { nodes: {} } }));
  const published: unknown[] = [];
  await page.route(`${base}/publish`, (route) => {
    published.push(route.request().postDataJSON());
    return json(route, { workflow: { ...draft(), status: 'PUBLISHED' }, webhooks: [] });
  });
  await openBuilder(page);

  await addNode(page, 'trigger.gmail');
  await page.getByTestId('field-connectionId').selectOption(GMAIL_CONNECTION);
  await addNode(page, 'telegram.send_message');
  await page.getByTestId('field-connectionId').selectOption(TG_CONNECTION);

  const chat = page.locator('#telegram-chat-id');
  await chat.click();
  await page.keyboard.type('123456789');
  const text = page.locator('#telegram-text');
  await text.click();
  await page.keyboard.type('Thư mới: ');
  for (const label of ['Tiêu đề thư', 'Người gửi']) {
    await page.locator('#telegram-text').locator('xpath=ancestor::*[.//*[@data-testid="mapping-data-toggle"]][1]').getByTestId('mapping-data-toggle').click();
    await page.getByTestId('mapping-data-menu').getByRole('menuitem', { name: label, exact: true }).click();
  }
  await expect(page.getByTestId('mapping-chip')).toHaveCount(2);
  await expect(page.getByTestId('integration-readiness')).toHaveCount(0);

  await expect(page.getByTestId('workflow-publish')).toBeEnabled();
  await page.getByTestId('workflow-publish').click();
  await expect.poll(() => savedDrafts.length).toBeGreaterThan(0);
  const body = JSON.stringify(savedDrafts[savedDrafts.length - 1]);
  expect(body).toMatch(/\{\{ trigger\.input\.subject \}\}/);
  expect(body).toMatch(/\{\{ trigger\.input\.from \}\}/);
  expect(published.length).toBe(1);
});

test('publish blockers name the step, never its id', async ({ page }) => {
  const nodes = [{ id: 'summarize_1', type: 'ai.summarize', config: {} }];
  await stubBackend(page, nodes, { edges: [['manual', 'summarize_1']] });
  await page.route(base, (route) => json(route, { ...draft(nodes, { edges: [['manual', 'summarize_1']] }), editorState: { nodes: { manual: { name: 'Manual trigger', position: { x: 100, y: 120 } } } } }));
  await openBuilder(page);
  await expect(page.getByTestId('publish-blocker-summary')).toContainText("Bước 'Tóm tắt bằng AI'");
  await expect(page.getByTestId('publish-blocker-summary')).not.toContainText('summarize_1');
});

test('the data button name has no required marker', async ({ page }) => {
  await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'telegram.send_message');
  await expect(page.locator('#telegram-text-label')).toContainText('*');
  await expect(page.getByRole('button', { name: /^Chèn dữ liệu vào Nội dung tin nhắn$/ })).toHaveCount(1);
  for (const name of await page.getByTestId('mapping-data-toggle').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''))) expect(name).not.toContain('*');
});

test('the data menu of a field near the bottom stays inside the inspector', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'telegram.send_message');
  const toggles = page.getByTestId('mapping-data-toggle');
  await toggles.last().click();
  const menu = page.getByTestId('mapping-data-menu');
  await expect(menu).toBeVisible();
  await expect.poll(() => menu.evaluate((el) => {
    let scroller = el.parentElement;
    while (scroller && getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement;
    if (!scroller) return false;
    const box = el.getBoundingClientRect();
    const area = scroller.getBoundingClientRect();
    return box.top >= area.top - 1 && box.bottom <= area.bottom + 1;
  })).toBe(true);
});
