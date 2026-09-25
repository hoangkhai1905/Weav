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
    await page.route('**/api/notifications**', async (route) => {
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
        body: JSON.stringify({ items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }),
      });
    });
  });

  test('translates Dashboard quick actions without exposing a translation key', async ({ page }) => {
    await page.addInitScript(() => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', 'VI'));
    await page.goto('/dashboard');

    const quickActions = page.getByTestId('dashboard-quick-actions');
    await expect(quickActions).toBeVisible();
    await expect(quickActions).toContainText('Thao tác nhanh');
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

    await expect(page.getByTestId('app-sidebar').getByRole('link', { name: 'Kết nối', exact: true })).toBeVisible();
    await page.getByTestId('connections-create-open').click();
    const dialog = page.getByTestId('connection-create-dialog');
    await expect(dialog.getByRole('heading', { name: 'Thêm kết nối Google' })).toBeVisible();
    await expect(dialog.getByLabel('Tên kết nối')).toBeVisible();
    await expect(dialog.getByLabel('Dịch vụ Google')).toBeVisible();
    await expect(dialog).not.toContainText('connections.create.');
  });

  test('keeps Dashboard quick actions in English when English is selected', async ({ page }) => {
    await page.addInitScript(() => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', 'EN'));
    await page.goto('/dashboard');

    const quickActions = page.getByTestId('dashboard-quick-actions');
    await expect(quickActions).toContainText('Quick actions');
    await expect(quickActions).not.toContainText('dashboard.quick_actions');
  });

  test('localizes workflow update timestamps in both languages', async ({ page }) => {
    for (const locale of ['VI', 'EN'] as const) {
      await page.addInitScript((selectedLocale) => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', selectedLocale), locale);
      await page.goto('/workflows');
      await expect(page.locator('body')).toContainText(locale === 'VI' ? 'Hôm nay, 10:40' : 'Today, 10:40 AM');
      if (locale === 'VI') await expect(page.locator('body')).not.toContainText(/Today,|Yesterday,/);
    }
  });

  test('localizes login, registration, and password recovery in Vietnamese', async ({ page }) => {
    await page.addInitScript(() => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', 'VI'));
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Chào mừng trở lại', exact: true })).toBeVisible();
    await expect(page.getByText('Ghi nhớ đăng nhập', { exact: true })).toBeVisible();
    await expect(page.getByText('Trình thiết kế quy trình AI', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Biểu trưng WEAV' })).toBeVisible();
    await expect(page.locator('body')).toContainText('Nền tảng tự động hóa bằng AI');

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
    await expect(page.getByText('Hướng dẫn sử dụng và tài liệu tham khảo node của WEAV V1.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mở hướng dẫn', exact: true })).toBeVisible();
  });

  test('keeps every existing web screen in its selected locale', async ({ page }) => {
    const screens = [
      { path: '/login', vi: 'Chào mừng trở lại', en: 'Welcome back' },
      { path: '/register', vi: 'Tạo tài khoản mới', en: 'Create your Account' },
      { path: '/forgot-password', vi: 'Đặt lại mật khẩu', en: 'Reset your password' },
      { path: '/dashboard', vi: 'Thao tác nhanh', en: 'Quick actions' },
      { path: '/workflows', vi: 'Danh sách quy trình', en: 'Workflows' },
      { path: '/workflows/new', vi: 'Tạo quy trình', en: 'Create workflow' },
      { path: '/workflows/wf-prod-8492/builder', vi: 'Vừa khung', en: 'Fit View' },
      { path: '/executions', vi: 'Lịch sử chạy quy trình', en: 'Execution History' },
      { path: '/executions/EX-8492', vi: 'Kiểm tra bước', en: 'Step inspector' },
      { path: '/connections', vi: 'Kết nối dịch vụ', en: 'Connections' },
      { path: '/workspace', vi: 'Quản lý không gian làm việc', en: 'Workspace management' },
      { path: '/notifications', vi: 'Thông báo', en: 'Notifications' },
      { path: '/settings/profile', vi: 'Cài đặt', en: 'Settings' },
      { path: '/ai/workflow-generator', vi: 'Tạo bằng AI', en: 'Create with AI' },
      { path: '/telegram', vi: 'Tích hợp Telegram Bot', en: 'Telegram Bot Integration' },
      { path: '/help', vi: 'Trợ giúp & Tài liệu', en: 'Help & Docs' },
    ];
    const leakedKey = /\b(?:common|nav|topbar|dashboard|workflows|workspace|connections|executions|execution_detail|settings|auth|forgot|help|telegram|notif|builder|ai_gen|status)\.[a-z][a-z0-9_.]*/gi;
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
        await expect(page.locator('body')).toContainText(screen[locale === 'VI' ? 'vi' : 'en']);
        if (screen.path === '/login') {
          await expect(page.getByText(locale === 'VI' ? 'Trình thiết kế quy trình AI' : 'AI Workflow Studio', { exact: true })).toBeVisible();
          await expect(page.locator('body')).toContainText(
            locale === 'VI' ? 'Nền tảng tự động hóa bằng AI' : 'Built for modern AI engineering',
          );
        }
        if (screen.path === '/executions' && locale === 'VI') {
          await expect(page.locator('body')).toContainText('Lịch (hằng ngày)');
        }
        if (screen.path === '/workflows' && locale === 'VI') {
          await expect(page.locator('body')).toContainText('Hôm nay, 10:40');
          await expect(page.locator('body')).not.toContainText(/Today,|Yesterday,/);
        }
        if (screen.path === '/executions/EX-8492') {
          await expect(page.locator('body')).toContainText(
            locale === 'VI' ? 'IP Stripe 54.187.205.1 đã gọi endpoint Webhook POST /stripe.' : 'Stripe IP 54.187.205.1 called the Webhook endpoint POST /stripe.'
          );
        }
        if (locale === 'VI' && ['/workflows/wf-prod-8492/builder', '/executions/EX-8492'].includes(screen.path)) {
          await expect(page.locator('body')).toContainText('Nhấn Enter hoặc phím cách để chọn node.');
          await expect(page.locator('body')).not.toContainText(/Press enter or space to select a node/i);
        }
        if (locale === 'VI' && screen.path === '/workflows/wf-prod-8492/builder') {
          await expect(page.getByTestId('builder-workspace-context')).toContainText('Không gian làm việc: Chưa chọn');
          await expect(page.locator('body')).toContainText('Bản đồ thu nhỏ');
          await expect(page.locator('body')).not.toContainText('Mini Map');
        }
        if (screen.path === '/telegram') {
          await expect(page.locator('body')).toContainText(
            locale === 'VI' ? 'Đã chạy lệnh /run wf-001 bởi @truong_dev.' : 'Command /run wf-001 executed by @truong_dev.'
          );
        }
        const bodyText = await page.locator('body').innerText();
        const exposedKey = Array.from(bodyText.matchAll(leakedKey), (match) => match[0]).find((match) => !technicalIdentifiers.has(match));
        expect(exposedKey, `${locale} ${screen.path} exposes ${exposedKey ?? 'a translation key'}`).toBeUndefined();
      }
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
        await expect(quickActions).toContainText(locale === 'VI' ? 'Thao tác nhanh' : 'Quick actions');
        await expect(quickActions).not.toContainText('dashboard.quick_actions');
        if (locale === 'VI') {
          await expect(page.locator('body')).toContainText('T7: 36 lượt');
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

  test('localizes AI workflow prompt and generated-flow labels in Vietnamese and English', async ({ page }, testInfo) => {
    for (const locale of ['VI', 'EN'] as const) {
      await page.addInitScript((selectedLocale) => (globalThis as unknown as BrowserContext).localStorage.setItem('weav_lang_v1', selectedLocale), locale);
      await page.goto('/ai/workflow-generator');

      const prompt = page.getByLabel(locale === 'VI' ? 'Quy trình này cần làm gì?' : 'What should this workflow do?');
      await expect(prompt).toHaveValue(locale === 'VI' ? /Khi nhận được đơn hàng mới/ : /When a new order arrives/);
      await expect(page.getByText(locale === 'VI' ? 'Cổng điều kiện' : 'Conditional gate', { exact: true })).toBeVisible();
      await page.getByTestId('technical-details').locator('summary').click();
      await expect(page.getByText(locale === 'VI' ? 'Liên kết biến' : 'Variable bindings', { exact: true })).toBeVisible();
      await expect(page.getByText(locale === 'VI' ? 'Không phát hiện rò rỉ thông tin bí mật' : 'Zero secret leakages detected')).toBeVisible();
      await expect(page.getByText(locale === 'VI' ? 'Định nghĩa quy trình đã tổng hợp' : 'Synthesized Workflow Definition', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: locale === 'VI' ? 'Sao chép JSON' : 'Copy JSON' })).toBeVisible();
      await expect(page.getByText(locale === 'VI' ? 'Hợp lệ theo RFC 8259' : 'Valid RFC 8259', { exact: true })).toBeVisible();
      await expect(page.getByText(locale === 'VI' ? 'KÍCH HOẠT' : 'TRIGGER', { exact: true })).toBeVisible();
      await expect(page.getByText(locale === 'VI' ? 'CSDL' : 'DATABASE', { exact: true })).toBeVisible();
      await expect(page.getByText(locale === 'VI' ? 'AI TẠO' : 'SYNTHESIZED', { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`ai-generator-${locale.toLowerCase()}.png`), fullPage: true });
    }
  });
});
