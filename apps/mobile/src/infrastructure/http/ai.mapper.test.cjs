const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { mapGenerationResult } = require('./ai.mapper.ts');

test('ready keeps the definition and takes node positions from layout', () => {
  const result = mapGenerationResult({
    status: 'ready',
    name: 'Report',
    definition: {
      schemaVersion: '1.0',
      nodes: [{ id: 'n1', type: 'trigger.manual', config: {} }],
      edges: [],
    },
    layout: { n1: { x: 10, y: 20 } },
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.definition.nodes[0].type, 'trigger.manual');
  assert.deepEqual(result.nodes[0].position, { x: 10, y: 20 });
  assert.equal(result.nodes[0].name, null);
});

test('needs_input supports CONNECTION and "<nodeType>.<field>" VALUE questions', () => {
  const result = mapGenerationResult({
    status: 'needs_input',
    questions: [
      { code: 'CONNECTION', field: 'email.send' },
      { code: 'VALUE', field: 'email.send.body' },
    ],
  });
  assert.deepEqual(result.questions.map((q) => q.code), ['CONNECTION', 'VALUE']);
  assert.throws(
    () => mapGenerationResult({ status: 'needs_input', questions: [{ code: 'OTHER', field: 'x' }] }),
    /code/,
  );
});

test('unsupported supports INVALID_INTENT; unknown status is rejected', () => {
  const result = mapGenerationResult({ status: 'unsupported', reasons: [{ code: 'INVALID_INTENT' }] });
  assert.deepEqual(result.reasons, [{ code: 'INVALID_INTENT' }]);
  assert.throws(() => mapGenerationResult({ status: 'maybe' }), /status/);
});
