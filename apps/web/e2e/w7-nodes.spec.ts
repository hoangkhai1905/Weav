import { expect, test, type Page, type Route } from '@playwright/test';

// W7-A2: Slack and Teams connections, and the Slack, Teams, Format date/time and Format text steps (backend stubbed).

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workflowId = '00000000-0000-4000-8000-000000000002';
const slackConnectionId = '20000000-0000-4000-8000-000000000011';
const teamsConnectionId = '20000000-0000-4000-8000-000000000012';
const base = `**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}`;
const SLACK_URL = 'https://hooks.slack.com/services/T0123ABC/B0456DEF/syntheticSecret01';
const TEAMS_URL = 'https://prod-12.westus.logic.azure.com:443/workflows/abc123/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sig=syntheticSig';

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const connection = (id: string, provider: 'SLACK' | 'TEAMS', name: string, status: 'DISABLED' | 'ACTIVE', hasCredential: boolean) => ({
  id,
  workspaceId,
  createdBy: '00000000-0000-4000-8000-000000000010',
  name,
  provider,
  authType: 'TOKEN',
  status,
  config: null,
  hasCredential,
  credentialExpiresAt: null,
  lastVerifiedAt: null,
  canManage: true,
  canAttach: true,
  createdAt: '2026-10-10T00:00:00Z',
  updatedAt: '2026-10-10T00:00:00Z',
});

const draft = () => ({
  workflowId,
  name: 'Node bundle',
  status: 'DRAFT',
  schemaVersion: '1.0',
  definition: { schemaVersion: '1.0', nodes: [{ id: 'manual', type: 'trigger.manual', config: {} }], edges: [], variables: {} },
  editorState: { nodes: { manual: { name: 'Manual trigger', position: { x: 100, y: 120 } } } },
  currentVersionId: null,
  createdAt: '2026-10-10T10:00:00Z',
  updatedAt: '2026-10-10T10:00:00Z',
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
    items: [{ workflowId, name: 'Node bundle', status: 'DRAFT' }],
    page: 0, size: 100, totalElements: 1, totalPages: 1,
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
  await expect(page.getByTestId('workflow-title')).toHaveValue('Node bundle');
}

const savedNode = async (page: Page, drafts: Array<{ definition: { nodes: SavedNode[] } }>, type: string) => {
  const before = drafts.length;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => drafts.length).toBeGreaterThan(before);
  return drafts[drafts.length - 1].definition.nodes.find((node) => node.type === type);
};

for (const spec of [
  { provider: 'SLACK', label: 'Slack', id: slackConnectionId, url: SLACK_URL, bad: 'https://hooks.slack.com.evil.test/services/T1/B1/x' },
  { provider: 'TEAMS', label: 'Microsoft Teams', id: teamsConnectionId, url: TEAMS_URL, bad: 'https://outlook.office.com/webhook/a/IncomingWebhook/b/c' },
] as const) {
  test(`creating a ${spec.label} connection validates the webhook URL, stores it once and never shows it`, async ({ page }) => {
    await stubBackend(page);
    let created: unknown;
    let credential: unknown;
    let listed: unknown[] = [];
    await page.route(`**/api/v1/workspaces/${workspaceId}/connections`, (route) => {
      if (route.request().method() === 'GET') return json(route, listed);
      created = route.request().postDataJSON();
      listed = [connection(spec.id, spec.provider, 'Team channel', 'DISABLED', false)];
      return json(route, listed[0], 201);
    });
    await page.route(`**/api/v1/workspaces/*/connections/${spec.id}/credential`, (route) => {
      credential = route.request().postDataJSON();
      listed = [connection(spec.id, spec.provider, 'Team channel', 'DISABLED', true)];
      return json(route, listed[0]);
    });
    await page.route(`**/api/v1/workspaces/*/connections/${spec.id}/test`, (route) => {
      listed = [connection(spec.id, spec.provider, 'Team channel', 'ACTIVE', true)];
      return json(route, { outcome: 'VERIFIED' });
    });
    await page.goto('/connections');
    await page.getByTestId('connections-create-open').click();
    await page.getByTestId('connection-create-name').fill('Team channel');
    await page.getByTestId('connection-create-provider').selectOption(spec.provider);
    const url = page.getByTestId('connection-create-token');
    await expect(url).toHaveAttribute('type', 'password');

    await url.fill(spec.bad);
    await page.getByTestId('connection-create-submit').click();
    await expect(page.getByTestId('connection-create-error')).toBeVisible();
    expect(created).toBeUndefined();

    await url.fill(spec.url);
    await page.getByTestId('connection-create-submit').click();
    await expect(page.getByTestId(`connection-row-${spec.id}`)).toContainText(spec.label);
    expect(created).toEqual({ name: 'Team channel', provider: spec.provider, authType: 'TOKEN' });
    expect(credential).toEqual({ payload: { token: spec.url } });
    await expect(page.getByText(spec.url)).toHaveCount(0);
    await expect(page.getByText('syntheticS')).toHaveCount(0);
  });
}

test('the Slack and Teams steps pick a connection, count text and save their config', async ({ page }) => {
  const backend = await stubBackend(page, [
    connection(slackConnectionId, 'SLACK', 'Slack alerts', 'ACTIVE', true),
    connection(teamsConnectionId, 'TEAMS', 'Teams alerts', 'ACTIVE', true),
  ]);
  await openBuilder(page);

  await addNode(page, 'slack.send_message');
  await page.getByTestId('field-connectionId').selectOption(slackConnectionId);
  await page.getByTestId('field-text').fill('Failed: {{ trigger.input.name }}');
  await expect(page.getByTestId('content-counter')).toContainText('/4000');
  const slack = await savedNode(page, backend.drafts, 'slack.send_message');
  expect(slack?.config).toMatchObject({ connectionId: slackConnectionId, text: 'Failed: {{ trigger.input.name }}' });

  await addNode(page, 'teams.send_message');
  await page.getByTestId('field-connectionId').selectOption(teamsConnectionId);
  await page.getByTestId('field-title').fill('Alert');
  await page.getByTestId('field-text').fill('Build failed');
  const teams = await savedNode(page, backend.drafts, 'teams.send_message');
  expect(teams?.config).toMatchObject({ connectionId: teamsConnectionId, title: 'Alert', text: 'Build failed' });
});

test('the Format date and time step shows the fields of its operation and saves them', async ({ page }) => {
  const backend = await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'format.datetime');
  await expect(page.getByTestId('field-operation')).toHaveValue('now');
  await expect(page.getByTestId('field-value')).toHaveCount(0);

  await page.getByTestId('field-operation').selectOption('add');
  await page.getByTestId('field-value').fill('{{ trigger.input.date }}');
  await page.getByTestId('field-amount').fill('3');
  await page.getByTestId('field-unit').selectOption('days');
  await expect(page.getByTestId('field-pattern')).toHaveCount(0);

  await page.getByTestId('field-operation').selectOption('format');
  await page.getByTestId('field-pattern').fill('dd/MM/yyyy HH:mm');
  await page.getByTestId('field-timezone').fill('Asia/Ho_Chi_Minh');
  await page.getByTestId('field-locale').selectOption('vi');

  const node = await savedNode(page, backend.drafts, 'format.datetime');
  expect(node?.config).toMatchObject({
    operation: 'format', value: '{{ trigger.input.date }}', pattern: 'dd/MM/yyyy HH:mm', timezone: 'Asia/Ho_Chi_Minh', locale: 'vi',
  });
});

test('the Format text step shows the fields of its operation and saves them', async ({ page }) => {
  const backend = await stubBackend(page);
  await openBuilder(page);
  await addNode(page, 'format.text');
  await expect(page.getByTestId('field-operation')).toHaveValue('upper');
  await expect(page.getByTestId('field-search')).toHaveCount(0);

  await page.getByTestId('field-value').fill('{{ trigger.input.title }}');
  await page.getByTestId('field-operation').selectOption('replace');
  await page.getByTestId('field-search').fill('a.b');
  await page.getByTestId('field-replacement').fill('-');
  await expect(page.getByTestId('field-decimals')).toHaveCount(0);

  await page.getByTestId('field-operation').selectOption('number_format');
  await page.getByTestId('field-decimals').fill('2');
  await page.getByTestId('field-locale').selectOption('en');

  const node = await savedNode(page, backend.drafts, 'format.text');
  expect(node?.config).toMatchObject({ operation: 'number_format', value: '{{ trigger.input.title }}', decimals: 2, locale: 'en' });
});

const nodeBadge = (page: Page, type: string) =>
  page.locator(`[data-node-type="${type}"][data-testid="workflow-node"]`).getByTestId('workflow-node-readiness');

test('readiness badges follow the required fields of each operation and amount accepts negatives', async ({ page }) => {
  await stubBackend(page, [connection(slackConnectionId, 'SLACK', 'Slack alerts', 'ACTIVE', true)]);
  await openBuilder(page);

  await addNode(page, 'format.datetime');
  await page.getByTestId('field-operation').selectOption('add');
  await page.getByTestId('field-value').fill('2026-10-05');
  await expect(nodeBadge(page, 'format.datetime')).toHaveText('Not configured');
  await page.getByTestId('field-amount').fill('-5');
  await expect(page.getByTestId('field-amount')).toHaveValue('-5');
  await expect(page.locator('#field-format-datetime-amount-error')).toHaveCount(0);
  await page.getByTestId('field-unit').selectOption('days');
  await expect(nodeBadge(page, 'format.datetime')).toHaveText('Ready');
  await page.getByTestId('field-operation').selectOption('convert');
  await expect(nodeBadge(page, 'format.datetime')).toHaveText('Not configured');
  await page.getByTestId('field-timezone').fill('UTC');
  await expect(nodeBadge(page, 'format.datetime')).toHaveText('Ready');

  await addNode(page, 'format.text');
  await page.getByTestId('field-operation').selectOption('truncate');
  await page.getByTestId('field-value').fill('abc');
  await expect(nodeBadge(page, 'format.text')).toHaveText('Not configured');
  await page.getByTestId('field-maxLength').fill('0');
  await expect(page.locator('#field-format-text-maxLength-error')).toHaveCount(1);
  await page.getByTestId('field-maxLength').fill('5');
  await expect(nodeBadge(page, 'format.text')).toHaveText('Ready');

  await addNode(page, 'slack.send_message');
  await expect(nodeBadge(page, 'slack.send_message')).toHaveText('Not configured');
  await page.getByTestId('field-connectionId').selectOption(slackConnectionId);
  await expect(nodeBadge(page, 'slack.send_message')).toHaveText('Not configured');
  await page.getByTestId('field-text').fill('hi');
  await expect(nodeBadge(page, 'slack.send_message')).toHaveText('Ready');
});

test('a Teams webhook URL without a sig parameter is rejected before anything is sent', async ({ page }) => {
  await stubBackend(page);
  let created = false;
  await page.route(`**/api/v1/workspaces/${workspaceId}/connections`, (route) => {
    if (route.request().method() === 'GET') return json(route, []);
    created = true;
    return json(route, {}, 500);
  });
  await page.goto('/connections');
  await page.getByTestId('connections-create-open').click();
  await page.getByTestId('connection-create-name').fill('Team channel');
  await page.getByTestId('connection-create-provider').selectOption('TEAMS');
  for (const bad of [
    'https://prod-12.westus.logic.azure.com/workflows/abc123/triggers/manual/paths/invoke?api-version=2016-06-01',
    'https://prod-12.westus.logic.azure.com/workflows/abc123/triggers/manual/paths/invoke?sig=',
    'https://prod-12.westus.logic.azure.com/workflows/abc123/triggers/manual/paths/invoke?sig=x#frag',
  ]) {
    await page.getByTestId('connection-create-token').fill(bad);
    await page.getByTestId('connection-create-submit').click();
    await expect(page.getByTestId('connection-create-error')).toBeVisible();
  }
  expect(created).toBe(false);
});
