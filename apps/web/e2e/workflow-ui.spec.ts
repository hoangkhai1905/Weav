import { test, expect } from '@playwright/test';

test.describe('industrial workflow shell', () => {
  test('shows readable navigation and moves the active indicator to Workflows', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/workflows');

    const sidebar = page.getByTestId('app-sidebar');
    const workflowsLink = sidebar.getByRole('link', { name: 'Workflows' });

    await expect(sidebar).toBeVisible();
    await expect(workflowsLink).toHaveAttribute('aria-current', 'page');
    await expect(workflowsLink).toHaveCSS('font-size', '14px');
    await expect(workflowsLink.getByTestId('active-nav-indicator')).toBeVisible();

    await page.evaluate(() => {
      const globalObj = globalThis as unknown as {
        localStorage: { setItem: (k: string, v: string) => void };
        document: { documentElement: { classList: { remove: (c: string) => void } } };
      };
      globalObj.localStorage.setItem('weav_theme', 'light');
      globalObj.document.documentElement.classList.remove('dark');
    });

    const sidebarLightness = await sidebar.evaluate((element) => {
      const el = element as unknown as {
        ownerDocument: { defaultView: { getComputedStyle: (e: unknown) => { backgroundColor: string } } };
      };
      const [red, green, blue] = el.ownerDocument.defaultView
        .getComputedStyle(el)
        .backgroundColor.match(/\d+/g)!
        .slice(0, 3)
        .map(Number);
      return (red + green + blue) / (255 * 3);
    });
    expect(sidebarLightness).toBeGreaterThan(0.75);
  });
});

test.describe('topbar breadcrumbs', () => {
  test('tracks the active route in the current page breadcrumb', async ({ page }) => {
    await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });

    await page.goto('/executions');
    await expect(page.getByTestId('topbar-breadcrumb-current')).toHaveText('Executions');

    await page.goto('/workflows');
    await expect(page.getByTestId('topbar-breadcrumb-current')).toHaveText('Workflows');
  });
});

test.describe('dashboard quick actions', () => {
  test('surfaces the core workflow actions on the overview', async ({ page }) => {
    await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });
    await page.goto('/dashboard');

    const quickActions = page.getByTestId('dashboard-quick-actions');
    await expect(quickActions).toBeVisible();
    await expect(quickActions.getByRole('link', { name: 'Create workflow' })).toBeVisible();
    await expect(quickActions.getByRole('button', { name: 'Create with AI' })).toBeVisible();
    await expect(quickActions.getByRole('link', { name: 'Run test' })).toBeVisible();
    await expect(quickActions.getByRole('link', { name: 'View executions' })).toBeVisible();
  });

  test('opens the existing AI creation flow from quick actions', async ({ page }) => {
    await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });
    await page.goto('/dashboard');

    await page.getByTestId('dashboard-quick-actions').getByRole('button', { name: 'Create with AI' }).click();
    await expect(page.getByText('Create workflow with AI', { exact: true })).toBeVisible();
  });

  test('shows an OCR quick action in both languages and opens the OCR builder', async ({ page }) => {
    await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });
    await page.goto('/dashboard');

    const quickActions = page.getByTestId('dashboard-quick-actions');
    await expect(quickActions.getByRole('link', { name: 'OCR document' })).toBeVisible();

    await page.getByRole('button', { name: 'Switch to Vietnamese' }).click();
    await expect(quickActions.getByRole('link', { name: 'OCR tài liệu' })).toBeVisible();
    await quickActions.getByRole('link', { name: 'OCR tài liệu' }).click();
    await expect(page).toHaveURL(/\/workflows\/wf-prod-5521\/builder$/);
  });
});

test.describe('language switching', () => {
  test('translates the dashboard shell and quick actions between Vietnamese and English', async ({ page }) => {
    await page.addInitScript({ content: "window.localStorage.removeItem('weav_lang_v1')" });
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Tổng quan không gian làm việc', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Đổi sang English|Switch to English/ }).click();
    await expect(page.getByRole('heading', { name: 'Workspace overview', exact: true })).toBeVisible();
    await expect(page.getByTestId('dashboard-quick-actions').getByRole('button', { name: 'Create with AI' })).toBeVisible();

    await page.getByRole('button', { name: /Đổi sang Tiếng Việt|Switch to Vietnamese/ }).click();
    await expect(page.getByRole('heading', { name: 'Tổng quan không gian làm việc', exact: true })).toBeVisible();
    await expect(page.getByTestId('dashboard-quick-actions').getByRole('button', { name: 'Tạo bằng AI' })).toBeVisible();
  });
});

test.describe('workflow operations list', () => {
  test('filters rows without losing operational context', async ({ page }) => {
    await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });
    await page.goto('/workflows');

    const rows = page.getByTestId('workflow-row');
    await expect(rows.first()).toBeVisible();
    await page.getByTestId('workflow-search').fill('Invoice');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId('workflow-glyph')).toBeVisible();
  });

  test('opens row actions with an accessible trigger', async ({ page }) => {
    await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });
    await page.goto('/workflows');
    const rows = page.getByTestId('workflow-row');
    await expect(rows).toHaveCount(3);
    const firstRow = rows.first();
    await firstRow.getByRole('button', { name: 'More workflow actions' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
  });
});

test.describe('bulk workflow actions', () => {
  test('turns row selection into a confirmable delete action', async ({ page }) => {
    await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });
    await page.goto('/workflows');

    const rows = page.getByTestId('workflow-row');
    await expect(rows).toHaveCount(3);
    await rows.nth(0).getByRole('checkbox', { name: /Select / }).check();
    await rows.nth(1).getByRole('checkbox', { name: /Select / }).check();

    const bulkActions = page.getByTestId('workflow-bulk-actions');
    await expect(bulkActions).toContainText('2 workflows selected');
    await bulkActions.getByRole('button', { name: 'Delete selected workflows' }).click();
    await expect(page.getByText('Delete selected workflows?', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Delete workflows', exact: true }).click();
    await expect(bulkActions).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('workflow-row')).toHaveCount(1);
  });
});

test.describe('workflow responsive layout', () => {
  test('keeps selected workflow actions within the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'VI')" });
    await page.goto('/workflows');

    const rows = page.getByTestId('workflow-row');
    await expect(rows).toHaveCount(3);
    await rows.nth(0).getByRole('checkbox', { name: /Select / }).check();
    await rows.nth(1).getByRole('checkbox', { name: /Select / }).check();

    const dimensions = await page.evaluate(() => {
      const globalObj = globalThis as unknown as {
        document: { documentElement: { clientWidth: number; scrollWidth: number } };
      };
      return {
        clientWidth: globalObj.document.documentElement.clientWidth,
        scrollWidth: globalObj.document.documentElement.scrollWidth,
      };
    });

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(page.locator('main')).toHaveCSS('min-width', '0px');
    await expect(page.locator('main')).toHaveCSS('overflow-x', 'hidden');
  });
});

test.describe('workflow builder execution motion', () => {
  test('keeps the minimap contained and the selected workflow visible', async ({ page }) => {
    await page.goto('/workflows/wf-001/builder');

    await expect(page.getByTestId('workflow-node').filter({ hasText: 'AI Extract Core' })).toBeVisible();
    const minimap = page.locator('.react-flow__minimap');
    await expect(minimap).toBeVisible();
    const minimapBox = await minimap.boundingBox();
    expect(minimapBox).not.toBeNull();
    expect(minimapBox?.width).toBeGreaterThan(150);
    expect(minimapBox?.height).toBeGreaterThan(90);

    const viewportMask = minimap.locator('.react-flow__minimap-mask');
    await expect(viewportMask).toBeVisible();
    await expect(viewportMask).toHaveCSS('stroke', /rgb\((100, 116, 139|148, 163, 184)\)/);
  });

  test('communicates execution state through nodes and edges', async ({ page }) => {
    await page.goto('/workflows/wf-001/builder');
    await page.getByRole('button', { name: 'Run test workflow' }).first().click();

    await expect(page.getByTestId('workflow-node').filter({ hasText: 'AI Extract Core' }))
      .toHaveAttribute('data-status', /processing|success/);
    await expect(page.getByTestId('execution-edge-active')).toBeVisible();
  });

  test('keeps the active packet visible for the full edge transition', async ({ page }) => {
    await page.goto('/workflows/wf-001/builder');
    await page.getByRole('button', { name: 'Run test workflow' }).first().click();

    const activeEdge = page.getByTestId('execution-edge-active');
    await expect(activeEdge).toBeVisible();
    await expect(activeEdge.locator('animateMotion')).toHaveAttribute('repeatCount', 'indefinite');
  });

  test('shows a subtle flow preview before an execution starts', async ({ page }) => {
    await page.goto('/workflows/wf-001/builder');

    const flowPreview = page.getByTestId('execution-edge-flow');
    await expect(flowPreview).toHaveCount(3);
    await expect(flowPreview.first().locator('animate')).toHaveAttribute('repeatCount', 'indefinite');
  });

  test('opens the inspector on node click and dismisses it outside the panel', async ({ page }) => {
    await page.goto('/workflows/wf-001/builder');

    const inspector = page.getByTestId('workflow-inspector');
    await expect(inspector).toHaveCount(0);

    await page.getByTestId('workflow-node').filter({ hasText: 'AI Extract Core' }).click();
    await expect(inspector).toBeVisible();

    await page.locator('.react-flow__pane').click({ position: { x: 120, y: 120 } });
    await expect(inspector).toHaveCount(0);
  });

  test('keeps canvas geometry stable while the inspector opens and closes', async ({ page }) => {
    await page.goto('/workflows/wf-001/builder');

    const canvas = page.getByTestId('workflow-canvas');
    const before = await canvas.boundingBox();
    await page.getByTestId('workflow-node').filter({ hasText: 'AI Extract Core' }).click();
    await expect(page.getByTestId('workflow-inspector')).toBeVisible();
    const open = await canvas.boundingBox();

    expect(open?.x).toBe(before?.x);
    expect(open?.width).toBe(before?.width);

    await page.locator('.react-flow__pane').click({ position: { x: 120, y: 120 } });
    await expect(page.getByTestId('workflow-inspector')).toHaveCount(0);
    const after = await canvas.boundingBox();
    expect(after?.width).toBe(before?.width);
  });

  test('keeps state feedback when reduced motion is enabled', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/workflows/wf-001/builder');
    await page.getByRole('button', { name: 'Run test workflow' }).first().click();

    await expect(page.getByTestId('workflow-node').filter({ hasText: 'AI Extract Core' }))
      .toHaveAttribute('data-status', 'success');
    await expect(page.getByTestId('execution-edge-active')).toHaveCount(0);
  });
});

test.describe('OCR workflow node', () => {
  test('adds OCR to the canvas and previews extracted document text', async ({ page }) => {
    await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });
    await page.goto('/workflows/wf-001/builder');

    await page.getByRole('button', { name: 'OCR Text Extract' }).click();

    const inspector = page.getByTestId('workflow-inspector');
    await expect(inspector).toContainText('OCR Text Extract');
    const fileInput = inspector.getByTestId('ocr-file-input');
    await expect(fileInput).toBeVisible();
    await fileInput.setInputFiles({
      name: 'invoice.png',
      mimeType: 'image/png',
      buffer: Buffer.from('mock invoice image'),
    });

    await expect(inspector.getByText('invoice.png', { exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: 'Extract text' }).click();

    const result = inspector.getByTestId('ocr-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText('Detected text');
    await expect(result).toContainText('98.4%');
  });
});

test.describe('workspace account surfaces', () => {
  test('keeps workspace, profile settings, and help surfaces discoverable', async ({ page }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('workspace-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'WEAV Production Workspace', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /mời|invite/i })).toBeVisible();

    await page.goto('/settings/profile');
    await expect(page.getByTestId('settings-profile-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^(Cài đặt|Settings)$/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();

    await page.goto('/help');
    await expect(page.getByTestId('help-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^(Trợ giúp & Tài liệu|Help & Docs)$/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /open guide/i })).toBeVisible();
  });
});

test.describe('AI workflow generator focus', () => {
  test('keeps the first action focused on one prompt and one primary action', async ({ page }) => {
    await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });
    await page.goto('/ai/workflow-generator');

    await expect(page.getByTestId('ai-generator-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create with AI', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'What should this workflow do?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate workflow', exact: true })).toBeVisible();
    await expect(page.getByText('Natural Language to Pipeline AST', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Engine: WEAV Synthesizer/, { exact: false })).toHaveCount(0);
    await expect(page.getByText('Workflow preview', { exact: true })).toBeVisible();
    await expect(page.getByText('5 steps ready', { exact: true })).toBeVisible();
    await expect(page.getByText(/Graph ID:/, { exact: false })).toHaveCount(0);
    await expect(page.getByTestId('technical-details')).not.toHaveAttribute('open', '');
    await expect(page.getByText(/All 5 node interfaces match/, { exact: false })).toHaveCount(0);
  });

  test('shows progress feedback and animated flow cues while generating', async ({ page }) => {
    await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });
    await page.goto('/ai/workflow-generator');

    await page.getByRole('button', { name: 'Generate workflow', exact: true }).click();
    await expect(page.getByTestId('generation-status')).toContainText('Building your workflow');
    await expect(page.getByTestId('preview-flow-dot')).toHaveCount(4);
  });
});

test.describe('dark sidebar palette', () => {
  test('keeps the support footer in the same industrial palette as the sidebar', async ({ page }) => {
    await page.goto('/dashboard');

    const sidebar = page.getByTestId('app-sidebar');
    const footer = sidebar.getByTestId('sidebar-footer');
    await expect(footer).toBeVisible();
    await expect(footer).toHaveClass(/dark:bg-slate-900\/45/);
    await expect(footer).not.toHaveClass(/bg-slate-200\/30/);
  });
});
