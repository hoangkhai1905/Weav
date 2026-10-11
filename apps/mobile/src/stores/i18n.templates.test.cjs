const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../../test-support/register-typescript.cjs');
const { templatesVi, templatesEn } = require('./i18n.templates.ts');
const { translations } = require('./i18n.store.ts');
const { templateErrorKey } = require('../features/templates/template.helpers.ts');

test('template strings exist in both languages with the same placeholders', () => {
  assert.deepEqual(Object.keys(templatesVi).sort(), Object.keys(templatesEn).sort());
  const holders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const key of Object.keys(templatesVi)) {
    assert.equal(holders(templatesVi[key]), holders(templatesEn[key]), key);
    assert.ok(templatesVi[key].trim() && templatesEn[key].trim(), key);
    assert.equal(translations.VI[key], templatesVi[key], `VI merged ${key}`);
    assert.equal(translations.EN[key], templatesEn[key], `EN merged ${key}`);
  }
});

test('every i18n key the template screens and helpers use resolves in both languages', () => {
  const root = path.join(__dirname, '..');
  const missing = [];
  const keys = new Set();
  for (const file of ['app/(app)/templates/index.tsx', 'app/(app)/templates/[id].tsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/'((?:tpl|ui|ai)\.[A-Za-z0-9_.]+)'/g)) keys.add(match[1]);
  }
  // Keys built at run time.
  for (const tab of ['public', 'mine']) keys.add(`tpl.tab.${tab}`);
  for (const v of ['PUBLIC', 'UNLISTED', 'PRIVATE']) {
    keys.add(`tpl.visibility.${v}`);
    keys.add(`tpl.visibility.hint.${v}`);
  }
  for (const e of ['public', 'noMatch', 'mine']) {
    keys.add(`tpl.empty.${e}.title`);
    keys.add(`tpl.empty.${e}.body`);
  }
  for (const phase of ['lookup', 'use', 'load']) {
    for (const status of [undefined, 404, 403, 429, 500]) keys.add(templateErrorKey({ status }, phase));
  }
  assert.ok(keys.size > 30, `only ${keys.size} keys found`);
  for (const key of keys) {
    if (!translations.VI[key] || !translations.EN[key]) missing.push(key);
  }
  assert.deepEqual(missing, []);
});
