import { expect, test, type Page, type Route } from '@playwright/test';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workspaceBId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000010';
const workflowId = '00000000-0000-4000-8000-0000000000f1';
const newWorkflowId = '00000000-0000-4000-8000-0000000000f2';
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const summary = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: `${name} description`,
  authorName: 'Linh',
  nodeTypes: ['trigger.manual', 'email.send'],
  visibility: 'PUBLIC',
  usageCount: 3,
  createdAt: iso(500),
  updatedAt: iso(100),
  owned: false,
  ...extra,
});

const detail = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  ...summary(id, name),
  definition: {
    nodes: [
      { id: 'n1', type: 'trigger.manual' },
      { id: 'n2', type: 'email.send' },
      { id: 'n3', type: 'google.sheets' },
    ],
  },
  editorState: null,
  ...extra,
});

const pageOf = <T,>(items: T[]) => ({ items, page: 0, size: 12, totalElements: items.length });

interface Stub {
  templateListUrls: URL[];
  byCodeUrls: string[];
  useBodies: Array<Record<string, unknown>>;
  patchBodies: Array<Record<string, unknown>>;
  deleted: string[];
  mine: Array<ReturnType<typeof summary>>;
  shareBodies: Array<Record<string, unknown>>;
  teamWorkspaceIds: string[];
  useStatus: number;
  preview: Record<string, unknown>;
}

async function setup(page: Page): Promise<Stub> {
  const stub: Stub = {
    templateListUrls: [],
    byCodeUrls: [],
    useBodies: [],
    patchBodies: [],
    deleted: [],
    mine: [summary('t-mine', 'My template', { visibility: 'PRIVATE', owned: true })],
    shareBodies: [],
    teamWorkspaceIds: [],
    useStatus: 201,
    preview: { definition: { nodes: [] }, editorState: null, removedFields: [], warnings: [], existing: null },
  };
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'playwright-templates-token');
    localStorage.setItem('weav_lang_v1', 'VI');
  });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === '/api/auth/me') return json(route, { id: userId, email: 'owner@example.test', displayName: 'Owner Name' });
    if (path === '/api/v1/workspaces') {
      return json(route, {
        items: [
          { id: workspaceId, name: 'Templates Workspace', createdBy: userId, createdAt: iso(99_999), updatedAt: iso(99_999), role: 'OWNER' },
          { id: workspaceBId, name: 'Second Workspace', createdBy: userId, createdAt: iso(99_999), updatedAt: iso(99_999), role: 'OWNER' },
        ],
        page: 0, size: 100, totalElements: 2, totalPages: 1,
      });
    }
    if (path.includes('/notifications')) return json(route, path.includes('unread') ? { unreadCount: 0 } : { items: [], nextCursor: null });

    if (path === '/api/v1/templates' && method === 'GET') {
      stub.templateListUrls.push(url);
      const scope = url.searchParams.get('scope');
      if (scope === 'mine') return json(route, pageOf(stub.mine));
      if (scope === 'workspace') {
        const ws = url.searchParams.get('workspaceId') ?? '';
        stub.teamWorkspaceIds.push(ws);
        return json(route, pageOf([summary(ws === workspaceBId ? 't-team-b' : 't-team-a', ws === workspaceBId ? 'Team B item' : 'Team A item', { visibility: 'PRIVATE' })]));
      }
      const q = url.searchParams.get('q');
      const all = [summary('t-1', 'Invoice digest'), summary('t-2', 'Lead alerts')];
      return json(route, pageOf(q ? all.filter((item) => item.name.toLowerCase().includes(q.toLowerCase())) : all));
    }
    if (path.startsWith('/api/v1/templates/by-code/')) {
      stub.byCodeUrls.push(path);
      if (path.toLowerCase().endsWith('/nope')) return json(route, { error: { code: 'NOT_FOUND', message: 'Template not found' } }, 404);
      return json(route, detail('t-code', 'Shared by code'));
    }
    if (path === '/api/v1/templates/t-code/use' || path === '/api/v1/templates/t-1/use') {
      stub.useBodies.push(request.postDataJSON() as Record<string, unknown>);
      if (stub.useStatus !== 201) return json(route, { error: { code: 'RATE_LIMITED', message: 'Too many' } }, stub.useStatus);
      return json(route, { workflowId: newWorkflowId }, 201);
    }
    if (path === '/api/v1/templates/t-mine' && method === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      stub.patchBodies.push(body);
      stub.mine[0] = { ...stub.mine[0], ...body } as (typeof stub.mine)[number];
      return json(route, stub.mine[0]);
    }
    if (path === '/api/v1/templates/t-mine' && method === 'DELETE') {
      stub.deleted.push('t-mine');
      stub.mine = [];
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/v1/templates/t-mine' && method === 'GET') return json(route, detail('t-mine', 'My template', { owned: true, shareCode: 'WV7K3M9Q' }));
    if (path === '/api/v1/templates/t-1' && method === 'GET') return json(route, detail('t-1', 'Invoice digest'));

    if (path === `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/template/preview`) return json(route, stub.preview);
    if (path === `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/template` && method === 'PUT') {
      const body = request.postDataJSON() as Record<string, unknown>;
      stub.shareBodies.push(body);
      return json(route, detail('t-new', String(body.name), { ...body, owned: true, shareCode: 'WV7K3M9Q' }), 201);
    }
    return json(route, { items: [], page: 0, size: 20, totalElements: 0 });
  });
  return stub;
}

test.describe('shared templates gallery', () => {
  test('community tab lists public templates and searches', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/workflows/new');
    await page.getByRole('tab', { name: 'Cộng đồng' }).click();
    await expect(page.getByRole('button', { name: 'Invoice digest' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lead alerts' })).toBeVisible();
    await page.getByTestId('template-search').fill('lead');
    await expect(page.getByRole('button', { name: 'Invoice digest' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Lead alerts' })).toBeVisible();
    expect(stub.templateListUrls.some((url) => url.searchParams.get('q') === 'lead' && url.searchParams.get('scope') === 'public')).toBe(true);
  });

  test('enter code opens preview and uses template', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/workflows/new');
    await page.getByTestId('template-enter-code').click();
    const dialog = page.getByRole('dialog', { name: 'Nhập mã mẫu' });
    await expect(dialog).toBeVisible();
    await page.getByTestId('template-code-input').fill('wv7k-3m9q');
    await page.keyboard.press('Enter');
    const preview = page.getByTestId('template-preview-dialog');
    await expect(preview.getByRole('heading', { name: 'Shared by code' })).toBeVisible();
    await expect(preview).toContainText('Linh');
    await expect(page.getByTestId('template-preview-nodes').locator('li')).toHaveCount(3);
    await expect(page.getByTestId('template-preview-reselect')).toHaveText('Cần chọn lại 2 kết nối');
    expect(stub.byCodeUrls).toEqual(['/api/v1/templates/by-code/wv7k-3m9q']);
    await page.getByTestId('template-preview-use').click();
    await expect(page).toHaveURL(new RegExp(`/workflows/${newWorkflowId}`));
    expect(stub.useBodies).toEqual([{ workspaceId }]);
  });

  test('unknown code shows not-found message', async ({ page }) => {
    await setup(page);
    await page.goto('/workflows/new');
    await page.getByTestId('template-enter-code').click();
    await page.getByTestId('template-code-input').fill('nope');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('template-code-error')).toHaveText('Không tìm thấy mẫu với mã này.');
    await expect(page).toHaveURL(/\/workflows\/new$/);
  });

  test('code dialog closes on Escape and keeps focus inside', async ({ page }) => {
    await setup(page);
    await page.goto('/workflows/new');
    await page.getByTestId('template-enter-code').click();
    await expect(page.getByTestId('template-code-input')).toBeFocused();
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
    await expect(page.getByTestId('enter-code-dialog').locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('enter-code-dialog')).toBeHidden();
    await expect(page.getByTestId('template-enter-code')).toBeFocused();
  });

  test('?code= link opens the code dialog prefilled', async ({ page }) => {
    await setup(page);
    await page.goto('/workflows/new?code=WV7K3M9Q');
    await expect(page.getByTestId('template-code-input')).toHaveValue('WV7K3M9Q');
  });

  test('public template card previews then uses the template', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/workflows/new');
    await page.getByRole('tab', { name: 'Cộng đồng' }).click();
    await page.getByTestId('shared-template-t-1').getByRole('button', { name: 'Invoice digest' }).click();
    await page.getByTestId('template-preview-use').click();
    await expect(page).toHaveURL(new RegExp(`/workflows/${newWorkflowId}`));
    expect(stub.useBodies).toEqual([{ workspaceId }]);
  });

  test('mine tab changes visibility and deletes', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/workflows/new');
    await page.getByRole('tab', { name: 'Của tôi' }).click();
    await page.getByTestId('template-visibility-t-mine').selectOption('PUBLIC');
    await expect.poll(() => stub.patchBodies).toEqual([{ visibility: 'PUBLIC' }]);
    await expect(page.getByTestId('template-visibility-t-mine')).toHaveValue('PUBLIC');
    await page.getByTestId('template-delete-t-mine').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Xóa' }).click();
    await expect.poll(() => stub.deleted).toEqual(['t-mine']);
    await expect(page.getByTestId('shared-template-t-mine')).toBeHidden();
  });

  test('use failing with 429 keeps the dialog open and shows the error', async ({ page }) => {
    const stub = await setup(page);
    stub.useStatus = 429;
    await page.goto('/workflows/new');
    await page.getByRole('tab', { name: 'Cộng đồng' }).click();
    await page.getByTestId('shared-template-t-1').getByRole('button', { name: 'Invoice digest' }).click();
    await page.getByTestId('template-preview-use').click();
    const dialog = page.getByTestId('template-preview-dialog');
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/workflows\/new$/);
    await expect(page.getByTestId('template-preview-use')).toBeEnabled();
  });

  test('team tab never shows another workspace\'s templates after a switch', async ({ page }) => {
    const stub = await setup(page);
    await page.goto('/workflows/new');
    await page.getByRole('tab', { name: 'Nhóm' }).click();
    await expect(page.getByRole('button', { name: 'Team A item' })).toBeVisible();
    await page.getByTestId('topbar-workspace-selector').selectOption(workspaceBId);
    await expect(page.getByRole('button', { name: 'Team B item' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Team A item' })).toHaveCount(0);
    expect(stub.teamWorkspaceIds).toEqual([workspaceId, workspaceBId]);
  });

  test('tabs follow the arrow-key model', async ({ page }) => {
    await setup(page);
    await page.goto('/workflows/new');
    const builtin = page.getByRole('tab', { name: 'Có sẵn' });
    await builtin.focus();
    await page.keyboard.press('ArrowRight');
    const community = page.getByRole('tab', { name: 'Cộng đồng' });
    await expect(community).toBeFocused();
    await expect(community).toHaveAttribute('aria-selected', 'true');
    await expect(community).toHaveAttribute('tabindex', '0');
    await expect(builtin).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Của tôi' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(builtin).toBeFocused();
  });

  test('built-in tab keeps the static templates working', async ({ page }) => {
    await setup(page);
    await page.goto('/workflows/new');
    await expect(page.getByRole('tab', { name: 'Có sẵn' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('template-telegram-auto-reply')).toBeVisible();
  });
});

test.describe('share workflow as template', () => {
  const workflowDetail = {
    workflowId,
    name: 'Mail report',
    status: 'DRAFT',
    schemaVersion: '1.0',
    currentVersionId: null,
    createdAt: iso(900),
    updatedAt: iso(900),
    definition: {
      schemaVersion: '1.0',
      nodes: [
        { id: 'manual', type: 'trigger.manual', config: {} },
        { id: 'email', type: 'email.send', config: { to: 'boss@example.test', subject: 'Weekly', body: 'Hi' } },
      ],
      edges: [{ id: 'manual-email', source: 'manual', target: 'email' }],
      variables: {},
    },
    editorState: {
      nodes: {
        manual: { name: 'Start', position: { x: 0, y: 0 } },
        email: { name: 'Send report', position: { x: 320, y: 0 } },
      },
    },
  };

  async function openBuilder(page: Page, stub: Stub) {
    await page.route(`**/api/v1/workspaces/*/workflows/${workflowId}`, (route) => json(route, workflowDetail));
    stub.preview = {
      definition: { nodes: [{ id: 'manual', type: 'trigger.manual' }, { id: 'email', type: 'email.send' }] },
      editorState: null,
      removedFields: [{ nodeId: 'email', field: 'to' }, { nodeId: 'email', field: 'connectionId' }],
      warnings: [{ nodeId: 'email', field: 'body', reason: 'EMAIL' }],
      existing: null,
    };
    await page.goto(`/workflows/${workflowId}/builder`);
    await expect(page.getByTestId('workflow-title')).toHaveValue('Mail report');
    await page.getByTestId('workflow-share-template').click();
  }

  test('share dialog lists removed fields and requires review when warnings exist', async ({ page }) => {
    const stub = await setup(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await openBuilder(page, stub);

    const dialog = page.getByRole('dialog', { name: 'Chia sẻ làm mẫu' });
    await expect(dialog).toBeVisible();
    const removed = page.getByTestId('share-template-removed');
    await expect(removed).toContainText('Send report');
    await expect(removed.locator('li')).toHaveCount(2);
    await expect(page.getByTestId('share-template-warnings')).toContainText('Send report');
    await expect(page.getByTestId('share-template-author')).toHaveValue('Owner Name');

    await page.getByTestId('share-template-name').fill('Weekly mail');
    await dialog.getByLabel('Mô tả').fill('Sends the weekly report');
    await dialog.getByRole('radio', { name: /Có mã/ }).check();
    await expect(page.getByTestId('share-template-submit')).toBeDisabled();
    await page.getByTestId('share-template-reviewed').check();
    await expect(page.getByTestId('share-template-submit')).toBeEnabled();
    await page.getByTestId('share-template-submit').click();

    await expect(page.getByTestId('share-template-code')).toHaveText('WV7K3M9Q');
    expect(stub.shareBodies).toEqual([{ name: 'Weekly mail', description: 'Sends the weekly report', authorName: 'Owner Name', visibility: 'UNLISTED' }]);
    await expect(page.getByTestId('share-template-link')).toHaveValue(/\/workflows\/new\?code=WV7K3M9Q$/);
    await page.getByTestId('share-template-copy-code').click();
    await expect(page.getByTestId('share-template-copy-code')).toContainText('Đã sao chép');
  });

  test('re-share pre-fills from existing template', async ({ page }) => {
    const stub = await setup(page);
    await openBuilder(page, stub);
    await page.getByRole('button', { name: 'Hủy' }).click();
    stub.preview = {
      ...stub.preview,
      removedFields: [],
      warnings: [],
      existing: detail('t-new', 'Existing name', { owned: true, description: 'Old text', authorName: 'Old author', visibility: 'PUBLIC', shareCode: 'WV7K3M9Q' }),
    };
    await page.getByTestId('workflow-share-template').click();
    await expect(page.getByTestId('share-template-name')).toHaveValue('Existing name');
    await expect(page.getByTestId('share-template-author')).toHaveValue('Old author');
    await expect(page.getByRole('radio', { name: /Công khai/ })).toBeChecked();
    await expect(page.getByTestId('share-template-submit')).toHaveText('Cập nhật mẫu');
    await expect(page.getByTestId('share-template-submit')).toBeEnabled();
  });

  test('share is disabled while the draft has unsaved changes', async ({ page }) => {
    const stub = await setup(page);
    await openBuilder(page, stub);
    await page.keyboard.press('Escape');
    await page.getByTestId('workflow-title').fill('Renamed locally');
    await expect(page.getByTestId('workflow-share-template')).toBeDisabled();
    await expect(page.getByTestId('workflow-share-template')).toHaveAttribute('title', 'Lưu bản nháp trước khi chia sẻ');
  });
});
