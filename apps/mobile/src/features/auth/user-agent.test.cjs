const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { describeUserAgent } = require('./user-agent.ts');

test('recognises common browsers and systems', () => {
  const cases = [
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Chrome', 'Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0', 'Edge', 'Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'Safari', 'iOS'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/127.0', 'Firefox', 'macOS'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', 'Chrome', 'Android'],
  ];
  for (const [ua, browser, os] of cases) assert.deepEqual(describeUserAgent(ua), { browser, os }, ua);
});

test('returns nulls for empty or unknown agents', () => {
  assert.deepEqual(describeUserAgent(null), { browser: null, os: null });
  assert.deepEqual(describeUserAgent('   '), { browser: null, os: null });
  assert.deepEqual(describeUserAgent('curl/8.0'), { browser: null, os: null });
});
