const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { groupByDay } = require('./notification.grouping.ts');

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const NOW = new Date(2026, 9, 8, 15);

test('groups newest-first items into today / yesterday / earlier, keeping order', () => {
  const items = [
    { id: 'a', t: at(2026, 10, 8, 14) },
    { id: 'b', t: at(2026, 10, 8, 9) },
    { id: 'c', t: at(2026, 10, 7, 23) },
    { id: 'd', t: at(2026, 10, 1) },
    { id: 'e', t: at(2026, 10, 1, 8) },
  ];
  const groups = groupByDay(items, (i) => i.t, NOW);
  assert.deepEqual(groups.map((g) => [g.bucket, g.items.map((i) => i.id)]), [
    ['today', ['a', 'b']],
    ['yesterday', ['c']],
    ['earlier', ['d', 'e']],
  ]);
  assert.equal(groups[2].key, '2026-10-01');
});

test('skips unreadable timestamps and handles an empty list', () => {
  assert.deepEqual(groupByDay([], () => '', NOW), []);
  assert.deepEqual(groupByDay([{ t: 'nope' }], (i) => i.t, NOW), []);
});

test('a different month boundary still counts yesterday correctly', () => {
  const groups = groupByDay([{ t: at(2026, 9, 30) }], (i) => i.t, new Date(2026, 9, 1, 8));
  assert.equal(groups[0].bucket, 'yesterday');
});
