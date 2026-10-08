const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { fieldErrorsFromError } = require('./field-errors.ts');

test('maps details[].field to a message and keeps the first message per field', () => {
  const error = {
    code: 'VALIDATION_FAILED',
    details: [
      { field: 'email', message: 'must be a valid email' },
      { field: 'email', message: 'second' },
      { field: 'password', message: 'too short' },
    ],
  };
  assert.deepEqual(fieldErrorsFromError(error), { email: 'must be a valid email', password: 'too short' });
});

test('ignores plain-string details, missing details and non-errors', () => {
  assert.deepEqual(fieldErrorsFromError({ details: ['bad body'] }), {});
  assert.deepEqual(fieldErrorsFromError({ details: [{ message: 'no field' }, null] }), {});
  assert.deepEqual(fieldErrorsFromError(null), {});
  assert.deepEqual(fieldErrorsFromError(new Error('x')), {});
});
