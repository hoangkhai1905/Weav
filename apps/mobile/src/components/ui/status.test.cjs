const { test } = require('node:test');
const assert = require('node:assert/strict');
const { statusInfo, formatDuration, shortId, truncateJson, KNOWN_STATUSES, errorMessageKey, isForbiddenError } = require('./status.ts');

test('every known status has tone, icon and label key; unknown falls back to neutral', () => {
  for (const s of KNOWN_STATUSES) {
    const i = statusInfo(s.toLowerCase());
    assert.ok(i.tone && i.icon);
    assert.equal(i.labelKey, `status.${s}`);
  }
  assert.equal(KNOWN_STATUSES.length, 15);
  assert.deepEqual(statusInfo('SUCCESS'), { tone: 'success', icon: 'CircleCheck', labelKey: 'status.SUCCESS' });
  assert.equal(statusInfo('FAILED').tone, 'danger');
  assert.equal(statusInfo('WAT').labelKey, 'status.UNKNOWN');
  assert.equal(statusInfo(null).tone, 'neutral');
});

test('formatDuration', () => {
  assert.equal(formatDuration(null), '-');
  assert.equal(formatDuration(-5), '-');
  assert.equal(formatDuration(850), '850 ms');
  assert.equal(formatDuration(4200), '4.2 s');
  assert.equal(formatDuration(42000), '42 s');
  assert.equal(formatDuration(125000), '2m 05s');
  assert.equal(formatDuration(3780000), '1h 03m');
});

test('shortId and truncateJson', () => {
  assert.equal(shortId('0f3a9c1e-aaaa'), '0f3a9c1e');
  assert.equal(shortId('abc'), 'abc');
  assert.deepEqual(truncateJson({ a: 1 }, 100), { text: '{\n  "a": 1\n}', truncated: false });
  const t = truncateJson({ a: 'x'.repeat(50) }, 10);
  assert.equal(t.truncated, true);
  assert.equal(t.text.length, 11);
});

test('error message falls back from code to HTTP status', () => {
  const has = (k) => ['ui.error.FORBIDDEN', 'ui.error.NOT_FOUND', 'ui.error.INTERNAL_ERROR', 'ui.error.UNKNOWN', 'ui.error.UNAUTHORIZED', 'ui.error.TOO_MANY_REQUESTS', 'ui.error.AI_BUSY'].includes(k);
  assert.equal(errorMessageKey({ code: 'AI_BUSY', status: 503 }, has), 'ui.error.AI_BUSY');
  assert.equal(errorMessageKey({ code: 'RESOURCE_NOT_FOUND', status: 404 }, has), 'ui.error.NOT_FOUND');
  assert.equal(errorMessageKey({ code: 'ACCESS_DENIED', status: 403 }, has), 'ui.error.FORBIDDEN');
  assert.equal(errorMessageKey({ code: 'X', status: 503 }, has), 'ui.error.INTERNAL_ERROR');
  assert.equal(errorMessageKey({ code: 'X', status: 429 }, has), 'ui.error.TOO_MANY_REQUESTS');
  assert.equal(errorMessageKey({ code: 'NETWORK_ERROR' }, has), 'ui.error.UNKNOWN');
  assert.equal(errorMessageKey(null, has), 'ui.error.UNKNOWN');
  assert.equal(isForbiddenError({ code: 'ACCESS_DENIED', status: 403 }), true);
  assert.equal(isForbiddenError({ code: 'NOT_FOUND', status: 404 }), false);
});
