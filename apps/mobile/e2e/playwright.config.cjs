const path = require('node:path');
const { defineConfig } = require(require.resolve('@playwright/test', {
  paths: [path.resolve(__dirname, '../../web')],
}));

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'notification-inbox.spec.cjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: process.env.MOBILE_WEB_BASE_URL || 'http://localhost:49821',
    browserName: 'chromium',
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
