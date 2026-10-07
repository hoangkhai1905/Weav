const { test } = require('node:test');
const assert = require('node:assert/strict');
const { statusInfo, formatDuration, shortId, truncateJson, KNOWN_STATUSES } = require('./status.ts');

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
