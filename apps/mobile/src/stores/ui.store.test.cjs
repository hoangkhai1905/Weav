const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../test-support/register-typescript.cjs');
const { useUIStore } = require('./ui.store.ts');

test('the app starts in the light theme and the user can still pick another', () => {
  assert.equal(useUIStore.getState().themeMode, 'light');
  useUIStore.getState().setThemeMode('system');
  assert.equal(useUIStore.getState().themeMode, 'system');
  useUIStore.getState().setThemeMode('dark');
  assert.equal(useUIStore.getState().themeMode, 'dark');
});
