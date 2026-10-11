const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const {
  buildTemplateListRequest,
  buildTemplateDetailRequest,
  buildTemplateByCodeRequest,
  buildUseTemplateRequest,
} = require('./template.http.contract.ts');

const TPL = '55555555-5555-4555-8555-555555555555';
const WS = '11111111-1111-4111-8111-111111111111';

test('template list: scope and page params, q trimmed and omitted when blank', () => {
  assert.deepEqual(buildTemplateListRequest('public', { q: '  hoa don ', page: 1, size: 20 }), {
    url: '/api/v1/templates',
    params: { scope: 'public', q: 'hoa don', page: 1, size: 20 },
  });
  assert.deepEqual(buildTemplateListRequest('mine').params, { scope: 'mine' });
  assert.deepEqual(buildTemplateListRequest('public', { q: '   ', page: 0 }).params, { scope: 'public', page: 0 });
  assert.throws(() => buildTemplateListRequest('workspace'), /scope/i);
  assert.throws(() => buildTemplateListRequest('public', { page: -1 }), /page/i);
  assert.throws(() => buildTemplateListRequest('public', { size: 101 }), /size/i);
});

test('template detail and use need uuid ids', () => {
  assert.equal(buildTemplateDetailRequest(TPL).url, `/api/v1/templates/${TPL}`);
  assert.throws(() => buildTemplateDetailRequest('abc'), /template id/i);
  assert.deepEqual(buildUseTemplateRequest(TPL, WS), {
    method: 'POST',
    url: `/api/v1/templates/${TPL}/use`,
    data: { workspaceId: WS },
  });
  assert.deepEqual(buildUseTemplateRequest(TPL, WS, 'Bản sao').data, { workspaceId: WS, name: 'Bản sao' });
  assert.throws(() => buildUseTemplateRequest('abc', WS), /template id/i);
  assert.throws(() => buildUseTemplateRequest(TPL, ''), /workspace/i);
  assert.throws(() => buildUseTemplateRequest(TPL, WS, '  '), /name/i);
  assert.throws(() => buildUseTemplateRequest(TPL, WS, 'x'.repeat(256)), /name/i);
});

test('code lookup: trimmed, percent-encoded, empty and over-long rejected before any request', () => {
  assert.equal(buildTemplateByCodeRequest('  wv7k-3m9q ').url, '/api/v1/templates/by-code/wv7k-3m9q');
  assert.equal(buildTemplateByCodeRequest('wv7k 3m9q').url, '/api/v1/templates/by-code/wv7k%203m9q');
  assert.equal(buildTemplateByCodeRequest('a/../b?x=1').url, '/api/v1/templates/by-code/a%2F..%2Fb%3Fx%3D1');
  assert.equal(buildTemplateByCodeRequest('x'.repeat(32)).url.endsWith('x'.repeat(32)), true);
  assert.throws(() => buildTemplateByCodeRequest('x'.repeat(33)), /code/i);
  assert.throws(() => buildTemplateByCodeRequest('   '), /code/i);
  assert.throws(() => buildTemplateByCodeRequest(''), /code/i);
});
