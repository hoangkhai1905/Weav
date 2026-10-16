const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../test-support/register-typescript.cjs');
const { navVi, navEn } = require('./i18n.nav.ts');
const { translations } = require('./i18n.store.ts');

test('navigation strings exist in both languages with the same placeholders', () => {
  assert.deepEqual(Object.keys(navVi).sort(), Object.keys(navEn).sort());
  const holders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const key of Object.keys(navVi)) {
    assert.equal(holders(navVi[key]), holders(navEn[key]), key);
    assert.ok(navVi[key].trim() && navEn[key].trim(), key);
    assert.equal(translations.VI[key], navVi[key], `VI merged ${key}`);
    assert.equal(translations.EN[key], navEn[key], `EN merged ${key}`);
  }
});

test('the four tab labels resolve in both languages', () => {
  for (const key of ['tab.home', 'tab.workflows', 'tab.executions', 'tab.profile']) {
    assert.ok(translations.VI[key] && translations.EN[key], key);
  }
  assert.equal(translations.VI['tab.profile'], 'Tôi');
});
