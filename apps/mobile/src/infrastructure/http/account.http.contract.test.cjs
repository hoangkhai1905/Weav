const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const c = require('./account.http.contract.ts');

test('uses the real gateway routes for avatar and linked accounts', () => {
  assert.deepEqual(c.buildGetAvatarRequest(), { method: 'GET', url: '/api/users/me/avatar' });
  const form = { marker: 'form' };
  assert.deepEqual(c.buildUploadAvatarRequest(form), {
    method: 'PUT',
    url: '/api/users/me/avatar',
    data: form,
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000,
  });
  assert.deepEqual(c.buildDeleteAvatarRequest(), { method: 'DELETE', url: '/api/users/me/avatar' });
  assert.deepEqual(c.buildOAuthAccountsRequest(), { method: 'GET', url: '/api/users/me/oauth-accounts' });
});

test('maps the signed avatar URL and rejects anything that is not an http(s) URL', () => {
  assert.equal(c.mapAvatarUrl({ url: 'https://files.example/a.png?sig=1', expiresAt: 'x' }), 'https://files.example/a.png?sig=1');
  assert.throws(() => c.mapAvatarUrl({ url: 'javascript:alert(1)' }), /Invalid response/);
  assert.throws(() => c.mapAvatarUrl(null), /Invalid response/);
});

test('maps linked Google accounts without extra fields', () => {
  const mapped = c.mapOAuthAccounts([
    { id: 'a1', provider: 'GOOGLE', providerEmail: 'me@gmail.com', createdAt: '2026-10-01T00:00:00Z', updatedAt: 'x', secret: 's' },
    { id: 'a2', provider: 'GOOGLE', providerEmail: null, createdAt: '2026-10-02T00:00:00Z' },
  ]);
  assert.deepEqual(mapped, [
    { id: 'a1', provider: 'GOOGLE', providerEmail: 'me@gmail.com', createdAt: '2026-10-01T00:00:00Z' },
    { id: 'a2', provider: 'GOOGLE', providerEmail: null, createdAt: '2026-10-02T00:00:00Z' },
  ]);
  assert.throws(() => c.mapOAuthAccounts({}), /Invalid response/);
  assert.throws(() => c.mapOAuthAccounts([{ id: 'x', provider: 'FACEBOOK' }]), /Invalid response/);
});
