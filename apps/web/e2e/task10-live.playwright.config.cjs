const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'notification-task10-live.spec.cjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60 * 1000,
  reporter: 'line',
  outputDir: process.env.WEAV_TASK10_OUTPUT_DIR || path.join(__dirname, '..', 'test-results-task10'),
  use: {
    baseURL: process.env.WEAV_TASK10_WEB_URL || 'http://127.0.0.1:4175',
    ...devices['Desktop Chrome'],
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
