const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../../test-support/register-typescript.cjs');
const { homeVi, homeEn } = require('./i18n.home.ts');
const { translations } = require('./i18n.store.ts');

test('home strings exist in both languages with the same placeholders', () => {
  assert.deepEqual(Object.keys(homeVi).sort(), Object.keys(homeEn).sort());
  const holders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const key of Object.keys(homeVi)) {
    assert.equal(holders(homeVi[key]), holders(homeEn[key]), key);
    assert.ok(homeVi[key].trim() && homeEn[key].trim(), key);
    assert.equal(translations.VI[key], homeVi[key], `VI merged ${key}`);
    assert.equal(translations.EN[key], homeEn[key], `EN merged ${key}`);
  }
});

test('every hm.* key the home screen uses resolves in both languages', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app/(app)/(tabs)/index.tsx'), 'utf8');
  const keys = new Set([...source.matchAll(/'(hm\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]));
  for (const part of ['morning', 'afternoon', 'evening']) {
    keys.add(`hm.greet.${part}`);
    keys.add(`hm.greet.${part}.anon`);
  }
  assert.ok(keys.size >= 12, `only ${keys.size} keys found`);
  for (const key of keys) assert.ok(translations.VI[key] && translations.EN[key], key);
});
