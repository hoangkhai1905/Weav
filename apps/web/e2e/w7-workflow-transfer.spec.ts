import { expect, test, type Page, type Route } from '@playwright/test';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000010';
const existingId = '00000000-0000-4000-8000-0000000000f1';
const createdId = '00000000-0000-4000-8000-0000000000f2';
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const definition = {
  schemaVersion: '1.0',
  nodes: [
    { id: 'manual', type: 'trigger.manual', config: {} },
    { id: 'email', type: 'email.send', config: { subject: 'Weekly', body: 'Hi' } },
  ],
  edges: [{ id: 'manual-email', source: 'manual', target: 'email' }],
  variables: {},
};
const editorState = { nodes: { manual: { name: 'Start', position: { x: 0, y: 0 } }, email: { name: 'Send report', position: { x: 320, y: 0 } } } };

const detail = (id: string, name: string) => ({
  workflowId: id, name, status: 'DRAFT', schemaVersion: '1.0', currentVersionId: null,
  createdAt: iso(900), updatedAt: iso(900), definition, editorState,
});

interface Stub {
  creates: Array<Record<string, unknown>>;
  drafts: Array<Record<string, unknown>>;
  deletes: string[];
  draftStatus: number;
  deleteStatus: number;
  paths: string[];
  preview: Record<string, unknown>;
  previewStatus: number;
}

async function setup(page: Page): Promise<Stub> {
  const stub: Stub = { creates: [], drafts: [], deletes: [], draftStatus: 200, deleteStatus: 204, paths: [], preview: { definition, editorState, removedFields: [], warnings: [], existing: null }, previewStatus: 200 };
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'playwright-transfer-token');
    localStorage.setItem('weav_lang_v1', 'VI');
  });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const base = `/api/v1/workspaces/${workspaceId}/workflows`;
    if (path === '/api/auth/me') return json(route, { id: userId, email: 'owner@example.test', displayName: 'Owner Name' });
    if (path === '/api/v1/workspaces') {
      return json(route, {
        items: [{ id: workspaceId, name: 'Transfer Workspace', createdBy: userId, createdAt: iso(99_999), updatedAt: iso(99_999), role: 'OWNER' }],
        page: 0, size: 100, totalElements: 1, totalPages: 1,
      });
    }
    if (path.includes('/notifications')) return json(route, path.includes('unread') ? { unreadCount: 0 } : { items: [], nextCursor: null });
    if (path === base && method === 'POST') {
      stub.creates.push(request.postDataJSON() as Record<string, unknown>);
      stub.paths.push(path);
      return json(route, { workflowId: createdId }, 201);
    }
    if (path === base) {
      return json(route, {
        items: [{ workflowId: existingId, name: 'Mail report', status: 'DRAFT', createdAt: iso(900), updatedAt: iso(900) }],
        page: 0, size: 100, totalElements: 1, totalPages: 1,
      });
    }
    if (path === `${base}/${createdId}/draft` && method === 'PUT') {
      stub.drafts.push(request.postDataJSON() as Record<string, unknown>);
      stub.paths.push(path);
      if (stub.draftStatus !== 200) return json(route, { error: { code: 'WORKFLOW_VALIDATION_FAILED', message: 'Quy trình không hợp lệ' } }, stub.draftStatus);
      return json(route, detail(createdId, 'imported'));
    }
    if (path === `${base}/${createdId}` && method === 'DELETE') {
      stub.deletes.push(createdId);
      stub.paths.push(path);
      if (stub.deleteStatus !== 204) return json(route, { error: { code: 'INTERNAL', message: 'boom' } }, stub.deleteStatus);
      return route.fulfill({ status: 204 });
    }
    if (path === `${base}/${createdId}`) return json(route, detail(createdId, 'imported'));
    if (path === `${base}/${existingId}/template/preview`) {
      if (stub.previewStatus !== 200) return json(route, { error: { code: 'TEMPLATE_NODE_NOT_SHAREABLE', message: 'Node không thể chia sẻ' } }, stub.previewStatus);
      return json(route, stub.preview);
    }
    if (path === `${base}/${existingId}`) return json(route, detail(existingId, 'Mail report'));
    return json(route, { items: [], page: 0, size: 20, totalElements: 0 });
  });
  return stub;
}

const fileOf = (body: unknown) => ({ name: 'wf.json', mimeType: 'application/json', buffer: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) });
const validFile = { format: 'weav.workflow', version: 1, exportedAt: iso(1), name: 'Weekly mail', description: 'desc', definition, editorState };

test.describe('workflows page: new workflow', () => {
  test('New workflow opens the create page and creates nothing', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/workflows');
    await page.locator('header').getByRole('button', { name: 'Tạo quy trình' }).click();
    await expect(page).toHaveURL(/\/workflows\/new$/);
    expect(stub.creates).toEqual([]);
  });
});

test.describe('workflow export', () => {
  test('downloads the sanitized workflow as weav-<slug>.json', async ({ page }) => {
    await setup(page);
    await page.goto(`/workflows/${existingId}/builder`);
    await expect(page.getByTestId('workflow-title')).toHaveValue('Mail report');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('workflow-export-json').click()]);
    expect(download.suggestedFilename()).toBe('weav-mail-report.json');
    const text = await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8');
    const file = JSON.parse(text);
    expect(file).toMatchObject({ format: 'weav.workflow', version: 1, name: 'Mail report', description: null, definition, editorState });
    expect(typeof file.exportedAt).toBe('string');
    expect(text).not.toContain('connectionId');
  });
});

test.describe('workflow export feedback', () => {
  test('warns when the sanitizer left emails or tokens in free text', async ({ page }) => {
    const stub = await setup(page);
    stub.preview = { definition, editorState, removedFields: [], warnings: [{ nodeId: 'email', field: 'body', reason: 'EMAIL' }], existing: null };
    await page.goto(`/workflows/${existingId}/builder`);
    await expect(page.getByTestId('workflow-title')).toHaveValue('Mail report');
    await Promise.all([page.waitForEvent('download'), page.getByTestId('workflow-export-json').click()]);
    await expect(page.getByText('Tệp có thể chứa email hoặc mã bí mật trong nội dung. Hãy kiểm tra trước khi chia sẻ.')).toBeVisible();
  });

  test('shows the server reason when the export preview is refused', async ({ page }) => {
    const stub = await setup(page);
    stub.previewStatus = 422;
    await page.goto(`/workflows/${existingId}/builder`);
    await expect(page.getByTestId('workflow-title')).toHaveValue('Mail report');
    await page.getByTestId('workflow-export-json').click();
    await expect(page.getByText('Node không thể chia sẻ')).toBeVisible();
  });
});

test.describe('workflow import', () => {
  test('valid file creates one workflow, saves one draft, opens the builder', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/workflows');
    await page.getByTestId('workflow-import-input').setInputFiles(fileOf(validFile));
    await expect(page).toHaveURL(new RegExp(`/workflows/${createdId}/builder$`));
    expect(stub.creates).toEqual([{ name: 'Weekly mail (đã nhập)', description: 'desc' }]);
    expect(stub.drafts).toHaveLength(1);
    expect(stub.drafts[0]).toMatchObject({ definition, editorState });
    expect(stub.deletes).toEqual([]);
    const prefix = `/api/v1/workspaces/${workspaceId}/workflows`;
    expect(stub.paths).toEqual([prefix, `${prefix}/${createdId}/draft`]);
  });

  test('forwards only known keys, trims and caps the description', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/workflows');
    const messy = {
      ...validFile,
      description: `  ${'d'.repeat(2100)}  `,
      definition: { ...definition, secret: 'x' },
      editorState: { nodes: { manual: { name: 'Start', position: { x: 1, y: 2 }, junk: 1 }, bad: { name: 5 } }, extra: true },
      hacked: true,
    };
    await page.getByTestId('workflow-import-input').setInputFiles(fileOf(messy));
    await expect(page).toHaveURL(new RegExp(`/workflows/${createdId}/builder$`));
    expect(stub.drafts[0]).toEqual({
      name: 'imported',
      description: 'd'.repeat(2000),
      definition,
      editorState: { nodes: { manual: { name: 'Start', position: { x: 1, y: 2 } } } },
    });
  });

  test('two quick selections create exactly one workflow', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/workflows');
    const input = page.getByTestId('workflow-import-input');
    await input.setInputFiles(fileOf(validFile));
    await input.setInputFiles(fileOf(validFile));
    await expect(page).toHaveURL(new RegExp(`/workflows/${createdId}/builder$`));
    expect(stub.creates).toHaveLength(1);
  });

  const invalid: Array<[string, unknown, string]> = [
    ['wrong format', { ...validFile, format: 'other' }, 'không phải tệp quy trình Weav'],
    ['version 2', { ...validFile, version: 2 }, 'phiên bản'],
    ['nodes not an array', { ...validFile, definition: { ...definition, nodes: {} } }, 'định nghĩa'],
    ['not json', 'not json {', 'JSON'],
    ['over 1 MB', JSON.stringify({ ...validFile, pad: 'x'.repeat(1024 * 1024) }), '1 MB'],
  ];
  for (const [label, body, message] of invalid) {
    test(`rejects ${label} without any API call`, async ({ page }) => {
      const stub = await setup(page);
      await page.goto('/workflows');
      await page.getByTestId('workflow-import-input').setInputFiles(fileOf(body));
      await expect(page.getByTestId('workflow-api-error')).toContainText(message);
      expect(stub.creates).toEqual([]);
      expect(stub.drafts).toEqual([]);
      expect(stub.deletes).toEqual([]);
      await expect(page).toHaveURL(/\/workflows$/);
    });
  }

  test('rejected draft deletes the created workflow and shows the error', async ({ page }) => {
    const stub = await setup(page);
    stub.draftStatus = 400;
    await page.goto('/workflows');
    await page.getByTestId('workflow-import-input').setInputFiles(fileOf(validFile));
    await expect(page.getByTestId('workflow-api-error')).toContainText('Quy trình không hợp lệ');
    expect(stub.creates).toHaveLength(1);
    expect(stub.deletes).toEqual([createdId]);
    const prefix = `/api/v1/workspaces/${workspaceId}/workflows`;
    expect(stub.paths).toEqual([prefix, `${prefix}/${createdId}/draft`, `${prefix}/${createdId}`]);
    await expect(page).toHaveURL(/\/workflows$/);
  });

  test('tells the user when the cleanup delete also fails', async ({ page }) => {
    const stub = await setup(page);
    stub.draftStatus = 400;
    stub.deleteStatus = 500;
    await page.goto('/workflows');
    await page.getByTestId('workflow-import-input').setInputFiles(fileOf(validFile));
    await expect(page.getByTestId('workflow-api-error')).toContainText('Một quy trình trống đã được tạo, hãy xóa nó.');
    expect(stub.deletes).toEqual([createdId]);
  });
});
