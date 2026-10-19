import { test, expect } from '@playwright/test';
import { TRANSLATIONS } from '../src/lib/i18n/translations.js';

type BrowserContext = {
  localStorage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
  location: { pathname: string };
};

test.describe('Vietnamese and English web localization', () => {
  test('keeps locale keys paired and provides Dashboard quick-actions copy', () => {
    expect(TRANSLATIONS.VI['dashboard.quick_actions']).toBe('Thao tác nhanh');
    expect(TRANSLATIONS.EN['dashboard.quick_actions']).toBe('Quick actions');
    expect(Object.keys(TRANSLATIONS.VI).sort()).toEqual(Object.keys(TRANSLATIONS.EN).sort());
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const browser = globalThis as unknown as BrowserContext;
      if (['/login', '/register', '/forgot-password'].includes(browser.location.pathname)) {
        browser.localStorage.removeItem('weav_token');
      } else {
        browser.localStorage.setItem('weav_token', 'localization-fixture-token');
      }
      if (browser.location.pathname === '/workflows') {
        browser.localStorage.setItem('weav_mock_workflows_v1', '[]');
      }
    });
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '10000000-0000-4000-8000-000000000001',
          email: 'localization@example.com',
          displayName: 'Localization Fixture',
          avatarStorageKey: null,
          systemRole: 'USER',
          status: 'ACTIVE',
        }),
      });
    });
    await page.route('**/api/v2/notifications**', async (route) => {
      const requestPath = new URL(route.request().url()).pathname;
      const body = requestPath.endsWith('/unread-count')
        ? { count: 0 }
        : { items: [], nextCursor: null };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('**/api/v1/workspaces**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: '00000000-0000-4000-8000-000000000001',
            name: 'Localization workspace',
            createdBy: '10000000-0000-4000-8000-000000000001',
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
          }],
          page: 0, size: 20, totalElements: 1, totalPages: 1,
        }),
      });
    });
    // Workflow list, monitoring summary and recent runs for the v2 Dashboard and Workflows screens (the catch-all above answers with workspaces).
    const today = new Date().toISOString();
    await page.route(/\/api\/v1\/workspaces\/[^/]+\/workflows\?/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            workflowId: '00000000-0000-4000-8000-000000000201', name: 'Localization flow', description: null, status: 'DRAFT', schemaVersion: '1.0',
            currentVersionId: null, createdAt: today, updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), publishedAt: null,
          }],
          page: 0, size: 100, totalElements: 1, totalPages: 1,
        }),
      });
    });
    await page.route('**/api/v1/workspaces/*/monitoring/summary**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          days: 7, from: today, to: today, workflows: { published: 0, paused: 0, draft: 1 },
          runs: { total: 36, today: 36, success: 36, failed: 0, active: 0 }, successRate: 1, averageDurationMs: 1000, p95DurationMs: 1000,
          trend: [{ date: today.slice(0, 10), total: 36, success: 36, failed: 0 }], topFailingWorkflows: [], recentFailures: [],
        }),
      });
    });
    await page.route((url) => /\/api\/v1\/workspaces\/[^/]+\/executions$/.test(url.pathname), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 6, totalElements: 0, hasNext: false }) });
    });
  });

  test('translates Dashboard quick actions without exposing a translation key', async ({ page }) => {
    await page.addInitScript(() => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', 'VI'));
    await page.goto('/dashboard');

    const quickActions = page.getByTestId('dashboard-quick-actions');
    await expect(quickActions).toBeVisible();
    await expect(quickActions).toContainText('Bắt đầu nhanh');
    await expect(quickActions).not.toContainText('dashboard.quick_actions');
  });

  test('keeps Connections navigation and form labels in Vietnamese', async ({ page }) => {
    await page.addInitScript(() => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', 'VI'));
    await page.route('**/api/v1/workspaces**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: '00000000-0000-4000-8000-000000000001',
            name: 'Localization workspace',
            createdBy: '10000000-0000-4000-8000-000000000001',
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
          }],
          page: 0,
          size: 20,
          totalElements: 1,
          totalPages: 1,
        }),
      });
    });
    await page.route('**/api/v1/workspaces/*/connections', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.goto('/connections');

    await expect(page.getByTestId('workspace-tab-connections')).toHaveText('Kết nối');
    await page.getByTestId('connections-create-open').click();
    const dialog = page.getByTestId('connection-create-dialog');
    await expect(dialog.getByRole('heading', { name: 'Thêm kết nối', exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Tên kết nối')).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Chọn dịch vụ muốn kết nối' })).toBeVisible();
    await expect(dialog).not.toContainText('connections.create.');
  });

  test('keeps Dashboard quick actions in English when English is selected', async ({ page }) => {
    await page.addInitScript(() => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', 'EN'));
    await page.goto('/dashboard');

    const quickActions = page.getByTestId('dashboard-quick-actions');
    await expect(quickActions).toContainText('Quick start');
    await expect(quickActions).not.toContainText('dashboard.quick_actions');
  });

  test('localizes workflow update timestamps in both languages', async ({ page }) => {
    for (const locale of ['VI', 'EN'] as const) {
      await page.addInitScript((selectedLocale) => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', selectedLocale), locale);
      await page.goto('/workflows');
      await expect(page.locator('body')).toContainText(locale === 'VI' ? 'sửa 2 giờ trước' : 'edited 2 hours ago');
      if (locale === 'VI') await expect(page.locator('body')).not.toContainText(/hours? ago/);
    }
  });

  test('localizes login, registration, and password recovery in Vietnamese', async ({ page }) => {
    await page.addInitScript(() => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', 'VI'));
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
    await expect(page.locator('body')).toContainText('Tiếp tục với các quy trình của nhóm bạn.');

    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Tạo tài khoản mới', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tạo tài khoản', exact: true })).toBeVisible();

    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: 'Đặt lại mật khẩu', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yêu cầu mã khôi phục', exact: true })).toBeVisible();
  });

  test('localizes workflow creation and Help in Vietnamese', async ({ page }) => {
    await page.addInitScript(() => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', 'VI'));
    await page.goto('/workflows/new');
    await expect(page.getByRole('heading', { name: 'Tạo quy trình', exact: true })).toBeVisible();
    await expect(page.getByText('Từ mẫu', { exact: true })).toBeVisible();

    await page.goto('/help');
    await expect(page.getByText('Hướng dẫn sử dụng Weav: tự động hóa công việc bằng cách nối các bước thành một quy trình.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bắt đầu nhanh', exact: true })).toBeVisible();
  });

  test('keeps every existing web screen in its selected locale', async ({ page }) => {
    // 15 screens x 2 locales = 30 full page loads in one test: about 29 s alone, over the 30 s default.
    test.slow();
    const screens = [
      { path: '/login', vi: 'Tiếp tục với các quy trình của nhóm bạn.', en: "Continue with your team's workflows." },
      { path: '/register', vi: 'Tạo tài khoản mới', en: 'Create your Account' },
      { path: '/forgot-password', vi: 'Đặt lại mật khẩu', en: 'Reset your password' },
      { path: '/dashboard', vi: 'Bắt đầu nhanh', en: 'Quick start' },
      { path: '/workflows', vi: 'Quy trình làm gì', en: 'What it does' },
      { path: '/workflows/new', vi: 'Tạo quy trình', en: 'Create workflow' },
      { path: '/workflows/wf-prod-8492/builder', vi: 'Vừa khung', en: 'Fit View' },
      { path: '/executions', vi: 'Lịch sử chạy quy trình', en: 'Execution History' },
      { path: '/executions/EX-8492', vi: 'Không tìm thấy lượt chạy trong không gian làm việc hiện tại.', en: 'The run was not found in the active workspace.' },
      { path: '/connections', vi: 'Kết nối dịch vụ', en: 'Connections' },
      { path: '/workspace', vi: 'Không gian làm việc', en: 'Workspace' },
      { path: '/notifications', vi: 'Thông báo', en: 'Notifications' },
      { path: '/settings/profile', vi: 'Cài đặt', en: 'Settings' },
      { path: '/ai/workflow-generator', vi: 'Tạo bằng AI', en: 'Create with AI' },
      { path: '/help', vi: 'Trợ giúp & Tài liệu', en: 'Help & Docs' },
    ];
    // Http mode has no demo workflows: the builder screen needs a real (stubbed) workflow to render its canvas.
    await page.route('**/api/v1/workspaces/*/workflows/wf-prod-8492', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflowId: 'wf-prod-8492', name: 'Localization flow', description: null, status: 'DRAFT', schemaVersion: '1.0',
          currentVersionId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), publishedAt: null,
          definition: { schemaVersion: '1.0', nodes: [{ id: 'hook', type: 'trigger.webhook', config: {} }], edges: [], variables: {} },
          editorState: { nodes: { hook: { name: 'Webhook', position: { x: 0, y: 0 } } } },
        }),
      });
    });
    const leakedKey = /\b(?:common|nav|topbar|dashboard|workflows|workspace|connections|executions|execution_detail|settings|auth|forgot|help|hp|telegram|notif|builder|ai_gen|status)\.[a-z][a-z0-9_.]*/gi;
    const technicalIdentifiers = new Set([
      'telegram.send', 'trigger.manual', 'trigger.webhook', 'ai.extract', 'email.send',
      'sheets.append', 'logic.condition', 'logic.filter', 'google.sheets', 'google.docs',
    ]);
    const authScreens = new Set(['/login', '/register', '/forgot-password']);

    for (const locale of ['VI', 'EN'] as const) {
      await page.addInitScript((selectedLocale) => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', selectedLocale), locale);
      for (const screen of screens) {
        await page.addInitScript((authenticated) => {
          const storage = (globalThis as unknown as BrowserContext).localStorage;
          if (authenticated) storage.setItem('weav_token', 'localization-fixture-token');
          else storage.removeItem('weav_token');
        }, !authScreens.has(screen.path));
        await page.goto(screen.path);
        expect(new URL(page.url()).pathname, `${locale} ${screen.path} should stay on the requested screen`).toBe(screen.path);
        const expected = screen[locale === 'VI' ? 'vi' : 'en'];
        if (screen.path === '/workflows/wf-prod-8492/builder') {
          // The canvas fit-view control is an icon button: its localized label is the accessible name.
          await expect(page.getByRole('button', { name: expected, exact: true })).toBeVisible();
        } else {
          await expect(page.locator('body')).toContainText(expected);
        }
        if (screen.path === '/workflows' && locale === 'VI') {
          await expect(page.locator('body')).toContainText('sửa 2 giờ trước');
          await expect(page.locator('body')).not.toContainText(/hours? ago/);
        }
        if (locale === 'VI' && screen.path === '/workflows/wf-prod-8492/builder') {
          await expect(page.locator('body')).toContainText('Nhấn Enter hoặc phím cách để chọn node.');
          await expect(page.locator('body')).not.toContainText(/Press enter or space to select a node/i);
        }
        if (locale === 'VI' && screen.path === '/workflows/wf-prod-8492/builder') {
          await expect(page.getByTestId('builder-workspace-context')).toContainText('Không gian làm việc: Localization workspace');
          await expect(page.locator('body')).toContainText('Bản đồ thu nhỏ');
          await expect(page.locator('body')).not.toContainText('Mini Map');
        }
        const bodyText = await page.locator('body').innerText();
        const exposedKey = Array.from(bodyText.matchAll(leakedKey), (match) => match[0]).find((match) => !technicalIdentifiers.has(match));
        expect(exposedKey, `${locale} ${screen.path} exposes ${exposedKey ?? 'a translation key'}`).toBeUndefined();
      }
    }
  });

  test('localizes the run detail screen in both languages', async ({ page }) => {
    const WS = '00000000-0000-4000-8000-000000000001';
    const WF = '30000000-0000-4000-8000-000000000001';
    const RUN = '40000000-0000-4000-8000-000000000001';
    const at = '2026-10-07T10:00:00Z';
    const summary = { executionId: RUN, workflowId: WF, workflowVersionId: WF, status: 'SUCCESS', triggerType: 'MANUAL', createdAt: at, startedAt: at, finishedAt: '2026-10-07T10:00:02Z' };
    const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const getOnly = (path: string) => (url: URL) => url.pathname === path;
    await page.route(getOnly(`/api/v1/workspaces/${WS}/workflows/${WF}`), (route) => route.request().method() === 'GET' ? route.fulfill(json({
      ...summary, workflowId: WF, name: 'Run detail flow', status: 'PUBLISHED', currentVersionId: WF, publishedAt: at, updatedAt: at,
      definition: { schemaVersion: '1.0', nodes: [{ id: 'hook', type: 'trigger.webhook', config: {} }], edges: [], variables: {} },
      editorState: { nodes: { hook: { name: 'Webhook in', position: { x: 0, y: 0 } } } },
    })) : route.fallback());
    await page.route(getOnly(`/api/v1/workspaces/${WS}/workflows/${WF}/executions`), (route) => route.request().method() === 'GET'
      ? route.fulfill(json({ items: [summary], page: 0, size: 100, totalElements: 1, totalPages: 1 })) : route.fallback());
    await page.route(getOnly(`/api/v1/workspaces/${WS}/workflows/${WF}/executions/${RUN}`), (route) => route.request().method() === 'GET' ? route.fulfill(json({
      ...summary,
      nodes: [{ nodeExecutionId: '60000000-0000-4000-8000-000000000001', nodeId: 'hook', nodeType: 'trigger.webhook', status: 'SUCCESS', attemptCount: 1, startedAt: at, finishedAt: '2026-10-07T10:00:01Z', output: { ok: true }, error: null, attempts: [] }],
      logs: { items: [], page: 0, size: 100, totalElements: 0, hasNext: false },
    })) : route.fallback());

    for (const locale of ['VI', 'EN'] as const) {
      await page.addInitScript((selectedLocale) => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', selectedLocale), locale);
      await page.goto(`/workflows/${WF}/executions?run=${RUN}`);
      const steps = locale === 'VI' ? 'Các bước' : 'Steps';
      const received = locale === 'VI' ? 'Dữ liệu nhận vào' : 'Data received';
      await expect(page.getByRole('heading', { name: steps, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: received, exact: true })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('run2.');
    }
  });

  test('captures Dashboard in Vietnamese and English at desktop and narrow widths', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    for (const locale of ['VI', 'EN'] as const) {
      await page.addInitScript((selectedLocale) => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', selectedLocale), locale);
      for (const viewport of [
        { name: 'desktop', width: 1365, height: 900 },
        { name: 'narrow', width: 390, height: 844 },
      ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('/dashboard');
        const quickActions = page.getByTestId('dashboard-quick-actions');
        await expect(quickActions).toContainText(locale === 'VI' ? 'Bắt đầu nhanh' : 'Quick start');
        await expect(quickActions).not.toContainText('dashboard.quick_actions');
        if (locale === 'VI') {
          await expect(page.getByLabel(/Biểu đồ lượt chạy 7 ngày, cao nhất .+ với 36 lượt/)).toBeVisible();
          await expect(page.locator('body')).not.toContainText(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/);
        }
        await page.screenshot({
          path: testInfo.outputPath(`dashboard-${locale.toLowerCase()}-${viewport.name}.png`),
          fullPage: true,
        });
      }
    }

    expect(pageErrors).toEqual([]);
  });

  test('localizes the AI generator prompt, examples and actions in Vietnamese and English', async ({ page }) => {
    for (const locale of ['VI', 'EN'] as const) {
      await page.addInitScript((selectedLocale) => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', selectedLocale), locale);
      await page.goto('/ai/workflow-generator');

      await expect(page.getByLabel(locale === 'VI' ? 'Quy trình này cần làm gì?' : 'What should this workflow do?')).toBeVisible();
      await expect(page.getByRole('button', { name: locale === 'VI' ? 'Tạo quy trình' : 'Generate workflow', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: locale === 'VI' ? 'Bot Telegram tự động trả lời' : 'Telegram auto-reply bot', exact: true })).toBeVisible();
      await expect(page.locator('body')).not.toContainText(/hp.ai./);
    }
  });
});
