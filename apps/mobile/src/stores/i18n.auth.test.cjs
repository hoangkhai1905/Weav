const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../test-support/register-typescript.cjs');
const { authVi, authEn } = require('./i18n.auth.ts');
const { translations } = require('./i18n.store.ts');

test('auth strings exist in both languages with the same placeholders and are merged into the store', () => {
  assert.deepEqual(Object.keys(authVi).sort(), Object.keys(authEn).sort());
  const holders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const key of Object.keys(authVi)) {
    assert.equal(holders(authVi[key]), holders(authEn[key]), key);
    assert.ok(authVi[key].trim() && authEn[key].trim(), key);
    assert.equal(translations.VI[key], authVi[key]);
    assert.equal(translations.EN[key], authEn[key]);
  }
});

test('TextField password toggle labels exist', () => {
  assert.ok(authVi['ui.showPassword'] && authVi['ui.hidePassword']);
});
