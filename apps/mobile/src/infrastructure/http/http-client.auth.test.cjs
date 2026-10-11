const { test } = require('node:test');
const assert = require('node:assert/strict');
const { httpClient, setHttpClientToken } = require('./http-client.ts');

test('shared HTTP client uses the current account token without replacing explicit auth', async () => {
  const previousAdapter = httpClient.defaults.adapter;
  const requests = [];
  httpClient.defaults.adapter = async (config) => {
    requests.push(config);
    return {
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };

  try {
    setHttpClientToken('test-token-a');
    await httpClient.get('/api/notifications');
    await httpClient.get('/api/notifications', {
      headers: { Authorization: 'Bearer explicit-token' },
    });
    setHttpClientToken('test-token-b');
    await httpClient.get('/api/notifications');

    assert.equal(requests[0].headers.Authorization, 'Bearer test-token-a');
    assert.equal(requests[1].headers.Authorization, 'Bearer explicit-token');
    assert.equal(requests[2].headers.Authorization, 'Bearer test-token-b');
  } finally {
    setHttpClientToken(null);
    httpClient.defaults.adapter = previousAdapter;
  }
});

test('a 401 refreshes once and retries with the new token; auth routes and second 401s are not retried', async () => {
  const { setUnauthorizedHandler } = require('./http-client.ts');
  const previousAdapter = httpClient.defaults.adapter;
  const sent = [];
  let refreshes = 0;
  const reply = (config, status) => {
    if (status >= 400) {
      const error = new Error(`status ${status}`);
      error.isAxiosError = true;
      error.config = config;
      error.response = { status, data: {}, headers: {}, config };
      throw error;
    }
    return { data: { ok: true }, status, statusText: 'OK', headers: {}, config };
  };
  httpClient.defaults.adapter = async (config) => {
    sent.push({ url: config.url, auth: config.headers.Authorization });
    if (config.url === '/always-401') return reply(config, 401);
    return reply(config, config.headers.Authorization === 'Bearer fresh' ? 200 : 401);
  };
  setUnauthorizedHandler(async (failed) => {
    refreshes += 1;
    return failed === 'stale' ? 'fresh' : null;
  });
  try {
    setHttpClientToken('stale');
    const res = await httpClient.get('/api/v1/workspaces');
    assert.equal(res.status, 200);
    assert.deepEqual(sent.map((s) => s.auth), ['Bearer stale', 'Bearer fresh']);
    assert.equal(refreshes, 1);

    sent.length = 0;
    await assert.rejects(httpClient.post('/api/auth/login', {}));
    assert.equal(sent.length, 1, 'login is not retried');

    sent.length = 0;
    await assert.rejects(httpClient.get('/always-401'));
    assert.equal(sent.length, 2, 'retried once, then the 401 is returned');

    sent.length = 0;
    setHttpClientToken(null);
    await assert.rejects(httpClient.get('/api/v1/workspaces'));
    assert.equal(sent.length, 1, 'no token, no refresh');
  } finally {
    setUnauthorizedHandler(null);
    setHttpClientToken(null);
    httpClient.defaults.adapter = previousAdapter;
  }
});
