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
