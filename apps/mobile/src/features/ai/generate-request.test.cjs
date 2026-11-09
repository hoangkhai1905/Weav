const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { buildGenerateRequest } = require('./generate-request.ts');

test('generate request allows blanks and never carries answers or connections', () => {
  const req = buildGenerateRequest('  gui email moi sang ', 'Asia/Ho_Chi_Minh');
  assert.deepEqual(req, { prompt: 'gui email moi sang', timezone: 'Asia/Ho_Chi_Minh', allowBlanks: true });
  assert.equal('answers' in req, false);
  assert.equal('connections' in req, false);
});
