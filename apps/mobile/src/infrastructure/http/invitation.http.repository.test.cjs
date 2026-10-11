const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const axios = require('axios');
const { httpClient } = require('./http-client.ts');
const { HttpWorkspaceRepository } = require('./http-workspace.repository.ts');
const { isUserNotFound } = require('../../features/workspace/invitation.helpers.ts');

const WS = '11111111-1111-4111-8111-111111111111';
const INV = '66666666-6666-4666-8666-666666666666';

const originalRequest = httpClient.request;
afterEach(() => {
  httpClient.request = originalRequest;
});

const httpError = (status, code) =>
  new axios.AxiosError('failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    data: { code, message: 'raw backend text', requestId: 'r1' },
    headers: {},
  });

test('repository sends the documented routes and maps the answers', async () => {
  const seen = [];
  httpClient.request = async (config) => {
    seen.push(`${config.method ?? 'GET'} ${config.url}`);
    if (config.url.endsWith('/accept')) return { data: { workspaceId: WS } };
    if (config.url === '/api/v1/invitations') return { data: { items: [], emailVerified: false } };
    return { data: undefined, status: 204 };
  };
  const repo = new HttpWorkspaceRepository();
  assert.deepEqual(await repo.acceptInvitation(INV), { workspaceId: WS });
  assert.deepEqual(await repo.listMyInvitations(), { items: [], emailVerified: false });
  await repo.declineInvitation(INV);
  await repo.revokeInvitation(WS, INV);
  assert.deepEqual(seen, [
    `POST /api/v1/invitations/${INV}/accept`,
    'GET /api/v1/invitations',
    `POST /api/v1/invitations/${INV}/decline`,
    `DELETE /api/v1/workspaces/${WS}/invitations/${INV}`,
  ]);
});

test('a malformed body is INVALID_RESPONSE, not a crash', async () => {
  httpClient.request = async () => ({ data: { items: 'nope' } });
  await assert.rejects(new HttpWorkspaceRepository().listInvitations(WS), { code: 'INVALID_RESPONSE' });
});

test('errors keep their code and status so the screens can pick a friendly sentence', async () => {
  httpClient.request = async () => {
    throw httpError(404, 'USER_NOT_FOUND');
  };
  const error = await new HttpWorkspaceRepository().addMember(WS, { email: 'x@y.co' }).catch((e) => e);
  assert.equal(isUserNotFound(error), true);

  httpClient.request = async () => {
    throw httpError(429, 'INVITATION_RESEND_TOO_SOON');
  };
  await assert.rejects(new HttpWorkspaceRepository().resendInvitation(WS, INV), {
    code: 'INVITATION_RESEND_TOO_SOON',
    status: 429,
  });
});
