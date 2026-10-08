const { test } = require('node:test');
const assert = require('node:assert/strict');
// The backend always sends UTC ("Z"); the app must only convert to the device zone, never shift by hand.
process.env.TZ = 'Asia/Ho_Chi_Minh';
require('../../../test-support/register-typescript.cjs');
const { formatClock, formatDateTime, formatRelativeTime } = require('./time.ts');
const { groupByDay } = require('../notifications/notification.grouping.ts');

test('shows a UTC timestamp in the device zone (UTC+7)', () => {
  assert.equal(formatDateTime('2026-10-08T03:08:01.520Z'), '08/10/2026 10:08');
  assert.equal(formatClock('2026-10-08T03:08:01.520Z'), '10:08:01');
  // 6 and 9 fractional digits are what workflow-service and workspace-service send.
  assert.equal(formatDateTime('2026-10-08T03:07:59.956515Z'), '08/10/2026 10:07');
  assert.equal(formatDateTime('2026-10-08T03:07:41.816125522Z'), '08/10/2026 10:07');
  assert.equal(formatDateTime('2026-10-08T10:08:01+07:00'), '08/10/2026 10:08');
});

test('relative time is the plain difference to now, not shifted by the zone', () => {
  const now = new Date('2026-10-08T03:10:00.000Z');
  assert.equal(formatRelativeTime('2026-10-08T03:08:00.000Z', 'EN', now), '2 minutes ago');
  assert.equal(formatRelativeTime('2026-10-08T03:08:00.000Z', 'VI', now), '2 phút trước');
  assert.equal(formatRelativeTime('2026-10-07T18:10:00.000Z', 'EN', now), '9 hours ago');
});

test('day groups follow the device calendar day', () => {
  const now = new Date('2026-10-08T03:10:00.000Z'); // 10:10 on 8 Oct locally
  const groups = groupByDay(
    [{ at: '2026-10-08T03:08:00.000Z' }, { at: '2026-10-07T17:30:00.000Z' }, { at: '2026-10-07T16:59:00.000Z' }],
    (i) => i.at,
    now,
  );
  // 17:30Z = 00:30 on 8 Oct locally (today); 16:59Z = 23:59 on 7 Oct locally (yesterday).
  assert.deepEqual(groups.map((g) => [g.bucket, g.items.length]), [['today', 2], ['yesterday', 1]]);
});
