import { expect, test } from '@playwright/test';
import { addNode, loginAndOpenBuilder } from './support/builder.js';
import { expectNoUnmatched, openStubbedBuilder, resetUnmatched } from './support/http-builder.js';

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

test('generate with AI', async ({ page }) => {
  test.skip(process.env.AI_E2E !== '1', 'Requires compose.ai-local.yml and the Gateway generate route');
  await loginAndOpenBuilder(page);
  await page.getByRole('button', { name: 'Generate with AI' }).click();
  await page.getByLabel('Describe the workflow').fill('scenario:needs-input ping a website every morning');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByText('Which URL should be used?')).toBeVisible();
  await page.getByLabel('Which URL should be used?').fill('https://example.com');
  await page.getByLabel('Describe the workflow').fill('ping https://example.com then summarize it');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
});
