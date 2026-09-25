const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  CURRENT_USER_PATH,
  buildGetCurrentUserRequest,
  buildUpdateCurrentUserRequest,
  mapIdentityUser,
} = require('./profile.http.contract.ts');

const USER_ID = '11111111-1111-4111-8111-111111111111';

test('builds the authenticated GET current-user request on the Gateway alias', () => {
  assert.deepEqual(buildGetCurrentUserRequest(), {
    method: 'GET',
    url: CURRENT_USER_PATH,
  });
  assert.equal(CURRENT_USER_PATH, '/api/auth/me');
});

test('builds the PATCH request with only the contract-supported displayName', () => {
  assert.deepEqual(buildUpdateCurrentUserRequest('  Ada  '), {
    method: 'PATCH',
    url: CURRENT_USER_PATH,
    data: { displayName: '  Ada  ' },
  });
});

test('maps the public Identity response without accepting editable metadata', () => {
  assert.deepEqual(
    mapIdentityUser({
      id: USER_ID,
      email: 'ada@example.com',
      displayName: 'Ada',
      avatarStorageKey: 'avatar-key-is-not-editable',
      systemRole: 'USER',
      status: 'ACTIVE',
    }),
    {
      id: USER_ID,
      email: 'ada@example.com',
      name: 'Ada',
      avatar: null,
    },
  );
});
