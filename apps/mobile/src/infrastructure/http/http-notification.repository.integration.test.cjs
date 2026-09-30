require('../../../test-support/register-typescript.cjs');

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.EXPO_PUBLIC_API_MODE = 'http';

const axios = require('axios');
const { HttpNotificationRepository } = require('./http-notification.repository.ts');
const { httpClient } = require('./http-client.ts');
const { useAuthStore } = require('../../stores/auth.store.ts');
const authPersistence = require('../../infrastructure/auth/auth-session.persistence.ts');

const repository = new HttpNotificationRepository();
const originalAdapter = httpClient.defaults.adapter;
const originalExpire = authPersistence.expirePersistedAuthSession;
let requests;
let adapter;
let expireCalls = 0;

authPersistence.expirePersistedAuthSession = async () => {
  expireCalls += 1;
};

function session(userId, accessToken) {
  useAuthStore.getState().setAuthSession(
    { id: userId, name: 'Fixture', email: 'fixture@example.invalid' },
    { accessToken, refreshToken: `${accessToken}-refresh` },
  );
  return { userId, generation: useAuthStore.getState().sessionGeneration };
}

function installAdapter(handler) {
  requests = [];
  adapter = async (config) => {
    requests.push(config);
    return handler(config);
  };
  httpClient.defaults.adapter = adapter;
}

function response(config, data, status = 200) {
  return { data, status, statusText: status === 200 ? 'OK' : 'Error', headers: {}, config };
}

function notificationItem() {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    eventType: 'security.password_changed',
    category: 'SECURITY',
    severity: 'INFO',
    title: 'Password changed',
    message: 'The password changed.',
    target: { kind: 'SECURITY_SETTINGS' },
    workspaceId: null,
    executionId: null,
    occurredAt: '2026-09-27T04:00:00.000Z',
    createdAt: '2026-09-27T04:01:00.000Z',
    readAt: null,
  };
}

function assertCapturedAuthorization(config, token) {
  const authorization = config.headers.get('Authorization');
  assert.equal(authorization === `Bearer ${token}`, true);
}

after(() => {
  httpClient.defaults.adapter = originalAdapter;
  authPersistence.expirePersistedAuthSession = originalExpire;
  useAuthStore.getState().clearAuthSession();
});

test('uses the actual Axios repository for v2 list/count/read/read-all and validates responses', async () => {
  const scope = session('integration-user', 'integration-access');
  installAdapter((config) => {
    if (config.url === '/api/v2/notifications') {
      return response(config, { items: [notificationItem()], nextCursor: null });
    }
    if (config.url.endsWith('/unread-count')) return response(config, { count: 2 });
    if (config.method?.toUpperCase() === 'PATCH') return response(config, { item: notificationItem() });
    if (config.url.endsWith('/read-all')) return response(config, { updatedCount: 2 });
    return response(config, {});
  });

  const page = await repository.getNotificationPage(scope, {
    limit: 7,
    locale: 'en',
    category: 'SECURITY',
    unreadOnly: true,
  });
  assert.equal(page.items[0].title, 'Password changed');
  assert.equal(requests[0].url, '/api/v2/notifications');
  assert.deepEqual(requests[0].params, {
    limit: 7,
    unreadOnly: true,
    category: 'SECURITY',
    locale: 'en',
  });
  assert.equal(Object.hasOwn(requests[0].params, 'status'), false);
  assert.equal(Object.hasOwn(requests[0].params, 'userId'), false);
  assertCapturedAuthorization(requests[0], 'integration-access');
  assert.equal(await repository.getUnreadCount(scope), 2);
  assert.equal((await repository.markRead(notificationItem().id, scope, 'en')).readAt, null);
  assert.equal(await repository.markAllRead(scope), 2);
  assert.deepEqual(requests.map((config) => config.url), [
    '/api/v2/notifications',
    '/api/v2/notifications/unread-count',
    `/api/v2/notifications/${notificationItem().id}/read`,
    '/api/v2/notifications/read-all',
  ]);
  for (const config of requests) assertCapturedAuthorization(config, 'integration-access');

  installAdapter((config) => response(config, { items: 'invalid', nextCursor: null }));
  await assert.rejects(
    repository.getNotificationPage(scope),
    (error) => error.code === 'INVALID_RESPONSE' && !String(error.message).includes('integration-access'),
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/v2/notifications');
});

test('rejects malformed count/read acknowledgements and converts pre-abort to a safe cancellation', async () => {
  const scope = session('validation-user', 'validation-access');
  installAdapter((config) => response(config, { count: '2' }));
  await assert.rejects(repository.getUnreadCount(scope), (error) => error.code === 'INVALID_RESPONSE');

  installAdapter((config) => response(config, { updatedCount: 1 }));
  await assert.rejects(
    repository.markRead(notificationItem().id, scope, 'vi'),
    (error) => error.code === 'INVALID_RESPONSE',
  );

  const controller = new AbortController();
  controller.abort();
  installAdapter((config) => response(config, { items: [], nextCursor: null }));
  await assert.rejects(
    repository.getNotificationPage(scope, {}, controller.signal),
    (error) => error.code === 'CANCELED',
  );
  assert.equal(requests.length, 0);
});

test('drops delayed responses after account or same-user session replacement', async () => {
  for (const replaceWithSameUser of [false, true]) {
    const scope = session('race-user-a', 'race-access-a');
    let release;
    installAdapter((config) => new Promise((resolve) => {
      release = () => resolve(response(config, { items: [notificationItem()], nextCursor: null }));
    }));
    const pending = repository.getNotificationPage(scope);
    await new Promise((resolve) => setImmediate(resolve));
    session(replaceWithSameUser ? 'race-user-a' : 'race-user-b', 'race-access-b');
    release();
    await assert.rejects(pending, (error) => error.code === 'STALE_SESSION');
    assert.equal(useAuthStore.getState().user.id, replaceWithSameUser ? 'race-user-a' : 'race-user-b');
    assertCapturedAuthorization(requests[0], 'race-access-a');
  }
});

test('does not expire a replacement session when the captured session receives a delayed 401', async () => {
  const scope = session('unauthorized-user-a', 'unauthorized-access-a');
  let rejectRequest;
  installAdapter((config) => new Promise((_resolve, reject) => {
    rejectRequest = () => reject(new axios.AxiosError('unauthorized', 'ERR_BAD_REQUEST', config, null, {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config,
      data: { message: 'fixture failure' },
    }));
  }));
  const pending = repository.getUnreadCount(scope);
  await new Promise((resolve) => setImmediate(resolve));
  session('unauthorized-user-b', 'unauthorized-access-b');
  rejectRequest();
  await assert.rejects(pending, (error) => error.code === 'UNAUTHORIZED');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(expireCalls, 0);
  assert.equal(useAuthStore.getState().user.id, 'unauthorized-user-b');
});

test('expires only the currently authenticated session on a current-session 401', async () => {
  const scope = session('current-401-user', 'current-401-access');
  installAdapter((config) => Promise.reject(new axios.AxiosError(
    'unauthorized',
    'ERR_BAD_REQUEST',
    config,
    null,
    {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config,
      data: { message: 'fixture failure' },
    },
  )));
  await assert.rejects(repository.getUnreadCount(scope), (error) => error.code === 'UNAUTHORIZED');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(expireCalls, 1);
});
