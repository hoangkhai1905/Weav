const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { filterWorkflows, normalizeSearch } = require('./workflow.filter.ts');
const { parseRunInput } = require('./workflow.input.ts');
const { orderFlowNodes } = require('./workflow-flow.ts');
const { formatRelativeTime, durationBetween } = require('../common/time.ts');
const { fill } = require('../common/fill.ts');
const { translations } = require('../../stores/i18n.store.ts');

const wf = (name, status, description = null) => ({ workflowId: name, name, description, status });

test('workflow search ignores case and Vietnamese diacritics, and combines with the status chip', () => {
  const items = [
    wf('Báo cáo doanh thu', 'PUBLISHED'),
    wf('Đơn hàng mới', 'PAUSED', 'Gửi tới Telegram'),
    wf('Nháp thử', 'DRAFT'),
  ];
  assert.equal(normalizeSearch('  ĐƠN Hàng '), 'don hang');
  assert.deepEqual(filterWorkflows(items, 'ALL', 'bao cao').map((w) => w.name), ['Báo cáo doanh thu']);
  assert.deepEqual(filterWorkflows(items, 'ALL', 'don hang').map((w) => w.name), ['Đơn hàng mới']);
  assert.deepEqual(filterWorkflows(items, 'ALL', 'telegram').map((w) => w.name), ['Đơn hàng mới']);
  assert.deepEqual(filterWorkflows(items, 'DRAFT', '').map((w) => w.name), ['Nháp thử']);
  assert.deepEqual(filterWorkflows(items, 'PAUSED', 'bao cao'), []);
  assert.equal(filterWorkflows(items, 'ALL', '').length, 3);
});

test('run input: empty is {}, must be a JSON object', () => {
  assert.deepEqual(parseRunInput('  '), { ok: true, value: {} });
  assert.deepEqual(parseRunInput('{"a":1}'), { ok: true, value: { a: 1 } });
  assert.equal(parseRunInput('{oops').reason, 'invalid_json');
  assert.equal(parseRunInput('[1,2]').reason, 'not_object');
  assert.equal(parseRunInput('"text"').reason, 'not_object');
  assert.equal(parseRunInput('null').reason, 'not_object');
  assert.equal(parseRunInput('{"a":"' + 'x'.repeat(100000) + '"}').reason, 'too_large');
});

test('flow order follows the edges and never drops a node', () => {
  const n = (id, type = 'http.request') => ({ id, type, config: {}, name: null, position: null });
  const nodes = [n('c'), n('t', 'trigger.manual'), n('a'), n('b'), n('orphan')];
  const edges = [
    { id: 'e1', source: 't', target: 'a' },
    { id: 'e2', source: 'a', target: 'b' },
    { id: 'e3', source: 'b', target: 'c' },
  ];
  assert.deepEqual(orderFlowNodes(nodes, edges).map((x) => x.id), ['t', 'orphan', 'a', 'b', 'c']);
  // A cycle must not loop forever or hide nodes.
  const cyc = [{ id: 'x', source: 'a', target: 'b' }, { id: 'y', source: 'b', target: 'a' }];
  assert.equal(orderFlowNodes([n('a'), n('b')], cyc).length, 2);
});

test('relative time and durations', () => {
  const now = new Date('2026-10-07T10:00:00Z');
  assert.equal(formatRelativeTime('2026-10-07T09:55:00Z', 'EN', now), '5 minutes ago');
  assert.match(formatRelativeTime('2026-10-07T09:55:00Z', 'VI', now), /5 phút trước/);
  assert.match(formatRelativeTime('2026-10-07T10:30:00Z', 'EN', now), /in 30 minutes/);
  assert.equal(formatRelativeTime(null, 'VI'), '-');
  assert.equal(formatRelativeTime('garbage', 'VI'), '-');
  assert.equal(durationBetween('2026-10-07T10:00:00Z', '2026-10-07T10:00:04Z'), 4000);
  assert.equal(durationBetween('2026-10-07T10:00:00Z', null), null);
  assert.equal(fill('{n} of {total} {x}', { n: 1, total: 2 }), '1 of 2 {x}');
});

test('every trigger reason code, trigger type and node type has friendly vi and en copy', () => {
  const reasons = [
    'DEPENDENCY_NOT_CONFIGURED', 'SCHEDULE_ADMISSION_FAILED', 'CONNECTION_RECONNECT_REQUIRED',
    'AUTHENTICATION_REJECTED', 'CONNECTION_FORBIDDEN', 'CONNECTION_UNAVAILABLE',
    'GMAIL_POLL_FAILED', 'GMAIL_MESSAGE_SKIPPED', 'GMAIL_BACKLOG_TRUNCATED',
  ];
  const keys = [
    ...reasons.flatMap((c) => [`trigger.reason.${c}`, `trigger.fix.${c}`]),
    ...['SCHEDULE', 'WEBHOOK', 'TELEGRAM', 'GMAIL'].map((x) => `trigger.type.${x}`),
    ...['MANUAL', 'SCHEDULE', 'WEBHOOK', 'TELEGRAM', 'GMAIL'].map((x) => `execution.trigger.${x}`),
    ...['ERROR', 'WARN', 'INFO', 'DEBUG'].map((x) => `log.level.${x}`),
    ...[
      'trigger.manual', 'trigger.schedule', 'trigger.webhook', 'trigger.telegram', 'trigger.gmail',
      'http.request', 'email.send', 'google.sheets', 'google.calendar', 'google.drive',
      'telegram.send_message', 'logic.condition', 'logic.switch', 'ai.extract', 'ai.classify',
      'ai.summarize', 'ai.generate', 'ocr.extract', 'data.set',
    ].map((x) => `node.type.${x}`),
  ];
  for (const lang of ['VI', 'EN']) {
    for (const key of keys) {
      assert.ok(translations[lang][key] && translations[lang][key] !== key, `${lang} ${key}`);
    }
  }
  // Raw enum codes must never be the visible text.
  for (const c of reasons) assert.ok(!translations.VI[`trigger.reason.${c}`].includes('_'));
});

test('vi and en define the same keys', () => {
  const vi = Object.keys(translations.VI).sort();
  const en = Object.keys(translations.EN).sort();
  const missingInEn = vi.filter((k) => !(k in translations.EN));
  const missingInVi = en.filter((k) => !(k in translations.VI));
  assert.deepEqual(
    { missingInEn: missingInEn.filter((k) => /^(wfl|wfd|wfd|run|pub|del|exl|exd|trigger|node|log|execution\.trigger|ui)\./.test(k)), missingInVi: missingInVi.filter((k) => /^(wfl|wfd|run|pub|del|exl|exd|trigger|node|log|execution\.trigger)\./.test(k)) },
    { missingInEn: [], missingInVi: [] },
  );
  assert.ok(vi.length > 0 && en.length > 0);
});
