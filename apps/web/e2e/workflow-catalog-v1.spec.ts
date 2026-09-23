import { expect, test, type Page } from '@playwright/test';

type WorkflowFixture = {
  id: string;
  name: string;
  status: 'DRAFT';
  version: number;
  triggerType: string;
  nodes: Array<{ id: string; type: string; name: string; config: Record<string, unknown>; position?: { x: number; y: number } }>;
  edges: Array<{ id: string; source: string; target: string; sourcePort?: string; targetPort?: string }>;
  createdAt: string;
  updatedAt: string;
  ownerName: string;
  workspaceId: string;
};

const V1_NODE_TYPES = [
  'trigger.manual',
  'trigger.schedule',
  'trigger.webhook',
  'trigger.telegram',
  'http.request',
  'email.send',
  'google.sheets',
  'telegram.send_message',
  'logic.condition',
  'ai.extract',
  'ai.classify',
  'ai.summarize',
  'ocr.extract',
].sort();

const runtimeErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', (request) => errors.push(`${request.method()} ${request.url()} failed`));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? [], 'browser console, runtime, and network errors').toEqual([]);
});

test('catalog matches exactly the Workflow V1 node set and contract defaults', async ({ page }) => {
  await page.goto('/workflows/wf-001/builder');
  const catalog = await page.evaluate(async () => {
    const dynamicImport = new Function('modulePath', 'return import(modulePath)') as (
      modulePath: string,
    ) => Promise<{ NODE_CATALOG: Array<{ type: string; defaultConfig: Record<string, unknown>; sourcePorts?: Array<{ id: string; label: string }> }> }>;
    const { NODE_CATALOG } = await dynamicImport('/src/lib/constants/nodeCatalog.ts');
    return NODE_CATALOG;
  });
  expect(catalog.map((item) => item.type).sort()).toEqual(V1_NODE_TYPES);
  expect(catalog).toHaveLength(13);

  const schedule = catalog.find((item) => item.type === 'trigger.schedule');
  expect(schedule?.defaultConfig).toEqual({ cron: '0 0 9 * * *', timezone: 'Asia/Ho_Chi_Minh' });

  const condition = catalog.find((item) => item.type === 'logic.condition');
  expect(condition?.defaultConfig).toEqual({ left: '', operator: 'eq', right: '' });
  expect(condition?.sourcePorts).toEqual([
    { id: 'true', label: 'True' },
    { id: 'false', label: 'False' },
  ]);

  const webhook = catalog.find((item) => item.type === 'trigger.webhook');
  expect(webhook?.defaultConfig).not.toHaveProperty('path');
  expect(catalog.find((item) => item.type === 'google.sheets')?.defaultConfig.connectionId).toBe('');
  expect(JSON.stringify(catalog)).not.toContain('$json');
  expect(JSON.stringify(catalog)).not.toContain('google-workspace');
  expect(catalog.some((item) => ['agent.task', 'google.docs', 'logic.filter'].includes(item.type))).toBe(false);
});

test('builder palette derives from the catalog and offers exactly the V1 node set', async ({ page }) => {
  await page.goto('/workflows/wf-001/builder');

  const paletteItems = page.getByTestId('workflow-palette-item');
  await expect(paletteItems).toHaveCount(13);
  const paletteTypes = await paletteItems.evaluateAll((items) =>
    items
      .map((item) => (item as unknown as { getAttribute: (name: string) => string | null }).getAttribute('data-node-type'))
      .filter((type): type is string => Boolean(type))
      .sort()
  );
  expect(paletteTypes).toEqual(V1_NODE_TYPES);
  await expect(page.getByTestId('workflow-palette-count')).toContainText('13');
  await expect(page.locator('[data-node-type="agent.task"]')).toHaveCount(0);
  await expect(page.locator('[data-node-type="google.docs"]')).toHaveCount(0);
  await expect(page.locator('[data-node-type="logic.filter"]')).toHaveCount(0);
});

test('shows unavailable draft badges and keeps preview separate from a V1 run', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/workflows/wf-001/builder');

  const webhook = page.locator('[data-node-type="trigger.webhook"][data-testid="workflow-node"]');
  await expect(webhook).toHaveAttribute('data-readiness', 'draft');
  await expect(webhook).toHaveAttribute('data-status', 'idle');
  await expect(webhook.getByTestId('workflow-node-readiness')).toHaveText('Not published');

  const ai = page.locator('[data-node-type="ai.extract"][data-testid="workflow-node"]');
  await expect(ai).toHaveAttribute('data-readiness', 'unavailable');
  await expect(ai).toHaveAttribute('data-status', 'idle');
  await expect(ai.getByTestId('workflow-node-readiness')).toHaveText('Unavailable');

  const condition = page.locator('[data-node-type="logic.condition"][data-testid="workflow-node"]');
  await expect(condition).toHaveAttribute('data-readiness', 'not-configured');
  await expect(condition.getByTestId('workflow-node-readiness')).toHaveText('Not configured');
  await expect(page.getByTestId('workflow-telemetry-empty')).toContainText('No execution telemetry');
  await expect(page.getByText(/#EX-8492|Webhook validated|120ms|850ms|45ms|210ms/)).toHaveCount(0);

  const preview = page.getByRole('button', { name: 'Preview workflow (visual only)' }).first();
  await expect(page.getByRole('button', { name: 'Run test workflow' })).toHaveCount(0);
  await preview.click();
  await expect(page.getByTestId('execution-edge-active')).toBeVisible();
  await expect(ai).toHaveAttribute('data-status', 'idle');
  await expect(page.locator('[data-node-type="email.send"][data-testid="workflow-node"]'))
    .toHaveAttribute('data-status', 'idle');
  await expect(page.getByTestId('workflow-telemetry-preview-notice'))
    .toContainText('does not call the Workflow Service or node integrations');
  await expect(page.getByText(/Workflow finished successfully|Resolved 4 schema parameters/)).toHaveCount(0);
});

test('schedule and webhook inspectors use system-managed V1 inputs', async ({ page }) => {
  await page.goto('/workflows/wf-001/builder');

  await page.locator('[data-testid="workflow-palette-item"][data-node-type="trigger.schedule"]').click();
  const schedule = page.getByTestId('workflow-inspector');
  await expect(schedule.getByTestId('schedule-cron')).toHaveValue('0 0 9 * * *');
  await expect(schedule.getByTestId('schedule-timezone')).toHaveValue('Asia/Ho_Chi_Minh');
  await schedule.getByTestId('schedule-cron').fill('0 15 8 * * MON-FRI');
  await schedule.getByTestId('schedule-timezone').fill('Asia/Ho_Chi_Minh');

  await page.getByTestId('rf__node-node-webhook').getByTestId('workflow-node').click();
  const webhook = page.getByTestId('workflow-inspector');
  await expect(webhook.getByTestId('webhook-endpoint-readiness')).toContainText('system-managed');
  await expect(webhook.getByTestId('webhook-config')).toContainText('does not choose a public path');
  await expect(webhook.locator('input[name="path"]')).toHaveCount(0);
  await expect(webhook.locator('input[name="endpoint"]')).toHaveCount(0);
});

test('condition editor is declarative and both branch ports survive editor reload mapping', async ({ page }, testInfo) => {
  await page.goto('/workflows/wf-001/builder');
  await page.getByTestId('rf__node-node-condition').getByTestId('workflow-node').click();

  const inspector = page.getByTestId('workflow-inspector');
  await expect(inspector.getByTestId('condition-left')).toHaveValue('');
  await expect(inspector.getByTestId('condition-operator')).toHaveValue('eq');
  await expect(inspector.getByTestId('condition-operator').locator('option')).toHaveCount(6);
  await expect(inspector.getByTestId('condition-right')).toHaveValue('');
  await inspector.getByTestId('condition-left').fill('{{ nodes.extract_order_v1.output.extractedJson.total_amount }}');
  await inspector.getByTestId('condition-operator').selectOption('gt');
  await inspector.getByTestId('condition-right').fill('500');
  await expect(inspector.getByLabel(/javascript|code|script/i)).toHaveCount(0);

  const conditionNode = page.getByTestId('workflow-node').filter({ hasText: 'If / Condition' }).last();
  await expect(conditionNode.getByTestId('condition-source-true')).toBeVisible();
  await expect(conditionNode.getByTestId('condition-source-false')).toBeVisible();

  const workflow: WorkflowFixture = {
    id: 'workflow-v1-condition',
    name: 'Condition branch round-trip',
    status: 'DRAFT',
    version: 1,
    triggerType: 'MANUAL',
    nodes: [
      { id: 'condition', type: 'logic.condition', name: 'Condition', config: { left: '{{ trigger.input.amount }}', operator: 'gt', right: 500 } },
      { id: 'accepted', type: 'http.request', name: 'Accepted', config: {} },
      { id: 'rejected', type: 'http.request', name: 'Rejected', config: {} },
    ],
    edges: [],
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
    ownerName: 'Test owner',
    workspaceId: 'test-workspace',
  };
  const mappedEdges = await page.evaluate(async (definition) => {
    const dynamicImport = new Function('modulePath', 'return import(modulePath)') as (
      modulePath: string,
    ) => Promise<{
      reactFlowToWorkflow: (nodes: unknown[], edges: unknown[], workflow: WorkflowFixture) => WorkflowFixture;
      workflowToReactFlow: (workflow: WorkflowFixture) => { nodes: unknown[]; edges: Array<{ sourceHandle?: string; targetHandle?: string }> };
    }>;
    const mapper = await dynamicImport('/src/lib/mappers/workflowMapper.ts');
    const flowNodes = mapper.workflowToReactFlow(definition).nodes;
    const flowEdges = [
    { id: 'true-edge', source: 'condition', sourceHandle: 'true', target: 'accepted' },
    { id: 'false-edge', source: 'condition', sourceHandle: 'false', target: 'rejected' },
    ];
    const savedDraft = mapper.reactFlowToWorkflow(flowNodes, flowEdges, definition);
    const reloadedDraft = JSON.parse(JSON.stringify(savedDraft)) as WorkflowFixture;
    const reloadedEdges = mapper.workflowToReactFlow(reloadedDraft).edges;
    return {
      sourcePorts: savedDraft.edges.map((edge) => edge.sourcePort),
      sourceHandles: reloadedEdges.map((edge) => edge.sourceHandle),
    };
  }, workflow);
  expect(mappedEdges.sourcePorts).toEqual(['true', 'false']);
  expect(mappedEdges.sourceHandles).toEqual(['true', 'false']);

  await page.screenshot({ path: testInfo.outputPath('workflow-condition-v1.png'), fullPage: true });
});

test('unconfigured integrations remain visible and cannot be published as ready', async ({ page }) => {
  await page.goto('/workflows/wf-001/builder');
  await page.locator('[data-node-type="google.sheets"]').click();

  const inspector = page.getByTestId('workflow-inspector');
  await expect(inspector.getByTestId('google-connection')).toHaveValue('');
  await expect(inspector.getByTestId('integration-readiness')).toContainText('Not configured');
  await expect(page.getByTestId('workflow-publish')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

  await page.locator('[data-node-type="trigger.telegram"]').click();
  await expect(page.getByTestId('integration-readiness')).toContainText('Bot Service trigger contract');
  await expect(page.getByTestId('workflow-publish')).toBeDisabled();
});

test('OCR draft source allows one source at a time and exposes the closed production gate', async ({ page }) => {
  await page.goto('/workflows/wf-001/builder');
  await page.locator('[data-node-type="ocr.extract"]').click();

  const inspector = page.getByTestId('workflow-inspector');
  await expect(inspector.getByTestId('ocr-artifact-id')).toHaveValue('');
  await expect(inspector.getByTestId('ocr-file-url')).toHaveValue('');
  await expect(inspector.getByTestId('integration-readiness')).toContainText('URL allowlist');
  await inspector.getByTestId('ocr-artifact-id').fill('1b24b7f4-c277-4475-a44f-a2492d0a4bf3');
  await expect(inspector.getByTestId('ocr-file-url')).toHaveValue('');
  await inspector.getByTestId('ocr-file-url').fill('https://files.example.test/invoice.pdf');
  await expect(inspector.getByTestId('ocr-artifact-id')).toHaveValue('');
});

test('legacy unsupported node data survives the editor mapper unchanged', async ({ page }) => {
  await page.goto('/workflows/wf-001/builder');
  const legacy: WorkflowFixture = {
    id: 'workflow-legacy-draft',
    name: 'Legacy draft',
    status: 'DRAFT',
    version: 2,
    triggerType: 'MANUAL',
    nodes: [
      { id: 'old-docs', type: 'google.docs', name: 'Old Docs action', config: { documentId: 'kept-document-id', contentVariable: '{{ nodes.old.output.data }}' } },
      { id: 'old-agent', type: 'agent.task', name: 'Old agent action', config: { goal: 'Keep this saved value' } },
    ],
    edges: [],
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
    ownerName: 'Test owner',
    workspaceId: 'test-workspace',
  };
  const mappedNodes = await page.evaluate(async (definition) => {
    const dynamicImport = new Function('modulePath', 'return import(modulePath)') as (
      modulePath: string,
    ) => Promise<{
      reactFlowToWorkflow: (nodes: unknown[], edges: unknown[], workflow: WorkflowFixture) => WorkflowFixture;
      workflowToReactFlow: (workflow: WorkflowFixture) => { nodes: unknown[]; edges: unknown[] };
    }>;
    const mapper = await dynamicImport('/src/lib/mappers/workflowMapper.ts');
    const editorState = mapper.workflowToReactFlow(definition);
    return mapper.reactFlowToWorkflow(editorState.nodes, editorState.edges, definition).nodes;
  }, legacy);
  expect(mappedNodes.map(({ id, type, name, config }) => ({ id, type, name, config }))).toEqual(legacy.nodes);
});
