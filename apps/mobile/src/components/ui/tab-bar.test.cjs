const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { activeTab, tabBarHidden, MAIN_TABS } = require('./tab-bar.ts');

test('main routes and their detail screens map to one of four tabs', () => {
  const cases = {
    '/': 'home',
    '/workflows': 'workflows',
    '/workflows/abc': 'workflows',
    '/templates': 'workflows',
    '/templates/t1': 'workflows',
    '/executions': 'executions',
    '/executions/w1/e1': 'executions',
    '/executions/lookup/e1': 'executions',
    '/profile': 'profile',
    '/settings': 'profile',
    '/connections': 'profile',
    '/workspace/': 'profile',
    '/invitations': 'profile',
    '/assistant': 'profile',
    '/notifications': null,
  };
  for (const [path, tab] of Object.entries(cases)) assert.equal(activeTab(path), tab, path);
  assert.equal(MAIN_TABS.length, 4);
});

test('the bar hides only on the AI composer and assistant chat', () => {
  assert.equal(tabBarHidden('/ai/generator'), true);
  assert.equal(tabBarHidden('/assistant/chat'), true);
  assert.equal(tabBarHidden('/assistant'), false);
  assert.equal(tabBarHidden('/workflows/abc'), false);
});
