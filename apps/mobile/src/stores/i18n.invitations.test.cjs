const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../../test-support/register-typescript.cjs');
const { invitationsVi, invitationsEn } = require('./i18n.invitations.ts');
const { translations } = require('./i18n.store.ts');

test('invitation strings exist in both languages with the same placeholders', () => {
  assert.deepEqual(Object.keys(invitationsVi).sort(), Object.keys(invitationsEn).sort());
  const holders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const key of Object.keys(invitationsVi)) {
    assert.ok(key.startsWith('inv.'), key);
    assert.equal(holders(invitationsVi[key]), holders(invitationsEn[key]), key);
    assert.ok(invitationsVi[key].trim() && invitationsEn[key].trim(), key);
    assert.equal(translations.VI[key], invitationsVi[key], `VI merged ${key}`);
    assert.equal(translations.EN[key], invitationsEn[key], `EN merged ${key}`);
  }
});

test('every i18n key the invitation screens use resolves in both languages', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'app/(app)/invitations/index.tsx',
    'app/(app)/workspace/index.tsx',
    'app/(app)/(tabs)/index.tsx',
    'features/workspace/components/OwnerInvitations.tsx',
    'features/workspace/components/VerifyEmailCard.tsx',
    'features/workspace/invitation.helpers.ts',
  ];
  const keys = new Set();
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/'((?:inv|ui|au)\.[A-Za-z0-9_.]+)'/g)) keys.add(match[1]);
  }
  // Keys built at run time.
  for (const status of ['PENDING', 'EXPIRED', 'ACCEPTED', 'DECLINED', 'REVOKED']) keys.add(`inv.owner.status.${status}`);
  assert.ok(keys.size > 25, `only ${keys.size} keys found`);
  const missing = [...keys].filter((key) => !translations.VI[key] || !translations.EN[key]);
  assert.deepEqual(missing, []);
});
