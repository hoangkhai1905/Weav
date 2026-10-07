import { expect, test, type Page, type Route } from '@playwright/test';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workflowId = '00000000-0000-4000-8000-000000000002';
const base = `**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}`;

const draft = () => ({
  workflowId,
  name: 'Builder correctness',
  status: 'DRAFT',
  schemaVersion: '1.0',
  definition: {
    schemaVersion: '1.0',
    nodes: [{ id: 'manual', type: 'trigger.manual', config: {} }],
    edges: [],
    variables: {},
  },
  editorState: { nodes: { manual: { name: 'Manual trigger', position: { x: 100, y: 120 } } } },
  currentVersionId: null,
  createdAt: '2026-10-07T10:00:00Z',
  updatedAt: '2026-10-07T10:00:00Z',
  publishedAt: null,
  triggers: [],
});

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

type Definition = { nodes: Array<{ id: string; type: string; config: Record<string, unknown> }> };

/** Stubs the backend; every draft PUT is recorded and echoed back, publish answers 200. */
async function stubBackend(page: Page) {
  const drafts: Array<{ definition: Definition }> = [];
  let publishCalls = 0;
  let current: Record<string, unknown> = draft();
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'playwright-test-token');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await page.route('**/api/auth/me', (route) => json(route, { id: '00000000-0000-4000-8000-000000000010', email: 'test@example.test', displayName: 'Playwright User' }));
  await page.route('**/api/v1/workspaces?**', (route) => json(route, { items: [{ id: workspaceId, name: 'Real Workspace', role: 'OWNER' }], page: 0, size: 100, totalElements: 1, totalPages: 1 }));
  await page.route(`**/api/v1/workspaces/${workspaceId}/connections**`, (route) => json(route, { items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }));
  await page.route(base, (route) => json(route, current));
  await page.route(`${base}/draft`, (route) => {
    const body = route.request().postDataJSON() as { definition: Definition };
    drafts.push(body);
    current = { ...current, ...body, updatedAt: '2026-10-07T10:01:00Z' };
    return json(route, current);
  });
  await page.route(`${base}/publish`, (route) => {
    publishCalls += 1;
    current = { ...current, status: 'PUBLISHED', publishedAt: '2026-10-07T10:02:00Z' };
    return json(route, { webhooks: [] });
  });
  return { drafts, publishCalls: () => publishCalls };
}

async function addNode(page: Page, nodeType: string) {
  await page.getByTestId('workflow-add-step').click();
  await page.locator(`[data-testid="workflow-palette-item"][data-node-type="${nodeType}"]`).click();
}

test('new steps show their real id and the variable picker uses it', async ({ page }) => {
  const backend = await stubBackend(page);
  await page.goto(`/workflows/${workflowId}/builder`);
  await expect(page.getByTestId('workflow-title')).toHaveValue('Builder correctness');

  await addNode(page, 'http.request');
  await expect(page.getByTestId('inspector-node-id')).toHaveText('http_1');
  await page.locator('#http-url').fill('https://example.test/one');
  await addNode(page, 'http.request');
  await expect(page.getByTestId('inspector-node-id')).toHaveText('http_2');
  await expect(page.getByTestId('rf__node-http_2')).toContainText('http_2');
  await expect(page.getByTestId('rf__node-http_2')).not.toContainText('_v1');
  await page.locator('#http-url').fill('https://example.test/two');

  // Only upstream steps are offered: http_1 and the trigger, never http_2 itself.
  await page.locator('#http-body').click();
  await page.getByTestId('variable-picker-toggle').click();
  await expect(page.getByRole('group', { name: 'http_1', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'http_2', exact: true })).toHaveCount(0);
  await page.getByRole('group', { name: 'http_1', exact: true }).getByRole('button', { name: 'status', exact: true }).click();
  await expect(page.locator('#http-body')).toHaveValue('{{ nodes.http_1.output.status }}');

  await page.getByTestId('workflow-publish').click();
  await expect.poll(() => backend.publishCalls()).toBe(1);

  const saved = backend.drafts[backend.drafts.length - 1].definition;
  expect(saved.nodes.map((node) => node.id)).toEqual(['manual', 'http_1', 'http_2']);
  expect(saved.nodes[2].config.body).toBe('{{ nodes.http_1.output.status }}');
  expect(saved.nodes[2].config.headers).toEqual({});
});

test('a webhook trigger is saved with an empty config', async ({ page }) => {
  const backend = await stubBackend(page);
  await page.goto(`/workflows/${workflowId}/builder`);
  await expect(page.getByTestId('workflow-title')).toHaveValue('Builder correctness');

  await addNode(page, 'trigger.webhook');
  await expect(page.getByTestId('inspector-node-id')).toHaveText('webhook_1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => backend.drafts.length).toBe(1);

  const webhook = backend.drafts[0].definition.nodes.find((node) => node.type === 'trigger.webhook');
  expect(webhook).toMatchObject({ id: 'webhook_1', config: {} });
});

test('invalid numbers and credential-like header names are flagged and never saved', async ({ page }) => {
  const backend = await stubBackend(page);
  await page.goto(`/workflows/${workflowId}/builder`);
  await expect(page.getByTestId('workflow-title')).toHaveValue('Builder correctness');

  await addNode(page, 'ai.summarize');
  await page.getByTestId('field-maxLength').fill('0');
  await expect(page.getByTestId('field-maxLength')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter a whole number', { exact: false })).toBeVisible();
  await page.getByTestId('field-maxLength').fill('{{ trigger.input.n }}');
  await expect(page.getByTestId('field-maxLength')).not.toHaveAttribute('aria-invalid', 'true');

  await addNode(page, 'http.request');
  await page.getByTestId('http-headers-add').click();
  await page.getByTestId('http-headers-key').fill('Authorization');
  await expect(page.getByText('looks like a credential', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => backend.drafts.length).toBe(1);
  const [summarize, http] = backend.drafts[0].definition.nodes.slice(1);
  expect(summarize.config.maxLength).toBe('{{ trigger.input.n }}');
  expect(http.config.headers).toEqual({});
});

test('step ids are not reused after a number was handed out', async ({ page }) => {
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const dynamicImport = new Function('modulePath', 'return import(modulePath)') as (p: string) => Promise<{ nextNodeId: (t: string, used: Set<string>, marks?: Record<string, number>) => string }>;
    const { nextNodeId } = await dynamicImport('/src/lib/constants/nodeCatalog.ts');
    const marks: Record<string, number> = {};
    const first = nextNodeId('http.request', new Set(['http_1']), marks);
    const second = nextNodeId('http.request', new Set(), marks); // http_2 was deleted meanwhile
    return [first, second];
  });
  expect(ids).toEqual(['http_2', 'http_3']);
});
