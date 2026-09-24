import { expect, test } from '@playwright/test';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workflowId = '00000000-0000-4000-8000-000000000002';

const draft = (status: 'DRAFT' | 'PUBLISHED' = 'DRAFT') => ({
  workflowId,
  name: 'Real API workflow',
  description: 'Loaded from Workflow Service',
  status,
  schemaVersion: '1.0',
  definition: {
    schemaVersion: '1.0',
    nodes: [{ id: 'manual', type: 'trigger.manual', config: {} }],
    edges: [],
    variables: {},
  },
  editorState: { nodes: { manual: { name: 'Manual trigger', position: { x: 100, y: 120 } } } },
  currentVersionId: null,
  createdAt: '2026-09-24T10:00:00Z',
  updatedAt: '2026-09-24T10:00:00Z',
  publishedAt: null,
  triggers: [],
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'playwright-test-token');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: '00000000-0000-4000-8000-000000000010',
      email: 'test@example.test',
      displayName: 'Playwright User',
    }),
  }));
  await page.route('**/api/v1/workspaces**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      items: [{ id: workspaceId, name: 'Real Workspace', role: 'OWNER' }],
      page: 0,
      size: 100,
      totalElements: 1,
      totalPages: 1,
    }),
  }));
});

test('workflow list comes from the authenticated API, not seeded browser data', async ({ page }) => {
  let listRequests = 0;
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows**`, (route) => {
    listRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          workflowId,
          name: 'Real API workflow',
          description: 'Loaded from Workflow Service',
          status: 'DRAFT',
          schemaVersion: '1.0',
          currentVersionId: null,
          createdAt: '2026-09-24T10:00:00Z',
          updatedAt: '2026-09-24T10:00:00Z',
          publishedAt: null,
        }],
        page: 0,
        size: 100,
        totalElements: 1,
      }),
    });
  });

  await page.goto('/workflows');

  await expect(page.getByText('Real API workflow', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Invoice OCR → AI Extract → Google Sheets', { exact: true })).toHaveCount(0);
  expect(listRequests).toBeGreaterThan(0);
});

test('builder loads a real draft and sends executable definition separately from editor layout', async ({ page }) => {
  const savedBodies: Array<Record<string, unknown>> = [];
  let currentDraft = draft();

  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentDraft) }),
  );
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/draft`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    savedBodies.push(body);
    currentDraft = { ...currentDraft, ...body, updatedAt: '2026-09-24T10:01:00Z' } as typeof currentDraft;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentDraft) });
  });

  await page.goto(`/workflows/${workflowId}/builder`);
  await expect(page.getByTestId('workflow-title')).toHaveValue('Real API workflow');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => savedBodies.length).toBe(1);

  const saved = savedBodies[0];
  expect(saved.name).toBe('Real API workflow');
  expect(saved.definition).toMatchObject({ schemaVersion: '1.0', nodes: [{ id: 'manual', type: 'trigger.manual' }], edges: [] });
  expect(JSON.stringify(saved.definition)).not.toContain('position');
  expect(saved.editorState).toMatchObject({ nodes: { manual: { position: { x: 100, y: 120 } } } });
});

test('execution history loads service data and queues reruns through the real API contract', async ({ page }) => {
  let manualRunBody: unknown;
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows?page=0&size=100`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [{ workflowId, name: 'Real API workflow', status: 'PUBLISHED' }], page: 0, size: 100, totalElements: 1 }),
  }));
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/executions?page=0&size=100`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      items: [{
        executionId: '00000000-0000-4000-8000-000000000003',
        workflowId,
        workflowVersionId: '00000000-0000-4000-8000-000000000004',
        status: 'SUCCESS',
        triggerType: 'MANUAL',
        createdAt: '2026-09-24T10:00:00Z',
        startedAt: '2026-09-24T10:00:01Z',
        finishedAt: '2026-09-24T10:00:02Z',
      }],
      page: 0,
      size: 100,
      totalElements: 1,
    }),
  }));
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(draft('PUBLISHED')),
  }));
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/executions`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    manualRunBody = route.request().postDataJSON();
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ executionId: '00000000-0000-4000-8000-000000000005', workflowId, workflowVersionId: '00000000-0000-4000-8000-000000000004', status: 'QUEUED' }),
    });
  });

  await page.goto('/executions');
  await expect(page.getByText('00000000-0000-4000-8000-000000000003', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Real API workflow' })).toBeVisible();
  await expect(page.getByText('Order processing & notification', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Run again' }).click();
  await expect.poll(() => manualRunBody).toEqual({ input: {} });
  await expect(page.getByRole('status')).toContainText('00000000-0000-4000-8000-000000000005');
});

test('execution detail renders service node results and logs, without falling back to seeded telemetry', async ({ page }) => {
  const executionId = '00000000-0000-4000-8000-000000000003';
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(draft('PUBLISHED')),
  }));
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/executions/${executionId}?logPage=0&logSize=100`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      executionId,
      workflowId,
      workflowVersionId: '00000000-0000-4000-8000-000000000004',
      status: 'FAILED',
      triggerType: 'MANUAL',
      createdAt: '2026-09-24T10:00:00Z',
      startedAt: '2026-09-24T10:00:01Z',
      finishedAt: '2026-09-24T10:00:02Z',
      nodes: [{
        nodeExecutionId: '00000000-0000-4000-8000-000000000006',
        nodeId: 'manual',
        nodeType: 'trigger.manual',
        status: 'FAILED',
        attemptCount: 1,
        startedAt: '2026-09-24T10:00:01Z',
        finishedAt: '2026-09-24T10:00:02Z',
        output: null,
        error: { message: 'fixture failure' },
        attempts: [],
      }],
      logs: {
        items: [{
          id: '00000000-0000-4000-8000-000000000007',
          nodeExecutionId: '00000000-0000-4000-8000-000000000006',
          attemptId: null,
          level: 'ERROR',
          eventType: 'NODE_FAILED',
          message: 'API fixture failure log',
          metadata: { source: 'workflow-service' },
          createdAt: '2026-09-24T10:00:02Z',
        }],
        page: 0,
        size: 100,
        totalElements: 1,
        hasNext: false,
      },
    }),
  }));

  await page.goto(`/executions/${executionId}?workflowId=${workflowId}`);
  await expect(page.getByText('API fixture failure log', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').nth(1)).toContainText('fixture failure');
  await expect(page.getByText('Order processing & notification', { exact: true })).toHaveCount(0);
});
