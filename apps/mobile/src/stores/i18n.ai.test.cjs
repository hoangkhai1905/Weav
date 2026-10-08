const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../test-support/register-typescript.cjs');
const { aiVi, aiEn } = require('./i18n.ai.ts');
const { translations } = require('./i18n.store.ts');

test('Home / AI generator / assistant strings exist in both languages with the same placeholders', () => {
  assert.deepEqual(Object.keys(aiVi).sort(), Object.keys(aiEn).sort());
  const holders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const key of Object.keys(aiVi)) {
    assert.equal(holders(aiVi[key]), holders(aiEn[key]), key);
    assert.ok(aiVi[key].trim() && aiEn[key].trim(), key);
    assert.equal(translations.VI[key], aiVi[key]);
    assert.equal(translations.EN[key], aiEn[key]);
  }
});

test('every unsupported reason, question field and weekday used by the screens has copy', () => {
  for (const code of ['CAPABILITY_UNAVAILABLE', 'OUT_OF_SCOPE', 'AMBIGUOUS_REQUEST', 'INVALID_INTENT']) {
    assert.ok(aiVi[`aig.reason.${code}`], code);
  }
  for (const code of ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']) assert.ok(aiVi[`aig.sched.weekday.${code}`], code);
  for (const code of ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']) {
    assert.ok(aiVi[`aig.sched.freq.${code}`] && aiVi[`aig.sched.sentence.${code}`], code);
  }
  for (const code of ['GMAIL', 'GOOGLE_SHEETS', 'GOOGLE_CALENDAR', 'GOOGLE_DRIVE', 'TELEGRAM', 'HTTP']) {
    assert.ok(aiVi[`provider.${code}`], code);
  }
});
