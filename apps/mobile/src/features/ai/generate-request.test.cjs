const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { buildGenerateRequest, shouldForgetDraft } = require('./generate-request.ts');

test('generate request allows blanks and never carries answers or connections', () => {
  const req = buildGenerateRequest('  gui email moi sang ', 'Asia/Ho_Chi_Minh');
  assert.deepEqual(req, { prompt: 'gui email moi sang', timezone: 'Asia/Ho_Chi_Minh', allowBlanks: true });
  assert.equal('answers' in req, false);
  assert.equal('connections' in req, false);
});

test('a half-made draft is forgotten only when the save stage ends in another workspace', () => {
  assert.equal(shouldForgetDraft('save', true), true);
  assert.equal(shouldForgetDraft('save', false), false);
  assert.equal(shouldForgetDraft('generate', true), false);
});
