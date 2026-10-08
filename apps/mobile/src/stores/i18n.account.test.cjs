const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../../test-support/register-typescript.cjs');
const { accountVi, accountEn } = require('./i18n.account.ts');
const { translations } = require('./i18n.store.ts');

test('account strings exist in both languages with the same placeholders', () => {
  assert.deepEqual(Object.keys(accountVi).sort(), Object.keys(accountEn).sort());
  const holders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const key of Object.keys(accountVi)) {
    assert.equal(holders(accountVi[key]), holders(accountEn[key]), key);
    assert.ok(accountVi[key].trim() && accountEn[key].trim(), key);
    assert.equal(translations.VI[key], accountVi[key], `VI merged ${key}`);
    assert.equal(translations.EN[key], accountEn[key], `EN merged ${key}`);
  }
});

test('every i18n key the Lane C screens reference resolves in both languages', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'app/(app)/workspace/index.tsx',
    'app/(app)/connections/index.tsx',
    'app/(app)/(tabs)/notifications.tsx',
    'app/(app)/(tabs)/profile.tsx',
    'app/(app)/settings/index.tsx',
    'features/workspace/components/MemberCard.tsx',
    'features/connections/components/ConnectionCard.tsx',
    'components/ui/TextField.tsx',
  ];
  const prefixes = ['ws', 'conn', 'ntf', 'prof', 'sec', 'val', 'notif', 'ui', 'tab', 'profile', 'provider'];
  const missing = [];
  let checked = 0;
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/'([a-z]+\.[A-Za-z0-9_.]+)'/g)) {
      const key = match[1];
      if (!prefixes.includes(key.split('.')[0])) continue;
      checked += 1;
      if (!translations.VI[key] || !translations.EN[key]) missing.push(`${file}: ${key}`);
    }
  }
  assert.ok(checked > 100, `only ${checked} keys found`);
  assert.deepEqual(missing, []);
});

test('connection copy covers every provider and test outcome', () => {
  for (const p of ['GMAIL', 'GOOGLE_SHEETS', 'GOOGLE_CALENDAR', 'GOOGLE_DRIVE', 'TELEGRAM', 'HTTP']) {
    assert.ok(translations.VI[`provider.${p}`] && translations.EN[`provider.${p}`], p);
  }
  for (const o of ['VERIFIED', 'AUTH_INVALID', 'DEPENDENCY_FAILURE']) {
    assert.ok(accountVi[`conn.test.${o}`] && accountEn[`conn.test.${o}`], o);
  }
});
