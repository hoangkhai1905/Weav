import { expect, test, type Page, type Route } from '@playwright/test';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workflowId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000010';

type Status = 'DRAFT' | 'PUBLISHED' | 'PAUSED';

const detail = (status: Status, name = 'Editor controls workflow', description = 'Fixture') => ({
  workflowId,
  name,
  description,
  status,
  schemaVersion: '1.0',
  definition: {
    schemaVersion: '1.0',
    nodes: [
      { id: 'manual', type: 'trigger.manual', config: {} },
      { id: 'http', type: 'http.request', config: { url: 'https://example.test', method: 'GET' } },
    ],
    edges: [{ id: 'e1', source: 'manual', target: 'http' }],
    variables: {},
  },
  editorState: {
    nodes: {
      manual: { name: 'Manual trigger', position: { x: 80, y: 160 } },
      http: { name: 'Fetch data', position: { x: 380, y: 160 } },
    },
  },
  currentVersionId: null,
  createdAt: '2026-09-24T10:00:00Z',
  updatedAt: '2026-09-24T10:00:00Z',
  publishedAt: null,
  triggers: [],
});

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function setup(page: Page, initial: Status) {
  const state = { current: detail(initial), posts: [] as string[], puts: [] as Record<string, unknown>[] };
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'playwright-test-token');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await page.route('**/api/auth/me', (route) => json(route, { id: userId, email: 'test@example.test', displayName: 'Playwright User' }));
  await page.route('**/api/v1/workspaces?**', (route) => json(route, {
    items: [{ id: workspaceId, name: 'Real Workspace', createdBy: userId, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', role: 'OWNER' }],
    page: 0, size: 100, totalElements: 1, totalPages: 1,
  }));
  await page.route(`**/api/v1/workspaces/${workspaceId}/connections**`, (route) => json(route, []));
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/pause`, (route) => {
    state.posts.push('pause');
    state.current = detail('PAUSED', state.current.name);
    return json(route, {});
  });
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/resume`, (route) => {
    state.posts.push('resume');
    state.current = detail('PUBLISHED', state.current.name);
    return json(route, {});
  });
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/draft`, (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.puts.push(body);
    state.current = { ...state.current, ...body, updatedAt: '2026-09-24T10:05:00Z' } as ReturnType<typeof detail>;
    return json(route, state.current);
  });
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}`, (route) => json(route, state.current));
  return state;
}

test.describe('editor controls', () => {
  test('active switch asks before turning a published workflow off and resumes without a prompt', async ({ page }) => {
    const state = await setup(page, 'PUBLISHED');
    await page.goto(`/workflows/${workflowId}/builder`);
    const toggle = page.getByTestId('workflow-active-switch');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await toggle.click();
    await expect(page.getByText('Turn this workflow off?')).toBeVisible();
    await expect(page.getByText(/webhooks reject new requests/)).toBeVisible();
    expect(state.posts).toEqual([]);
    await page.getByRole('button', { name: 'Turn off', exact: true }).click();
    await expect.poll(() => state.posts).toEqual(['pause']);
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.click();
    await expect.poll(() => state.posts).toEqual(['pause', 'resume']);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Turn this workflow off?')).toHaveCount(0);
  });

  test('active switch rolls back when pause fails', async ({ page }) => {
    await setup(page, 'PUBLISHED');
    await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/pause`, (route) => json(route, { code: 'INTERNAL', message: 'boom' }, 500));
    await page.goto(`/workflows/${workflowId}/builder`);
    const toggle = page.getByTestId('workflow-active-switch');
    await toggle.click();
    await page.getByRole('button', { name: 'Turn off', exact: true }).click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('workflow-builder-error')).toBeVisible();
  });

  test('a draft shows Publish and no active switch', async ({ page }) => {
    await setup(page, 'DRAFT');
    await page.goto(`/workflows/${workflowId}/builder`);
    await expect(page.getByTestId('workflow-publish')).toBeVisible();
    await expect(page.getByTestId('workflow-active-switch')).toHaveCount(0);
  });
});
