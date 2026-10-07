const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const {
  buildConnectionListRequest,
  buildConnectionDetailRequest,
  buildTestConnectionRequest,
  buildDisableConnectionRequest,
} = require('./connection.http.contract.ts');

const WS = '11111111-1111-4111-8111-111111111111';
const CN = '44444444-4444-4444-8444-444444444444';

test('connection routes live under the workspace', () => {
  const base = `/api/v1/workspaces/${WS}/connections`;
  assert.equal(buildConnectionListRequest(WS).url, base);
  assert.equal(buildConnectionDetailRequest(WS, CN).url, `${base}/${CN}`);
  assert.deepEqual(buildTestConnectionRequest(WS, CN), { method: 'POST', url: `${base}/${CN}/test` });
  assert.deepEqual(buildDisableConnectionRequest(WS, CN), { method: 'POST', url: `${base}/${CN}/disable` });
  assert.throws(() => buildTestConnectionRequest(WS, 'x'), /connection/i);
  assert.throws(() => buildConnectionListRequest('x'), /workspace/i);
});
