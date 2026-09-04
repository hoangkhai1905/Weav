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

test.describe('workflow operations list', () => {
  test('filters rows without losing operational context', async ({ page }) => {
    await page.goto('/workflows');

    const rows = page.getByTestId('workflow-row');
    await expect(rows.first()).toBeVisible();
    await page.getByRole('textbox', { name: 'Search workflows', exact: true }).fill('Invoice');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId('workflow-glyph')).toBeVisible();
  });

  test('opens row actions with an accessible trigger', async ({ page }) => {
    await page.goto('/workflows');
    const rows = page.getByTestId('workflow-row');
    await expect(rows).toHaveCount(3);
    const firstRow = rows.first();
    await firstRow.getByRole('button', { name: 'More workflow actions' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
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

  test('keeps state feedback when reduced motion is enabled', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/workflows/wf-001/builder');
    await page.getByRole('button', { name: 'Run test workflow' }).first().click();

    await expect(page.getByTestId('workflow-node').filter({ hasText: 'AI Extract Core' }))
      .toHaveAttribute('data-status', 'success');
    await expect(page.getByTestId('execution-edge-active')).toHaveCount(0);
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
