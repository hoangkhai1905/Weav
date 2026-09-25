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
