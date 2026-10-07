const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { buildCron, buildScheduleAnswer, DEFAULT_SCHEDULE } = require('./schedule.ts');

test('picker choices become 6-field cron expressions', () => {
  assert.equal(buildCron(DEFAULT_SCHEDULE), '0 0 8 * * *');
  assert.equal(buildCron({ ...DEFAULT_SCHEDULE, hour: 17, minute: 30 }), '0 30 17 * * *');
  assert.equal(buildCron({ ...DEFAULT_SCHEDULE, frequency: 'HOURLY', minute: 15 }), '0 15 * * * *');
  assert.equal(buildCron({ ...DEFAULT_SCHEDULE, frequency: 'WEEKLY', weekday: 'FRI' }), '0 0 8 * * FRI');
  assert.equal(buildCron({ ...DEFAULT_SCHEDULE, frequency: 'MONTHLY', monthDay: 15 }), '0 0 8 15 * *');
});

test('invalid choices are rejected instead of producing a bad cron', () => {
  assert.equal(buildCron({ ...DEFAULT_SCHEDULE, hour: 24 }), null);
  assert.equal(buildCron({ ...DEFAULT_SCHEDULE, minute: 60 }), null);
  assert.equal(buildCron({ ...DEFAULT_SCHEDULE, minute: 1.5 }), null);
  assert.equal(buildCron({ ...DEFAULT_SCHEDULE, frequency: 'MONTHLY', monthDay: 31 }), null);
  assert.equal(buildCron({ ...DEFAULT_SCHEDULE, frequency: 'WEEKLY', weekday: 'XXX' }), null);
  assert.equal(buildScheduleAnswer({ ...DEFAULT_SCHEDULE, hour: -1 }, 'x'), null);
});

test('the answer carries both the sentence and the cron', () => {
  assert.equal(
    buildScheduleAnswer(DEFAULT_SCHEDULE, ' Moi ngay luc 08:00 '),
    'Moi ngay luc 08:00 (cron: 0 0 8 * * *)',
  );
});
