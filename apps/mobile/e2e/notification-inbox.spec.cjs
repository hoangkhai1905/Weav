const path = require('node:path');
const { test, expect } = require(require.resolve('@playwright/test', {
  paths: [path.resolve(__dirname, '../../web')],
}));

test('Expo Web mock inbox filtering, read state, safe target and existing milestone toast', async ({ page }) => {
  const runtimeFailures = [];
  page.on('pageerror', () => runtimeFailures.push('pageerror'));
  await page.goto('/notifications');

  await expect(page.getByText('Thông báo & Cảnh báo', { exact: true })).toBeVisible();
  const workflowItem = page.getByTestId('notification-item-00000000-0000-4000-8000-000000000010');
  await expect(workflowItem).toContainText('Quy trình đã hoàn tất');
  await workflowItem.getByTestId('notification-read-00000000-0000-4000-8000-000000000010').click();
  await expect(workflowItem.getByText('Đã đọc', { exact: true })).toBeVisible();
  await expect(page.getByLabel('1 chưa đọc')).toBeVisible();

  await page.getByTestId('notification-category-security').click();
  const securityItem = page.getByTestId('notification-item-00000000-0000-4000-8000-000000000008');
  await expect(securityItem).toBeVisible();
  await securityItem.getByTestId('notification-open-00000000-0000-4000-8000-000000000008').click();
  await expect(page).toHaveURL(/\/settings(?:\?.*)?$/);
  await expect(page.getByText('Cài đặt & Bảo mật', { exact: true })).toBeVisible();

  await page.getByText('🇻🇳 VI', { exact: true }).click();
  await expect(page.getByText('🇬🇧 English', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Notifications & Alerts', { exact: true })).toBeVisible();
  await expect(page.getByTestId('notification-item-00000000-0000-4000-8000-000000000008'))
    .toContainText('Password changed');

  await page.getByTestId('notification-mark-all-read').click();
  await expect(page.getByLabel('0 unread')).toBeVisible();

  await page.goto('/workspace');
  await page.getByTestId('workspace-create-name').fill('Task9 browser smoke');
  await page.getByTestId('workspace-create-submit').click();
  await expect(page.getByText('Đã tạo không gian', { exact: true })).toBeVisible();
  await expect(page.getByText('Đã tạo không gian', { exact: true })).toHaveCount(1);

  await page.goto('/workflows');
  await expect(page.getByText('Quản lý Quy trình', { exact: true })).toBeVisible();
  await page.getByText('Chạy ngay', { exact: true }).first().click();
  await page.getByText('Execute Workflow', { exact: true }).click();
  await expect(page).toHaveURL(/\/executions\/exec-/);
  await expect(page.getByText('Đã gửi lượt chạy', { exact: true })).toBeVisible();
  await expect(page.getByText('Đã gửi lượt chạy', { exact: true })).toHaveCount(1);

  await page.goto('/workflows');
  await page.getByText('Invoice OCR → AI Extract → Google Sheets', { exact: true }).first().click();
  await expect(page).toHaveURL(/\/workflows\/wf-001$/);
  await page.getByText('Run Workflow Now', { exact: true }).click();
  await page.getByText('Execute Now', { exact: true }).click();
  await expect(page).toHaveURL(/\/executions\/exec-/);
  await expect(page.getByText('Đã gửi lượt chạy', { exact: true })).toBeVisible();
  expect(runtimeFailures).toEqual([]);
});
