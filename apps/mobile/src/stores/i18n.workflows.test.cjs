const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../test-support/register-typescript.cjs');
const { workflowsVi, workflowsEn } = require('./i18n.workflows.ts');
const { translations } = require('./i18n.store.ts');

const KEYS = [
  'wfd.setup.summary', 'wfd.setup.hint', 'wfd.setup.graph', 'wfd.setup.pill', 'wfd.setup.publishCaption',
  'workflows.readiness.notAuthorized', 'workflows.readiness.pickAccount', 'workflows.readiness.missingField',
  'workflows.readiness.generic', 'wfd.setup.sheetSubtitle', 'wfd.setup.missing', 'wfd.setup.openWeb',
  'wfd.setup.share', 'wfd.setup.noUrl',
];

test('setup-on-web strings exist in VI and EN with the same placeholders', () => {
  const holders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const key of KEYS) {
    assert.ok(workflowsVi[key]?.trim() && workflowsEn[key]?.trim(), key);
    assert.equal(holders(workflowsVi[key]), holders(workflowsEn[key]), key);
    assert.equal(translations.VI[key], workflowsVi[key], key);
    assert.equal(translations.EN[key], workflowsEn[key], key);
  }
  assert.equal(workflowsVi['wfd.setup.summary'], 'Còn {n} bước cần thiết lập');
  assert.equal(workflowsEn['wfd.setup.openWeb'], 'Open this step on the web');
});
