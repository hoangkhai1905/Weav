const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createAuthSessionCoordinator,
} = require('./auth-session.coordinator.ts');
const {
  AUTH_REFRESH_TOKEN_KEY,
  createAuthSessionStorage,
} = require('../../infrastructure/auth/auth-session.storage.ts');

const token = (value) => `${value}`.repeat(43).slice(0, 43);

function session(userId, refreshToken) {
  return {
    user: { id: userId, email: `${userId}@example.com`, name: userId },
    tokens: { accessToken: `access-${userId}`, refreshToken },
  };
}

function harness({ storedRefreshToken = null, persistenceEnabled = true } = {}) {
  const state = {
    tokens: null,
    user: null,
    isAuthenticated: false,
    isHydrating: false,
    authError: null,
  };
  const storage = {
    persistent: persistenceEnabled,
    storedRefreshToken,
    saves: [],
    clears: 0,
    loadRefreshToken: async () => storage.storedRefreshToken,
    saveRefreshToken: async (value) => {
      storage.saves.push(value);
      storage.storedRefreshToken = value;
    },
    clearRefreshToken: async () => {
      storage.clears += 1;
      storage.storedRefreshToken = null;
    },
  };
  const repository = {
    restoreCalls: [],
    logoutCalls: [],
    restoreSession: async (refreshToken) => {
      repository.restoreCalls.push(refreshToken);
      return session('restored-user', token('rotated'));
    },
    logout: async (refreshToken) => {
      repository.logoutCalls.push(refreshToken);
    },
  };
  const store = {
    getState: () => state,
    setHydrating: (value) => { state.isHydrating = value; },
    setAuthSession: (user, tokens) => {
      state.user = user;
      state.tokens = tokens;
      state.isAuthenticated = true;
    },
    clearAuthSession: () => {
      state.user = null;
      state.tokens = null;
      state.isAuthenticated = false;
    },
    setAuthError: (value) => { state.authError = value; },
  };
  const coordinator = createAuthSessionCoordinator({
    store,
    storage,
    repository,
    persistenceEnabled,
  });
  return { state, storage, repository, store, coordinator };
}

test('persists only the refresh material before exposing a login session', async () => {
  const h = harness();
  const operation = h.coordinator.beginAuthOperation();
  const current = session('user-a', token('refresh-a'));

  assert.equal(await h.coordinator.establishSession(current, operation), true);
  assert.deepEqual(h.storage.saves, [token('refresh-a')]);
  assert.equal(h.state.tokens.accessToken, 'access-user-a');
  assert.equal(h.state.isAuthenticated, true);
});

test('cold start restores and persists the rotated refresh token', async () => {
  const h = harness({ storedRefreshToken: token('old') });
  h.repository.restoreSession = async (refreshToken) => {
    h.repository.restoreCalls.push(refreshToken);
    return session('user-a', token('new'));
  };

  assert.equal(await h.coordinator.bootstrap(), 'restored');
  assert.deepEqual(h.repository.restoreCalls, [token('old')]);
  assert.deepEqual(h.storage.saves, [token('new')]);
  assert.equal(h.state.user.id, 'user-a');
  assert.equal(h.state.isHydrating, false);
});

test('cold start publishes the server profile instead of a stale cached name', async () => {
  const h = harness({ storedRefreshToken: token('old') });
  h.store.setAuthSession(
    { id: 'user-a', email: 'a@example.com', name: 'Old cached name' },
    { accessToken: 'old-access', refreshToken: token('old') },
  );
  h.repository.restoreSession = async () => ({
    user: { id: 'user-a', email: 'a@example.com', name: 'Fresh server name' },
    tokens: { accessToken: 'new-access', refreshToken: token('new') },
  });

  assert.equal(await h.coordinator.bootstrap(), 'restored');
  assert.equal(h.state.user.name, 'Fresh server name');
  assert.deepEqual(h.storage.saves, [token('new')]);
});

test('invalid refresh clears secure material while transient failure preserves it', async () => {
  const invalid = harness({ storedRefreshToken: token('invalid') });
  invalid.repository.restoreSession = async () => {
    throw { code: 'UNAUTHORIZED', status: 401 };
  };
  assert.equal(await invalid.coordinator.bootstrap(), 'signed-out');
  assert.equal(invalid.storage.clears, 1);
  assert.equal(invalid.state.authError, 'SESSION_INVALID');

  const offline = harness({ storedRefreshToken: token('offline') });
  offline.repository.restoreSession = async () => {
    throw { code: 'SERVICE_UNAVAILABLE', status: 503 };
  };
  assert.equal(await offline.coordinator.bootstrap(), 'signed-out');
  assert.equal(offline.storage.clears, 0);
  assert.equal(offline.storage.storedRefreshToken, token('offline'));
  assert.equal(offline.state.authError, 'SESSION_RESTORE_UNAVAILABLE');
});

test('concurrent refresh calls share one rotation request', async () => {
  const h = harness();
  h.store.setAuthSession(session('user-a', token('old')).user, session('user-a', token('old')).tokens);
  let resolveRefresh;
  h.repository.restoreSession = async (refreshToken) => {
    h.repository.restoreCalls.push(refreshToken);
    return new Promise((resolve) => { resolveRefresh = () => resolve(session('user-a', token('new'))); });
  };

  const first = h.coordinator.refresh();
  const second = h.coordinator.refresh();
  assert.strictEqual(first, second);
  resolveRefresh();
  const result = await first;
  assert.equal(result.tokens.refreshToken, token('new'));
  assert.deepEqual(h.repository.restoreCalls, [token('old')]);
  assert.deepEqual(h.storage.saves, [token('new')]);
});

test('logout wins over a late hydrate and revokes with the captured token', async () => {
  const h = harness({ storedRefreshToken: token('old') });
  let resolveRestore;
  h.repository.restoreSession = async () => new Promise((resolve) => {
    resolveRestore = () => resolve(session('old-user', token('new')));
  });

  const hydrate = h.coordinator.bootstrap();
  await new Promise((resolve) => setImmediate(resolve));
  const logout = h.coordinator.logout();
  resolveRestore();
  const [hydrateResult] = await Promise.all([hydrate, logout]);

  assert.equal(hydrateResult, 'stale');
  assert.equal(h.state.isAuthenticated, false);
  assert.equal(h.state.user, null);
  assert.equal(h.storage.storedRefreshToken, null);
  assert.deepEqual(h.repository.logoutCalls, [token('old')]);
  assert.deepEqual(h.storage.saves, []);
});

test('an account switch blocks a late hydrate from publishing account A into account B', async () => {
  const h = harness({ storedRefreshToken: token('account-a') });
  let resolveRestore;
  h.repository.restoreSession = async () => new Promise((resolve) => {
    resolveRestore = () => resolve(session('user-a', token('rotated-a')));
  });

  const hydrate = h.coordinator.bootstrap();
  await new Promise((resolve) => setImmediate(resolve));

  const switchOperation = h.coordinator.beginAuthOperation();
  assert.equal(
    await h.coordinator.establishSession(
      session('user-b', token('refresh-b')),
      switchOperation,
    ),
    true,
  );
  resolveRestore();

  assert.equal(await hydrate, 'stale');
  assert.equal(h.state.user.id, 'user-b');
  assert.equal(h.state.user.name, 'user-b');
  assert.equal(h.storage.storedRefreshToken, token('refresh-b'));
});

test('a superseded login operation cannot publish its late session', async () => {
  const h = harness();
  let resolveSave;
  let markSaveStarted;
  const saveStarted = new Promise((resolve) => { markSaveStarted = resolve; });
  h.storage.saveRefreshToken = async (value) => {
    h.storage.saves.push(value);
    markSaveStarted();
    await new Promise((resolve) => { resolveSave = resolve; });
    h.storage.storedRefreshToken = value;
  };

  const first = h.coordinator.establishSession(
    session('old-user', token('old')),
    h.coordinator.beginAuthOperation(),
  );
  await saveStarted;
  h.coordinator.beginAuthOperation();
  resolveSave();

  assert.equal(await first, false);
  assert.equal(h.state.isAuthenticated, false);
  assert.equal(h.storage.storedRefreshToken, null);
  assert.equal(h.storage.clears, 1);
});

test('web and explicit mock storage never call SecureStore', async () => {
  const calls = [];
  const secureStore = {
    getItemAsync: async (key) => { calls.push(['get', key]); return token('secret'); },
    setItemAsync: async (key) => { calls.push(['set', key]); },
    deleteItemAsync: async (key) => { calls.push(['delete', key]); },
  };
  const web = createAuthSessionStorage({ platform: 'web', mockMode: false, secureStore });
  const mock = createAuthSessionStorage({ platform: 'ios', mockMode: true, secureStore });

  assert.equal(AUTH_REFRESH_TOKEN_KEY, 'weav.auth.refresh-token.v1');
  assert.equal(web.persistent, false);
  assert.equal(mock.persistent, false);
  await web.loadRefreshToken();
  await web.saveRefreshToken(token('web'));
  await web.clearRefreshToken();
  await mock.loadRefreshToken();
  await mock.saveRefreshToken(token('mock'));
  await mock.clearRefreshToken();
  assert.deepEqual(calls, []);
});

test('secure storage write failure never reports a successful session', async () => {
  const h = harness();
  h.storage.saveRefreshToken = async () => {
    throw new Error('native secure storage unavailable');
  };

  await assert.rejects(
    () => h.coordinator.establishSession(session('user-a', token('refresh-a'))),
  );
  assert.equal(h.state.isAuthenticated, false);
  assert.equal(h.state.authError, 'SESSION_STORAGE_UNAVAILABLE');
  assert.equal(h.storage.clears, 1);
});
