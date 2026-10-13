const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { stepKind } = require('./step-kind.ts');

test('node types map to the four step colour families', () => {
  assert.equal(stepKind('trigger.gmail'), 'trigger');
  assert.equal(stepKind('trigger.schedule'), 'trigger');
  assert.equal(stepKind('ai.extract'), 'ai');
  assert.equal(stepKind('logic.condition'), 'logic');
  assert.equal(stepKind('google.sheets'), 'action');
  assert.equal(stepKind('email.send'), 'action');
  assert.equal(stepKind('something.new'), 'action');
});
