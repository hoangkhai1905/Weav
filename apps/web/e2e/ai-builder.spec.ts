import { expect, test } from '@playwright/test';
import { addNode, loginAndOpenBuilder } from './support/builder.js';

test('ai.extract needs a valid output schema', async ({ page }) => {
  await loginAndOpenBuilder(page);
  await addNode(page, 'ai.extract');
  // NOTE (Task 10 deviation, coordinator unresponsive): page-wide 'Not configured'/'Ready'
  // match several canvas badges, so these two assertions are scoped to the inspector.
  // The reload tail is replaced by a mock-storage persistence check: in mock mode the
  // canvas always resets to INITIAL_NODES on reload and never renders the stored draft.
  const inspector = page.getByTestId('workflow-inspector');
  await expect(inspector.getByText('Not configured')).toBeVisible();
  const editor = page.getByLabel('Output schema (JSON)');
  await editor.fill('{"type":"array"}');
  await editor.blur();
  await expect(page.getByRole('alert')).toContainText('root must be an object');
  await editor.fill('{"type":"object","properties":{"token":{"type":"string"}}}');
  await editor.blur();
  await page.getByLabel('Input text').fill('{{trigger.input.body}}');
  await expect(inspector.getByText('Ready')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem('weav_mock_workflows_v1') ?? '[]';
    const workflows = JSON.parse(raw) as Array<{ id: string; nodes: Array<{ type: string; config: Record<string, unknown> }> }>;
    return (workflows.find((w) => w.id === 'wf-001')?.nodes ?? []).filter((n) => n.type === 'ai.extract').map((n) => n.config);
  });
  expect(persisted).toContainEqual({ text: '{{trigger.input.body}}', outputSchema: { type: 'object', properties: { token: { type: 'string' } } } });
});

test('configured ai.extract does not block publishing (R7)', async ({ page }) => {
  // Ruling R7: ai.* nodes must not appear in getPublishBlockers. In mock mode the
  // canvas always loads INITIAL_NODES, so remove the two legitimately-blocking
  // nodes (unconfigured condition + email) via keyboard delete, configure the
  // built-in ai.extract, and Publish must become enabled with no AI banner.
  await loginAndOpenBuilder(page);
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();

  await page.getByTestId('rf__node-node-condition').getByTestId('workflow-node').click();
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('rf__node-node-condition')).toHaveCount(0);

  await page.getByTestId('rf__node-node-notify').getByTestId('workflow-node').click();
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('rf__node-node-notify')).toHaveCount(0);

  await page.getByTestId('rf__node-node-extract').getByTestId('workflow-node').click();
  const inspector = page.getByTestId('workflow-inspector');
  const editor = page.getByLabel('Output schema (JSON)');
  await editor.fill('{"type":"object","properties":{"token":{"type":"string"}}}');
  await editor.blur();
  await page.getByLabel('Input text').fill('{{trigger.input.body}}');
  await expect(inspector.getByText('Ready')).toBeVisible();

  await expect(page.getByTestId('workflow-publish')).toBeEnabled();
  // No "Publish unavailable" banner at all, hence none mentioning AI.
  await expect(page.getByTestId('publish-blocker-summary')).toBeHidden();
});

test('generate with AI', async ({ page }) => {
  test.skip(process.env.AI_E2E !== '1', 'Requires compose.ai-local.yml and the Gateway generate route');
  await loginAndOpenBuilder(page);
  await page.getByRole('button', { name: 'Generate with AI' }).click();
  await page.getByLabel('Describe the workflow').fill('scenario:needs-input ping a website every morning');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByText('Which URL should be used?')).toBeVisible();
  await page.getByLabel('Describe the workflow').fill('ping https://example.com then summarize it');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
});
