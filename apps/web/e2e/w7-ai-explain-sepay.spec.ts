import { expect, test, type Page, type Route } from '@playwright/test';
import { WORKFLOW_TEMPLATES, templateToDraft } from '../src/lib/templates/index.js';

const WS = '00000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000001';
const WF = '30000000-0000-4000-8000-000000000001';
const RUN = '40000000-0000-4000-8000-000000000001';
const CONVERSATION = '30000000-0000-4000-8000-00000000000c';

const user = {
  id: USER, email: 'owner@example.test', displayName: 'Workspace Owner', avatarUrl: null, systemRole: 'USER',
  status: 'ACTIVE', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', emailVerifiedAt: null,
};
const workspace = { id: WS, name: 'Alpha', createdBy: USER, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' };
const workflow = {
  workflowId: WF, name: 'Reply to webhook', status: 'PUBLISHED', currentVersionId: '50000000-0000-4000-8000-000000000001',
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', publishedAt: '2026-10-01T00:00:00Z',
  definition: { schemaVersion: '1.0', nodes: [{ id: 'hook', type: 'trigger.webhook', config: {} }], edges: [], variables: {} },
  editorState: { nodes: { hook: { name: 'Webhook in', position: { x: 0, y: 0 } } } },
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function detail(status: string) {
  return {
    executionId: RUN, workflowId: WF, workflowVersionId: workflow.currentVersionId, status, triggerType: 'MANUAL',
    createdAt: '2026-10-07T10:00:00Z', startedAt: '2026-10-07T10:00:00Z', finishedAt: '2026-10-07T10:00:03Z',
    nodes: [], logs: { items: [], page: 0, size: 100, totalElements: 0, hasNext: false },
  };
}

async function install(page: Page, status: string, chatBodies: Array<Record<string, unknown>>) {
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'w7-a3-token');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await page.route('**/api/auth/me', (route) => json(route, user));
  await page.route('**/api/v2/notifications/unread-count', (route) => json(route, { count: 0 }));
  await page.route('**/api/v1/assistant/conversations?**', (route) => json(route, { items: [] }));
  await page.route('**/api/v1/assistant/chat', (route) => {
    chatBodies.push(route.request().postDataJSON());
    const body = `event: conversation\ndata: {"conversationId":"${CONVERSATION}"}\n\nevent: delta\ndata: {"text":"Step 2 failed."}\n\nevent: done\ndata: {}\n\n`;
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await page.route('**/api/v1/workspaces**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/v1/workspaces') return json(route, { items: [workspace], page: 0, size: 20, totalElements: 1, totalPages: 1 });
    if (pathname === `/api/v1/workspaces/${WS}`) return json(route, workspace);
    if (pathname === `/api/v1/workspaces/${WS}/members`) return json(route, { items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
    if (pathname === `/api/v1/workspaces/${WS}/workflows`) {
      const summary: Record<string, unknown> = { ...workflow, triggerTypes: ['trigger.webhook'] };
      delete summary.definition;
      delete summary.editorState;
      return json(route, { items: [summary], page: 0, size: 100, totalElements: 1, totalPages: 1 });
    }
    if (pathname === `/api/v1/workspaces/${WS}/workflows/${WF}`) return json(route, workflow);
    if (pathname === `/api/v1/workspaces/${WS}/workflows/${WF}/executions`) {
      return json(route, { items: [{ ...detail(status), nodes: undefined, logs: undefined }], page: 0, size: 100, totalElements: 1, totalPages: 1 });
    }
    if (pathname === `/api/v1/workspaces/${WS}/workflows/${WF}/executions/${RUN}`) return json(route, detail(status));
    return json(route, { error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  });
}

const openRun = (page: Page) => page.goto(`/workflows/${WF}/executions?run=${RUN}`);

test.describe('Ask AI why a run failed', () => {
  test('the button shows for a FAILED run only', async ({ page }) => {
    await install(page, 'SUCCESS', []);
    await openRun(page);
    await expect(page.getByTestId('execution-status')).toHaveText('Success');
    await expect(page.getByTestId('execution-ask-ai')).toHaveCount(0);

    const failed = await page.context().newPage();
    await install(failed, 'FAILED', []);
    await openRun(failed);
    await expect(failed.getByTestId('execution-status')).toHaveText('Failed');
    await expect(failed.getByTestId('execution-ask-ai')).toHaveText('Ask AI why it failed');
  });

  test('click opens the assistant, sends exactly one message with both ids, reload does not resend', async ({ page }) => {
    const chatBodies: Array<Record<string, unknown>> = [];
    await install(page, 'FAILED', chatBodies);
    await openRun(page);
    await page.getByTestId('execution-ask-ai').click();

    await expect(page).toHaveURL(/\/assistant$/);
    await expect(page.getByTestId('assistant-message-assistant')).toContainText('Step 2 failed.');
    expect(chatBodies).toHaveLength(1);
    expect(String(chatBodies[0].message)).toContain(RUN);
    expect(String(chatBodies[0].message)).toContain(WF);
    expect(chatBodies[0].workspaceId).toBe(WS);

    await page.reload();
    await expect(page.getByTestId('assistant-page')).toBeVisible();
    await page.waitForTimeout(500);
    expect(chatBodies).toHaveLength(1);
    await expect(page.getByTestId('assistant-message-user')).toHaveCount(0);
  });
});

test.describe('SePay template', () => {
  test('creates a draft with 4 nodes, a true-branch edge and no connection or chat ids', () => {
    const template = WORKFLOW_TEMPLATES.find((item) => item.id === 'sepay-payment-to-sheets-telegram');
    expect(template).toBeDefined();
    const body = templateToDraft(template!, template!.vi.name);
    expect(body.definition.nodes.map((node) => node.type)).toEqual(['trigger.webhook', 'logic.condition', 'google.sheets', 'telegram.send_message']);
    expect(body.definition.edges.map((edge) => ('sourcePort' in edge ? edge.sourcePort : undefined))).toEqual([undefined, 'true', undefined]);
    const configs = body.definition.nodes.map((node) => node.config);
    expect(configs[1]).toEqual({ left: '{{ trigger.input.transferType }}', operator: 'eq', right: 'in' });
    expect(JSON.stringify(configs)).not.toMatch(/connectionId|chatId|spreadsheetId/);
    expect(JSON.stringify(configs[2])).toContain('trigger.input.referenceCode');
    expect(JSON.stringify(configs[3])).toContain('trigger.input.transferAmount');
    expect(template!.vi.description).toContain('SePay');
    expect(template!.en.description).toContain('SePay');
  });
});
