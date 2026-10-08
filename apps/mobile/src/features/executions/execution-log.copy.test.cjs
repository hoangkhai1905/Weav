const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { KNOWN_LOG_EVENTS, logEventKey } = require('./execution-log.copy.ts');
const { translations } = require('../../stores/i18n.store.ts');

test('known log events map to their own friendly sentence, unknown ones to the generic line', () => {
  for (const code of KNOWN_LOG_EVENTS) assert.equal(logEventKey(code), `exd.logs.event.${code}`);
  assert.equal(logEventKey('SOMETHING_NEW'), 'exd.logs.event.unknown');
  assert.equal(logEventKey(''), 'exd.logs.event.unknown');
});

test('every log sentence exists in both languages and never shows the raw code', () => {
  const keys = [...KNOWN_LOG_EVENTS.map(logEventKey), 'exd.logs.event.unknown', 'exd.logs.technical'];
  for (const lang of ['VI', 'EN']) {
    for (const key of keys) {
      const text = translations[lang][key];
      assert.ok(text && text.trim(), `${lang} ${key}`);
      assert.ok(!/[A-Z]{3,}_[A-Z_]+/.test(text), `${lang} ${key} leaks a code`);
    }
  }
});
