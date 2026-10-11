const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { nodeErrorParts, nodeErrorSummary } = require('./node-error.ts');
const { runsVi, runsEn } = require('../../stores/i18n.runs.ts');
const { translations } = require('../../stores/i18n.store.ts');

const tVi = (key) => translations.VI[key] ?? key;

test('reads code, message and details.field from an object or JSON text', () => {
  const error = { code: 'CONFIGURATION_ERROR', message: "The 'to' field is not a valid email address.", details: { field: 'to' } };
  assert.deepEqual(nodeErrorParts(error), { code: 'CONFIGURATION_ERROR', message: error.message, field: 'to' });
  assert.deepEqual(nodeErrorParts(JSON.stringify(error)), nodeErrorParts(error));
  assert.deepEqual(nodeErrorParts('plain text'), { code: null, message: 'plain text', field: null });
  assert.deepEqual(nodeErrorParts(null), { code: null, message: null, field: null });
});

test('summary: field label + friendly text; missing mapping; unknown field and code fall back', () => {
  assert.equal(
    nodeErrorSummary({ code: 'CONFIGURATION_ERROR', message: 'x', details: { field: 'to' } }, tVi),
    `Người nhận: ${runsVi['runs.err.CONFIGURATION_ERROR']}`,
  );
  assert.equal(
    nodeErrorSummary({ code: 'MAPPING_ERROR', message: "The 'text' field refers to a value that is missing.", details: { field: 'text' } }, tVi),
    `Văn bản: ${runsVi['runs.err.MAPPING_MISSING']}`,
  );
  assert.equal(nodeErrorSummary({ code: 'SOMETHING_NEW', message: 'Raw', details: { field: 'weird' } }, tVi), 'weird: Raw');
  assert.equal(nodeErrorSummary({ code: 'SOMETHING_NEW' }, tVi), null);
  assert.equal(nodeErrorSummary(null, tVi), null);
});

test('run strings exist in both languages and are merged into the store', () => {
  assert.deepEqual(Object.keys(runsVi).sort(), Object.keys(runsEn).sort());
  for (const key of Object.keys(runsVi)) {
    assert.equal(translations.VI[key], runsVi[key]);
    assert.equal(translations.EN[key], runsEn[key]);
  }
});
