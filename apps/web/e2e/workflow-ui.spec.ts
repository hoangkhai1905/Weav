import { test, expect } from '@playwright/test';

test.describe('industrial workflow shell', () => {
  test('shows readable navigation and moves the active indicator to Workflows', async ({ page }) => {
    await page.goto('/workflows');

    const sidebar = page.getByTestId('app-sidebar');
    const workflowsLink = sidebar.getByRole('link', { name: 'Workflows' });

    await expect(sidebar).toBeVisible();
    await expect(workflowsLink).toHaveAttribute('aria-current', 'page');
    await expect(workflowsLink).toHaveCSS('font-size', '14px');
    await expect(workflowsLink.getByTestId('active-nav-indicator')).toBeVisible();
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
