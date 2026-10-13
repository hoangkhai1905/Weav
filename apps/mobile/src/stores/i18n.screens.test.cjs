const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../../test-support/register-typescript.cjs');
const { translations } = require('./i18n.store.ts');
const { TEMPLATE_GROUPS } = require('../features/templates/template.helpers.ts');
const { RUN_FILTERS } = require('../features/executions/run-list.ts');

// v2 redesign screens: every literal i18n key they reference must exist in both languages.
const FILES = [
  'app/(app)/(tabs)/index.tsx',
  'app/(app)/(tabs)/workflows.tsx',
  'app/(app)/(tabs)/executions.tsx',
  'app/(app)/(tabs)/profile.tsx',
  'app/(app)/notifications.tsx',
  'app/(app)/executions/[workflowId]/[executionId].tsx',
  'app/(app)/workflows/[id].tsx',
  'components/ui/NodeTimeline.tsx',
  'features/workflows/components/FlowCards.tsx',
  'components/ui/AppTabBar.tsx',
  'components/ui/HeaderActions.tsx',
  'components/ui/SearchField.tsx',
  'features/workflows/components/TeamWorkflowsPane.tsx',
  'features/workflows/components/WorkflowCard.tsx',
  'features/templates/components/TemplatesPane.tsx',
  'features/templates/components/TemplateCard.tsx',
];
const PREFIXES = ['wfl', 'tpl', 'hm', 'nav', 'ui', 'tab', 'dash', 'inv', 'exl', 'rl', 'ntf', 'rd', 'exd', 'wfd', 'pub', 'del', 'log', 'execution', 'prof', 'profile', 'ws', 'notif'];

test('every i18n key used by the v2 screens resolves in both languages', () => {
  const root = path.join(__dirname, '..');
  const missing = [];
  let checked = 0;
  for (const file of FILES) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/'([a-z]+\.[A-Za-z0-9_.]+)'/g)) {
      const key = match[1];
      if (!PREFIXES.includes(key.split('.')[0])) continue;
      checked += 1;
      if (!translations.VI[key] || !translations.EN[key]) missing.push(`${file}: ${key}`);
    }
  }
  assert.ok(checked > 40, `only ${checked} keys found`);
  assert.deepEqual(missing, []);
});

test('run-time built keys exist: template groups', () => {
  for (const group of TEMPLATE_GROUPS) {
    assert.ok(translations.VI[`tpl.group.${group}`] && translations.EN[`tpl.group.${group}`], group);
  }
  assert.ok(translations.VI['tpl.group.all'] && translations.EN['tpl.group.all']);
});

test('run-time built keys exist: run filters', () => {
  for (const filter of RUN_FILTERS) {
    assert.ok(translations.VI[`rl.filter.${filter}`] && translations.EN[`rl.filter.${filter}`], filter);
  }
});

test('history strings exist in both languages with the same placeholders', () => {
  const { historyVi, historyEn } = require('./i18n.history.ts');
  assert.deepEqual(Object.keys(historyVi).sort(), Object.keys(historyEn).sort());
  const holders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const key of Object.keys(historyVi)) assert.equal(holders(historyVi[key]), holders(historyEn[key]), key);
});
