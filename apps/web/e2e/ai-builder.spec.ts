import { expect, test, type Page } from '@playwright/test';
import { addNode, loginAndOpenBuilder } from './support/builder.js';
import { expectNoUnmatched, openStubbedBuilder, resetUnmatched, STUB_WORKSPACE_ID } from './support/http-builder.js';

test.beforeEach(resetUnmatched);
test.afterEach(expectNoUnmatched);

test('ai.extract needs a valid output schema', async ({ page }) => {
  await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });
  const savedDrafts = await openStubbedBuilder(page);
  await addNode(page, 'ai.extract');
  // Page-wide 'Not configured'/'Ready' match several canvas badges, so these are scoped to the inspector.
  const inspector = page.getByTestId('workflow-inspector');
  await expect(inspector.getByText('Not configured')).toBeVisible();
  const editor = page.getByLabel('Details to pull');
  await editor.fill('{"type":"array"}');
  await editor.blur();
  await expect(page.getByRole('alert')).toContainText('must start with { } and contain "type": "object"');
  await editor.fill('{"type":"object","properties":{"token":{"type":"string"}}}');
  await editor.blur();
  await page.getByRole('textbox', { name: 'Text to read' }).fill('{{trigger.input.body}}');
  await expect(inspector.getByText('Ready')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  // HTTP mode: the draft POSTed to the Workflow Service carries the new step's config.
  expect(savedDrafts.length).toBeGreaterThan(0);
  const definition = savedDrafts.at(-1)?.definition as { nodes: Array<{ type: string; config: Record<string, unknown> }> };
  const configs = definition.nodes.filter((n) => n.type === 'ai.extract').map((n) => n.config);
  expect(configs).toContainEqual({ text: '{{trigger.input.body}}', outputSchema: { type: 'object', properties: { token: { type: 'string' } } } });
});

test('configured ai.extract does not block publishing (R7)', async ({ page }) => {
  // Ruling R7: ai.* nodes must not appear in getPublishBlockers. Remove the two legitimately-blocking
  // nodes (unconfigured condition + email) via keyboard delete, configure the saved ai.extract,
  // and Publish must become enabled with no AI banner.
  await openStubbedBuilder(page);

  await page.getByTestId('rf__node-node-condition').getByTestId('workflow-node').click();
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('rf__node-node-condition')).toHaveCount(0);

  await page.getByTestId('rf__node-node-notify').getByTestId('workflow-node').click();
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('rf__node-node-notify')).toHaveCount(0);

  // Deleting steps leaves the canvas panned: fit the view so the AI step is on screen.
  await page.getByRole('button', { name: 'Fit View' }).click();
  await page.getByTestId('rf__node-node-extract').getByTestId('workflow-node').click();
  const inspector = page.getByTestId('workflow-inspector');
  const editor = page.getByLabel('Details to pull');
  await editor.fill('{"type":"object","properties":{"token":{"type":"string"}}}');
  await editor.blur();
  await page.getByRole('textbox', { name: 'Text to read' }).fill('{{trigger.input.body}}');
  await expect(inspector.getByText('Ready')).toBeVisible();

  await expect(page.getByTestId('workflow-publish')).toBeEnabled();
  // No "Publish unavailable" banner at all, hence none mentioning AI.
  await expect(page.getByTestId('publish-blocker-summary')).toBeHidden();
});

const gmailConnection = {
  id: '20000000-0000-4000-8000-000000000001',
  workspaceId: STUB_WORKSPACE_ID,
  createdBy: '00000000-0000-4000-8000-000000000110',
  name: 'Work Gmail',
  provider: 'GMAIL',
  authType: 'OAUTH2',
  status: 'ACTIVE',
  config: null,
  hasCredential: true,
  credentialExpiresAt: null,
  lastVerifiedAt: null,
  canManage: true,
  canAttach: true,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

async function openGenerateDialog(page: Page, generate: (body: Record<string, unknown>) => unknown, connections: unknown[] = []) {
  await openStubbedBuilder(page);
  const generates: Array<Record<string, unknown>> = [];
  await page.route((url) => url.pathname === `/api/v1/workspaces/${STUB_WORKSPACE_ID}/connections`, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: connections }) : route.fallback());
  await page.route((url) => url.pathname === `/api/v1/workspaces/${STUB_WORKSPACE_ID}/workflows/generate`, (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    generates.push(body);
    return route.fulfill({ json: generate(body) });
  });
  await page.getByRole('button', { name: 'Generate with AI' }).click();
  const dialog = page.getByRole('dialog', { name: 'Generate with AI' });
  await expect(dialog).toBeVisible();
  // No connection pickers and no answer inputs: only the prompt box.
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(dialog.getByRole('textbox')).toHaveCount(1);
  await dialog.getByLabel('Describe the workflow').fill('email me a Sheets summary every morning');
  return { dialog, generates };
}

test('generate with AI', async ({ page }) => {
  page.on('dialog', (confirm) => void confirm.accept());
  const ready = {
    status: 'ready',
    name: 'Morning summary',
    definition: {
      schemaVersion: '1.0',
      nodes: [
        { id: 'start', type: 'trigger.manual', config: {} },
        { id: 'sheet', type: 'google.sheets', config: {} },
        { id: 'mail', type: 'email.send', config: { to: 'ui@example.test', subject: 'Hi', body: 'Hello' } },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'sheet' }, { id: 'e2', source: 'sheet', target: 'mail' }],
      variables: {},
    },
    layout: { start: { x: 100, y: 100 }, sheet: { x: 400, y: 100 }, mail: { x: 700, y: 100 } },
  };
  const { dialog, generates } = await openGenerateDialog(page, () => ready, [gmailConnection]);
  await dialog.getByRole('button', { name: 'Generate', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  expect(generates).toHaveLength(1);
  expect(generates[0]).toMatchObject({ allowBlanks: true });
  expect(generates[0]).not.toHaveProperty('answers');
  expect(generates[0]).not.toHaveProperty('connections');
  await expect(page.getByTestId('workflow-node')).toHaveCount(3);
  // No Sheets connection exists: that step stays blank and red.
  await expect(page.locator('[data-testid="workflow-node"][data-node-type="google.sheets"]')).toHaveAttribute('data-readiness', 'not-configured');
  // The single Gmail connection was picked for the email step.
  await page.locator('[data-testid="workflow-node"][data-node-type="email.send"]').click();
  await expect(page.getByTestId('workflow-inspector').getByTestId('email-connection')).toHaveValue(gmailConnection.id);
});

test('generate with AI explains an unclear request without asking for answers', async ({ page }) => {
  const { dialog, generates } = await openGenerateDialog(page, () => ({ status: 'needs_input', questions: [{ code: 'VALUE', field: 'email.send.body' }] }));
  await dialog.getByRole('button', { name: 'Generate', exact: true }).click();

  await expect(dialog.getByText("The AI needs a clearer description")).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  expect(generates).toHaveLength(1);
});

test('generate with AI against the real Gateway', async ({ page }) => {
  test.skip(process.env.AI_E2E !== '1', 'Requires compose.ai-local.yml and the Gateway generate route');
  await loginAndOpenBuilder(page);
  await page.getByRole('button', { name: 'Generate with AI' }).click();
  const dialog = page.getByRole('dialog', { name: 'Generate with AI' });
  await dialog.getByLabel('Describe the workflow').fill('ping https://example.com then summarize it');
  await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.locator('.react-flow__node').count()).toBeGreaterThan(1);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
});
