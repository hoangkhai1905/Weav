import { expect, test, type Page, type Route } from '@playwright/test';
import { WORKFLOW_TEMPLATES, templateToDraft } from '../src/lib/templates/index.js';

// W6-B2: Discord connection form, the three control-bot inspectors and templates (backend stubbed).

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workflowId = '00000000-0000-4000-8000-000000000002';
const otherWorkflowId = '00000000-0000-4000-8000-000000000003';
const discordConnectionId = '20000000-0000-4000-8000-000000000009';
const base = `**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}`;
const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/abc_DEF-123';

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const discordConnection = (status: 'DISABLED' | 'ACTIVE', hasCredential: boolean) => ({
  id: discordConnectionId,
  workspaceId,
  createdBy: '00000000-0000-4000-8000-000000000010',
  name: 'Alerts channel',
  provider: 'DISCORD',
  authType: 'TOKEN',
  status,
  config: null,
  hasCredential,
  credentialExpiresAt: null,
  lastVerifiedAt: null,
  canManage: true,
  canAttach: true,
  createdAt: '2026-10-09T00:00:00Z',
  updatedAt: '2026-10-09T00:00:00Z',
});

const draft = () => ({
  workflowId,
  name: 'Control bot',
  status: 'DRAFT',
  schemaVersion: '1.0',
  definition: { schemaVersion: '1.0', nodes: [{ id: 'manual', type: 'trigger.manual', config: {} }], edges: [], variables: {} },
  editorState: { nodes: { manual: { name: 'Manual trigger', position: { x: 100, y: 120 } } } },
  currentVersionId: null,
  createdAt: '2026-10-09T10:00:00Z',
  updatedAt: '2026-10-09T10:00:00Z',
  publishedAt: null,
  triggers: [],
});

type SavedNode = { id: string; type: string; config: Record<string, unknown> };

async function stubBackend(page: Page, connections: unknown[] = []) {
  const drafts: Array<{ definition: { nodes: SavedNode[] } }> = [];
  let current: Record<string, unknown> = draft();
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'playwright-test-token');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await page.route('**/api/auth/me', (route) => json(route, { id: '00000000-0000-4000-8000-000000000010', email: 'test@example.test', displayName: 'Playwright User', avatarUrl: null, systemRole: 'USER', status: 'ACTIVE', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', emailVerifiedAt: null }));
  await page.route('**/api/v2/notifications/unread-count', (route) => json(route, { count: 0 }));
  const workspace = { id: workspaceId, name: 'Real Workspace', createdBy: '00000000-0000-4000-8000-000000000010', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' };
  await page.route(`**/api/v1/workspaces/${workspaceId}`, (route) => json(route, workspace));
  await page.route('**/api/v1/workspaces?**', (route) => json(route, { items: [workspace], page: 0, size: 100, totalElements: 1, totalPages: 1 }));
  await page.route(`**/api/v1/workspaces/${workspaceId}/connections**`, (route) => json(route, connections));
  await page.route(/\/workflows\?page=/, (route) => json(route, {
    items: [
      { workflowId, name: 'Control bot', status: 'DRAFT' },
      { workflowId: otherWorkflowId, name: 'Weekly report', status: 'PUBLISHED' },
    ],
    page: 0, size: 100, totalElements: 2, totalPages: 1,
  }));
  await page.route(base, (route) => json(route, current));
  await page.route(`${base}/draft`, (route) => {
    const body = route.request().postDataJSON() as { definition: { nodes: SavedNode[] } };
    drafts.push(body);
    current = { ...current, ...body };
    return json(route, current);
  });
  return { drafts };
}

async function addNode(page: Page, nodeType: string) {
  await page.getByTestId('workflow-add-step').click();
  await page.locator(`[data-testid="workflow-palette-item"][data-node-type="${nodeType}"]`).click();
}

async function openBuilder(page: Page) {
  await page.goto(`/workflows/${workflowId}/builder`);
  await expect(page.getByTestId('workflow-title')).toHaveValue('Control bot');
}

const savedNode = async (page: Page, drafts: Array<{ definition: { nodes: SavedNode[] } }>, type: string) => {
  const before = drafts.length;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => drafts.length).toBeGreaterThan(before);
  return drafts[drafts.length - 1].definition.nodes.find((node) => node.type === type);
};

test('creating a Discord connection validates the webhook URL and stores it through the credential endpoint', async ({ page }) => {
  await stubBackend(page);
  let created: unknown;
  let credential: unknown;
  let listed: unknown[] = [];
  await page.route(`**/api/v1/workspaces/${workspaceId}/connections`, (route) => {
    if (route.request().method() === 'GET') return json(route, listed);
    created = route.request().postDataJSON();
    listed = [discordConnection('DISABLED', false)];
    return json(route, listed[0], 201);
  });
  await page.route(`**/api/v1/workspaces/*/connections/${discordConnectionId}/credential`, (route) => {
    credential = route.request().postDataJSON();
    listed = [discordConnection('DISABLED', true)];
    return json(route, listed[0]);
  });
  await page.route(`**/api/v1/workspaces/*/connections/${discordConnectionId}/test`, (route) => {
    listed = [discordConnection('ACTIVE', true)];
    return json(route, { outcome: 'VERIFIED' });
  });
  await page.goto('/connections');
  await page.getByTestId('connections-create-open').click();
  await page.getByTestId('connection-create-name').fill('Alerts channel');
  await page.getByTestId('connection-create-provider').selectOption('DISCORD');
  const url = page.getByTestId('connection-create-token');
  await expect(url).toHaveAttribute('type', 'password');

  await url.fill('https://discord.com.evil.test/api/webhooks/1/x');
  await page.getByTestId('connection-create-submit').click();
  await expect(page.getByTestId('connection-create-error')).toBeVisible();
  expect(created).toBeUndefined();

  await url.fill(WEBHOOK);
  await page.getByTestId('connection-create-submit').click();
  await expect(page.getByTestId(`connection-row-${discordConnectionId}`)).toContainText('Discord');
  expect(created).toEqual({ name: 'Alerts channel', provider: 'DISCORD', authType: 'TOKEN' });
  expect(credential).toEqual({ payload: { token: WEBHOOK } });
  await expect(page.getByText(WEBHOOK)).toHaveCount(0);
});

test('the Discord step picks a connection, counts content and saves its config', async ({ page }) => {
  const backend = await stubBackend(page, [discordConnection('ACTIVE', true)]);
  await openBuilder(page);
  await addNode(page, 'discord.send_message');
  await page.getByTestId('field-connectionId').selectOption(discordConnectionId);
  await page.getByTestId('field-content').fill('Failed: {{ trigger.input.workflowName }}');
  await expect(page.getByTestId('content-counter')).toContainText('/2000');
  await page.getByTestId('field-username').fill('Weav');
  const node = await savedNode(page, backend.drafts, 'discord.send_message');
  expect(node?.config).toMatchObject({ connectionId: discordConnectionId, content: 'Failed: {{ trigger.input.workflowName }}', username: 'Weav' });
});

test('the control step shows the fields of its operation and saves them', async ({ page }) => {
  const backend = await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'weav.workflow');
  await expect(page.getByTestId('field-operation')).toHaveValue('command');
  await page.getByTestId('field-text').fill('{{ trigger.input.message.text }}');
  await expect(page.getByTestId('weav-workflow-target')).toHaveCount(0);

  await page.getByTestId('field-operation').selectOption('status');
  await expect(page.getByTestId('field-text')).toHaveCount(0);
  const target = page.getByTestId('weav-workflow-target');
  await expect(target.locator('option', { hasText: 'Control bot' })).toHaveCount(0); // never itself
  await target.selectOption(otherWorkflowId);

  await page.getByTestId('field-operation').selectOption('run');
  await page.getByTestId('weav-workflow-input').fill('{"a": ');
  await expect(page.getByText('The input must be a valid JSON object.')).toBeVisible();
  await page.getByTestId('weav-workflow-input').fill('{"a": 1}');

  await page.getByTestId('field-operation').selectOption('list_failures');
  await page.getByTestId('field-limit').fill('7');
  await target.selectOption('__expression__');
  await page.getByTestId('weav-workflow-target-text').fill('báo cáo  tuần');

  const node = await savedNode(page, backend.drafts, 'weav.workflow');
  expect(node?.config).toMatchObject({ operation: 'list_failures', workflow: 'báo cáo  tuần', limit: 7 });
  expect(node?.config.text).toBeUndefined();
  expect(node?.config.input).toBeUndefined();
});

test('command shows sender and the allow-list only for command, and clears them otherwise', async ({ page }) => {
  const backend = await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'weav.workflow');
  await expect(page.getByTestId('field-operation')).toHaveValue('command');
  await expect(page.getByTestId('field-sender')).toHaveValue('{{ trigger.input.message.from.id }}');
  await page.locator('#weav-workflow-allowed-senders').fill('111, 222');
  let node = await savedNode(page, backend.drafts, 'weav.workflow');
  expect(node?.config).toMatchObject({ operation: 'command', sender: '{{ trigger.input.message.from.id }}', allowedSenders: ['111', '222'] });

  await page.getByTestId('field-operation').selectOption('status');
  await expect(page.getByTestId('field-sender')).toHaveCount(0);
  await expect(page.locator('#weav-workflow-allowed-senders')).toHaveCount(0);
  node = await savedNode(page, backend.drafts, 'weav.workflow');
  expect(node?.config.sender).toBeUndefined();
  expect(node?.config.allowedSenders).toBeUndefined();

  await page.getByTestId('rf__node-control_1').click();
  await page.getByTestId('field-operation').selectOption('command');
  await expect(page.getByTestId('field-sender')).toHaveValue('{{ trigger.input.message.from.id }}');
  await expect(page.locator('#weav-workflow-allowed-senders')).toHaveValue('');
});

test('run input does not leak between control steps and never keeps stale JSON', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const backend = await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'weav.workflow');
  await expect(page.getByTestId('inspector-node-id')).toHaveText('control_1');
  await page.getByTestId('field-operation').selectOption('run');
  await page.getByTestId('weav-workflow-input').fill('{"a": 1}');
  // Invalid JSON clears the stored input instead of saving the previous valid one.
  await page.getByTestId('weav-workflow-input').fill('{"a": ');
  const saved = await savedNode(page, backend.drafts, 'weav.workflow');
  expect(saved?.config.input).toBeUndefined();
  await page.getByTestId('weav-workflow-input').fill('{"a": 2}');

  await addNode(page, 'weav.workflow');
  await expect(page.getByTestId('inspector-node-id')).toHaveText('control_2');
  await page.getByTestId('field-operation').selectOption('run');
  await expect(page.getByTestId('weav-workflow-input')).toHaveValue('');
  await savedNode(page, backend.drafts, 'weav.workflow');
  const nodes = backend.drafts[backend.drafts.length - 1].definition.nodes.filter((node) => node.type === 'weav.workflow');
  expect(nodes.find((node) => node.id === 'control_1')?.config.input).toEqual({ a: 2 });
  expect(nodes.find((node) => node.id === 'control_2')?.config.input).toBeUndefined();

  // Leaving "run" resets the textarea, so coming back does not show the old text.
  await page.getByTestId('rf__node-control_2').click();
  await page.getByTestId('field-operation').selectOption('status');
  await page.getByTestId('field-operation').selectOption('run');
  await expect(page.getByTestId('weav-workflow-input')).toHaveValue('');
  expect(consoleErrors.filter((text) => text.includes('same key'))).toEqual([]);
});

test('the workflow-event trigger lists other workflows and needs an event', async ({ page }) => {
  const backend = await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'trigger.workflow_event');
  await expect(page.getByTestId('workflow-event-FAILED')).toBeChecked();
  await expect(page.getByTestId(`workflow-event-wf-${workflowId}`)).toHaveCount(0);
  await page.getByTestId(`workflow-event-wf-${otherWorkflowId}`).check();
  await page.getByTestId('workflow-event-SUCCEEDED').check();
  await page.getByTestId('workflow-event-FAILED').uncheck();
  await page.getByTestId('workflow-event-SUCCEEDED').uncheck();
  await expect(page.getByRole('alert').filter({ hasText: 'Select at least one event.' })).toBeVisible();
  await page.getByTestId('workflow-event-FAILED').check();
  const node = await savedNode(page, backend.drafts, 'trigger.workflow_event');
  expect(node?.config).toEqual({ events: ['FAILED'], workflowIds: [otherWorkflowId] });
});

test.describe('control bot templates', () => {
  for (const id of ['telegram-control-bot', 'failure-alert-email', 'failure-alert-discord']) {
    test(`${id} creates a draft with the expected nodes`, () => {
      const template = WORKFLOW_TEMPLATES.find((item) => item.id === id);
      expect(template).toBeDefined();
      const body = templateToDraft(template!, template!.vi.name);
      expect(body.definition.schemaVersion).toBe('1.0');
      expect(body.definition.edges.length).toBe(body.definition.nodes.length - 1);
      expect(Object.keys(body.layout)).toEqual(body.definition.nodes.map((node) => node.id));
      const configOf = (type: string) => body.definition.nodes.find((node) => node.type === type)?.config;
      if (id === 'telegram-control-bot') {
        expect(configOf('weav.workflow')).toEqual({ operation: 'command', text: '{{ trigger.input.message.text }}', sender: '{{ trigger.input.message.from.id }}' });
        expect(configOf('weav.workflow')).not.toHaveProperty('allowedSenders');
        expect(configOf('telegram.send_message')).toMatchObject({ chatId: '{{ trigger.input.message.chat.id }}', text: '{{ nodes.control.output.reply }}' });
      } else {
        expect(configOf('trigger.workflow_event')).toEqual({ events: ['FAILED'] });
      }
      // The recipient is left for the user; connections are picked in the builder.
      if (id === 'failure-alert-email') expect(configOf('email.send')).not.toHaveProperty('to');
      if (id === 'failure-alert-discord') expect(configOf('discord.send_message')).not.toHaveProperty('connectionId');
    });
  }
});

// The variable picker lists what the executors return; asserted through the UI (no imports from src/).
test('the variable picker offers the real outputs of the new steps', async ({ page }) => {
  await stubBackend(page);
  await openBuilder(page);
  const paths = async (group: string) => {
    await page.getByTestId('rf__node-http_1').click();
    await page.locator('#http-body').click();
    if (await page.getByTestId('variable-option').count() === 0) await page.getByTestId('variable-picker-toggle').click();
    return page.getByRole('group', { name: group, exact: true }).getByTestId('variable-option').allInnerTexts();
  };
  await addNode(page, 'weav.workflow');
  await addNode(page, 'http.request');
  const expected: Record<string, string[]> = {
    run: ['executionId', 'status', 'workflowId', 'workflowName'],
    pause: ['workflowId', 'name', 'status'],
    status: ['workflowId', 'name', 'status', 'lastRun.executionId', 'lastRun.status', 'lastRun.finishedAt', 'successRate7d'],
    command: ['reply', 'ok'],
  };
  for (const [operation, list] of Object.entries(expected)) {
    await page.getByTestId('rf__node-control_1').click();
    await page.getByTestId('field-operation').selectOption(operation);
    expect(await paths('control_1')).toEqual(list);
  }
  await page.getByTestId('rf__node-control_1').click();
  await page.getByTestId('field-operation').selectOption('list_failures');
  expect(await paths('control_1')).toEqual(expect.arrayContaining(['items', 'items[0].workflowId', 'items[0].errorMessage']));
});
