import type { Page } from '@playwright/test';

export async function loginAndOpenBuilder(page: Page): Promise<void> {
  await page.addInitScript({ content: "window.localStorage.setItem('weav_lang_v1', 'EN')" });
  await page.goto('/workflows/wf-001/builder');
}

export async function addNode(page: Page, nodeType: string): Promise<void> {
  await page.getByTestId('workflow-add-step').click();
  await page.locator(`[data-testid="workflow-palette-item"][data-node-type="${nodeType}"]`).click();
}
