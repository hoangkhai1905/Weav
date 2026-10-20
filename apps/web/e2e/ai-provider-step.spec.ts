import { expect, test, type Page, type Route } from '@playwright/test';
import { friendlyErrorKind } from '../src/lib/executions/friendlyError.js';

// AI provider with your own key: the AI picker on the four AI steps, the model name, and the friendly run errors (backend stubbed).

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workflowId = '00000000-0000-4000-8000-000000000002';
const openaiId = '20000000-0000-4000-8000-0000000000a1';
const gmailId = '20000000-0000-4000-8000-0000000000a2';
const base = `**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}`;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const connection = (id: string, provider: string, name: string, status = 'ACTIVE') => ({
  id, workspaceId, createdBy: '00000000-0000-4000-8000-000000000010', name, provider,
  authType: provider === 'GMAIL' ? 'OAUTH2' : 'TOKEN', status, config: null, hasCredential: true,
  credentialExpiresAt: null, lastVerifiedAt: null, canManage: true, canAttach: true,
  createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z',
});

type SavedNode = { id: string; type: string; config: Record<string, unknown> };
type Draft = { definition: { nodes: SavedNode[] } };

const draft = (nodes: SavedNode[]) => ({
  workflowId,
  name: 'AI steps',
  status: 'DRAFT',
  schemaVersion: '1.0',
  definition: { schemaVersion: '1.0', nodes: [{ id: 'manual', type: 'trigger.manual', config: {} }, ...nodes], edges: [], variables: {} },
  editorState: { nodes: { manual: { name: 'Manual trigger', position: { x: 100, y: 120 } }, ...Object.fromEntries(nodes.map((node, index) => [node.id, { name: `Step ${node.id}`, position: { x: 100, y: 300 + index * 120 } }])) } },
  currentVersionId: null,
  createdAt: '2026-10-10T10:00:00Z',
  updatedAt: '2026-10-10T10:00:00Z',
  publishedAt: null,
  triggers: [],
});

async function stubBackend(page: Page, { lang = 'VI', nodes = [] as SavedNode[], connections = [connection(openaiId, 'OPENAI', 'My OpenAI')] as unknown[] } = {}) {
  const drafts: Draft[] = [];
  let current: Record<string, unknown> = draft(nodes);
  await page.addInitScript((value) => {
    localStorage.setItem('weav_token', 'playwright-test-token');
    localStorage.setItem('weav_lang_v1', value);
  }, lang);
  await page.route('**/api/auth/me', (route) => json(route, { id: '00000000-0000-4000-8000-000000000010', email: 'test@example.test', displayName: 'Playwright User', avatarUrl: null, systemRole: 'USER', status: 'ACTIVE', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', emailVerifiedAt: null }));
  await page.route('**/api/v2/notifications/unread-count', (route) => json(route, { count: 0 }));
  const workspace = { id: workspaceId, name: 'Real Workspace', createdBy: '00000000-0000-4000-8000-000000000010', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' };
  await page.route(`**/api/v1/workspaces/${workspaceId}`, (route) => json(route, workspace));
  await page.route('**/api/v1/workspaces?**', (route) => json(route, { items: [workspace], page: 0, size: 100, totalElements: 1, totalPages: 1 }));
  await page.route(`**/api/v1/workspaces/${workspaceId}/connections**`, (route) => json(route, connections));
  await page.route(/\/workflows\?page=/, (route) => json(route, { items: [{ workflowId, name: 'AI steps', status: 'DRAFT' }], page: 0, size: 100, totalElements: 1, totalPages: 1 }));
  await page.route(base, (route) => json(route, current));
  await page.route(`${base}/draft`, (route) => {
    const body = route.request().postDataJSON() as Draft;
    drafts.push(body);
    current = { ...current, ...body };
    return json(route, current);
  });
  return { drafts };
}

async function openBuilder(page: Page) {
  await page.goto(`/workflows/${workflowId}/builder`);
  await expect(page.getByTestId('workflow-title')).toHaveValue('AI steps');
}

async function addNode(page: Page, nodeType: string) {
  await page.getByTestId('workflow-add-step').click();
  await page.locator(`[data-testid="workflow-palette-item"][data-node-type="${nodeType}"]`).click();
}

/** Saves the draft and returns the saved config of the first step of `type`. */
async function savedConfig(page: Page, drafts: Draft[], type: string) {
  const before = drafts.length;
  await page.getByRole('button', { name: /^(Save|Lưu)$/ }).first().click();
  await expect.poll(() => drafts.length).toBeGreaterThan(before);
  return drafts[drafts.length - 1].definition.nodes.find((node) => node.type === type)?.config;
}

const AI_TYPES = ['ai.summarize', 'ai.classify', 'ai.extract', 'ai.generate'] as const;

test('run errors of the AI providers map to a friendly kind', () => {
  expect(friendlyErrorKind('AI_PROVIDER_RATE_LIMITED')).toBe('limit');
  expect(friendlyErrorKind('CONNECTION_AUTHENTICATION_REJECTED')).toBe('connection');
  // A wrong model surfaces as CONFIGURATION_ERROR: "Open workflow".
  expect(friendlyErrorKind('CONFIGURATION_ERROR')).toBe('config');
});

for (const type of AI_TYPES) {
  test(`${type}: the AI picker offers the Weav default first, then the workspace's AI connections`, async ({ page }) => {
    await stubBackend(page, {
      connections: [connection(openaiId, 'OPENAI', 'My OpenAI'), connection(gmailId, 'GMAIL', 'Work Gmail'), connection('20000000-0000-4000-8000-0000000000a3', 'ANTHROPIC', 'Off Claude', 'INVALID')],
    });
    await openBuilder(page);
    await addNode(page, type);
    const picker = page.getByLabel('AI dùng cho bước này');
    await expect(picker).toBeVisible();
    await expect(picker.locator('option')).toHaveText(['AI mặc định của Weav', 'My OpenAI (ChatGPT)']);
    await expect(picker).toHaveValue('');
    // The model name only exists once an AI connection is chosen.
    await expect(page.getByLabel('Tên model')).toHaveCount(0);
  });
}

test('ai.summarize: choosing a connection shows the model name; going back to the default removes both from the saved config', async ({ page }) => {
  const backend = await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'ai.summarize');
  const picker = page.getByLabel('AI dùng cho bước này');
  await picker.selectOption(openaiId);
  const advanced = page.getByTestId('ai-advanced');
  await advanced.locator('summary').click();
  const model = page.getByLabel('Tên model');
  await expect(model).toBeVisible();
  await expect(model).toHaveAttribute('placeholder', 'Ví dụ: gpt-5-mini');
  await model.fill('gpt-4o-mini');
  expect(await savedConfig(page, backend.drafts, 'ai.summarize')).toMatchObject({ connectionId: openaiId, model: 'gpt-4o-mini' });

  await picker.selectOption('');
  await expect(page.getByLabel('Tên model')).toHaveCount(0);
  const config = await savedConfig(page, backend.drafts, 'ai.summarize');
  expect(config).not.toHaveProperty('connectionId');
  expect(config).not.toHaveProperty('model');
});

test('an invalid model name shows a friendly message and is not saved', async ({ page }) => {
  const backend = await stubBackend(page, { nodes: [{ id: 'sum', type: 'ai.summarize', config: { connectionId: openaiId } }] });
  await openBuilder(page);
  await page.getByTestId('rf__node-sum').getByTestId('workflow-node').click();
  await page.getByTestId('ai-advanced').locator('summary').click();
  const model = page.getByLabel('Tên model');
  await model.fill('gpt 4 mini!');
  await expect(page.getByRole('alert').filter({ hasText: 'Tên model chỉ gồm chữ, số' })).toBeVisible();
  expect((await savedConfig(page, backend.drafts, 'ai.summarize'))).not.toHaveProperty('model');
  await model.fill('gpt-4o-mini');
  await expect(page.getByRole('alert').filter({ hasText: 'Tên model chỉ gồm chữ, số' })).toHaveCount(0);
  expect((await savedConfig(page, backend.drafts, 'ai.summarize'))).toMatchObject({ model: 'gpt-4o-mini' });
});

for (const type of ['ai.classify', 'ai.extract', 'ai.generate'] as const) {
  test(`${type}: a saved connection and model are shown, and the model sits under the extra options`, async ({ page }) => {
    await stubBackend(page, { nodes: [{ id: 'ai1', type, config: { connectionId: openaiId, model: 'gpt-5-mini' } }] });
    await openBuilder(page);
    await page.getByTestId('rf__node-ai1').getByTestId('workflow-node').click();
    await expect(page.getByLabel('AI dùng cho bước này')).toHaveValue(openaiId);
    await expect(page.getByLabel('Tên model')).toHaveValue('gpt-5-mini');
  });
}

test('a step without a connection is not marked as not configured', async ({ page }) => {
  await stubBackend(page, { nodes: [{ id: 'gen', type: 'ai.generate', config: { prompt: 'Write a haiku' } }] });
  await openBuilder(page);
  await page.getByTestId('rf__node-gen').getByTestId('workflow-node').click();
  await expect(page.getByLabel('AI dùng cho bước này')).toHaveValue('');
  await expect(page.getByTestId('integration-readiness')).toHaveCount(0);
  await expect(page.getByTestId('rf__node-gen')).not.toContainText('Chưa cấu hình');
});

test('a model left without a connection (shared template) stays visible and can be cleared', async ({ page }) => {
  const backend = await stubBackend(page, { nodes: [{ id: 'gen', type: 'ai.generate', config: { prompt: 'Write a haiku', model: 'gpt-5-mini' } }] });
  await openBuilder(page);
  await page.getByTestId('rf__node-gen').getByTestId('workflow-node').click();
  const model = page.getByLabel('Tên model');
  await expect(model).toHaveValue('gpt-5-mini');
  await model.fill('');
  expect(await savedConfig(page, backend.drafts, 'ai.generate')).not.toHaveProperty('model');
  await expect(page.getByLabel('Tên model')).toHaveCount(0);
});

test('the picker is not duplicated by the generic schema form of ai.generate', async ({ page }) => {
  await stubBackend(page, { nodes: [{ id: 'gen', type: 'ai.generate', config: { prompt: 'Write a haiku', connectionId: openaiId } }] });
  await openBuilder(page);
  await page.getByTestId('rf__node-gen').getByTestId('workflow-node').click();
  await expect(page.getByLabel('AI dùng cho bước này')).toHaveCount(1);
  await expect(page.getByLabel('Tên model')).toHaveCount(1);
  await expect(page.getByTestId('field-connectionId')).toHaveCount(0);
});

test('English labels', async ({ page }) => {
  await stubBackend(page, { lang: 'EN' });
  await openBuilder(page);
  await addNode(page, 'ai.classify');
  const picker = page.getByLabel('AI for this step');
  await expect(picker.locator('option')).toHaveText(['Weav default AI', 'My OpenAI (ChatGPT)']);
  await picker.selectOption(openaiId);
  await page.getByTestId('ai-advanced').locator('summary').click();
  await expect(page.getByLabel('Model name')).toBeVisible();
});

test('a new AI key rejected by the provider warns in the builder dialog', async ({ page }) => {
  await stubBackend(page, { lang: 'EN', nodes: [{ id: 'mail', type: 'trigger.gmail', config: {} }], connections: [] });
  let connections: unknown[] = [];
  await page.route(`**/api/v1/workspaces/${workspaceId}/connections`, (route) => {
    if (route.request().method() === 'GET') return json(route, connections);
    connections = [connection(openaiId, 'OPENAI', 'Typo key', 'DISABLED')];
    return json(route, connections[0], 201);
  });
  await page.route(`**/api/v1/workspaces/${workspaceId}/connections/${openaiId}/credential`, (route) => json(route, connections[0]));
  await page.route(`**/api/v1/workspaces/${workspaceId}/connections/${openaiId}/test`, (route) => json(route, { outcome: 'AUTH_INVALID' }));
  await openBuilder(page);
  await page.getByTestId('rf__node-mail').getByTestId('workflow-node').click();
  await page.getByTestId('add-connection-GMAIL').click();
  await page.getByTestId('connection-provider-OPENAI').check({ force: true });
  await page.getByTestId('connection-create-name').fill('Typo key');
  await page.getByTestId('connection-create-token').fill('sk-wrong');
  await page.getByTestId('connection-create-submit').click();
  await expect(page.getByText('The key is invalid or was revoked.')).toBeVisible();
  await expect(page.getByTestId('connection-create-dialog')).toHaveCount(0);
});
