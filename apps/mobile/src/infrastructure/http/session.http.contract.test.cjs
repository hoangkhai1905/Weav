const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SESSIONS_PATH,
  buildListSessionsRequest,
  buildRevokeSessionRequest,
  buildRevokeAllSessionsRequest,
  mapSessionPageResponse,
  assertSessionMutationResponse,
  mapSessionError,
} = require('./session.http.contract.ts');

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

test('builds the Gateway session list and revoke routes with contract pagination', () => {
  assert.deepEqual(buildListSessionsRequest(2, 10), {
    method: 'GET',
    url: SESSIONS_PATH,
    params: { page: 2, size: 10 },
  });
  assert.deepEqual(buildRevokeSessionRequest(SESSION_ID), {
    method: 'DELETE',
    url: `${SESSIONS_PATH}/${SESSION_ID}`,
  });
  assert.deepEqual(buildRevokeAllSessionsRequest(), {
    method: 'DELETE',
    url: SESSIONS_PATH,
  });
  assert.equal(SESSIONS_PATH, '/api/auth/sessions');
});

test('maps only safe SessionPageResponse metadata and preserves current/pagination fields', () => {
  assert.deepEqual(
    mapSessionPageResponse({
      items: [{
        id: SESSION_ID,
        createdAt: '2026-09-22T00:00:00Z',
        lastUsedAt: null,
        expiresAt: '2026-10-22T00:00:00Z',
        current: true,
        userAgent: 'Weav-Mobile',
        ipAddress: 'must-not-be-exposed',
        refreshToken: 'must-not-be-exposed',
      }],
      page: 1,
      size: 1,
      totalItems: 3,
      totalPages: 3,
    }),
    {
      items: [{
        id: SESSION_ID,
        createdAt: '2026-09-22T00:00:00Z',
        lastUsedAt: null,
        expiresAt: '2026-10-22T00:00:00Z',
        current: true,
        userAgent: 'Weav-Mobile',
      }],
      page: 1,
      size: 1,
      totalItems: 3,
      totalPages: 3,
    },
  );
  assert.throws(
    () => mapSessionPageResponse({ items: [], page: -1, size: 20, totalItems: 0, totalPages: 0 }),
    (error) => error.code === 'INVALID_RESPONSE',
  );
});

test('accepts only 204 for session mutations and maps safe HTTP failures', () => {
  assert.doesNotThrow(() => assertSessionMutationResponse(204));
  assert.throws(
    () => assertSessionMutationResponse(200),
    (error) => error.code === 'SESSION_ERROR' && error.status === 200,
  );
  assert.equal(mapSessionError(401).code, 'UNAUTHORIZED');
  assert.equal(mapSessionError(403).code, 'FORBIDDEN');
  assert.equal(mapSessionError(404).code, 'NOT_FOUND');
  assert.equal(mapSessionError(400).code, 'VALIDATION_FAILED');
  assert.equal(mapSessionError().code, 'SESSION_ERROR');
});
