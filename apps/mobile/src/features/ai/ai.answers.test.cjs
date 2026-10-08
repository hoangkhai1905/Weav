const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const {
  controlFor,
  questionKey,
  providerForNodeType,
  fieldName,
  humanizeField,
  isValidHttpUrl,
  buildAnswers,
  buildEditorState,
} = require('./ai.answers.ts');

const CONN = '3f2b8c1e-0a4d-4f6e-9b7a-1c2d3e4f5a6b';

test('each question code maps to one guided control', () => {
  assert.equal(controlFor({ code: 'URL', field: 'a.url' }), 'URL');
  assert.equal(controlFor({ code: 'SCHEDULE', field: 's' }), 'SCHEDULE');
  assert.equal(controlFor({ code: 'TIMEZONE', field: 'tz' }), 'TIMEZONE');
  assert.equal(controlFor({ code: 'CONNECTION', field: 'email.send' }), 'CONNECTION');
  assert.equal(controlFor({ code: 'VALUE', field: 'email.send.body' }), 'TEXT');
  assert.equal(questionKey({ code: 'VALUE', field: 'x.y' }), 'VALUE:x.y');
});

test('node types and field names get friendly lookups', () => {
  assert.equal(providerForNodeType('email.send'), 'GMAIL');
  assert.equal(providerForNodeType('google.sheets'), 'GOOGLE_SHEETS');
  assert.equal(providerForNodeType('telegram.send_message'), 'TELEGRAM');
  assert.equal(providerForNodeType('http.request'), 'HTTP');
  assert.equal(providerForNodeType('logic.condition'), null);
  assert.equal(fieldName('email.send.subject'), 'subject');
  assert.equal(fieldName('node1.config.body'), 'body');
  assert.equal(humanizeField('reply_to'), 'reply to');
  assert.equal(humanizeField('spreadsheetId'), 'spreadsheet id');
});

test('URL validation accepts only http(s) with a host', () => {
  assert.equal(isValidHttpUrl('https://api.example.com/x?a=1'), true);
  assert.equal(isValidHttpUrl(' http://localhost:3000 '), true);
  assert.equal(isValidHttpUrl('ftp://example.com'), false);
  assert.equal(isValidHttpUrl('example.com'), false);
  assert.equal(isValidHttpUrl('javascript:alert(1)'), false);
});

test('answers payload: values keyed by field, connections keyed by node type, earlier rounds kept', () => {
  const questions = [
    { code: 'VALUE', field: 'email.send.subject' },
    { code: 'SCHEDULE', field: 'trigger.schedule.cron' },
    { code: 'CONNECTION', field: 'email.send' },
  ];
  const result = buildAnswers({
    prompt: 'Gui bao cao moi sang',
    questions,
    values: {
      'VALUE:email.send.subject': '  Bao cao ngay  ',
      'SCHEDULE:trigger.schedule.cron': 'Moi ngay (cron: 0 0 8 * * *)',
      'CONNECTION:email.send': CONN,
    },
    previous: { answers: { 'http.request.url': 'https://a.vn' }, connections: {} },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.answers, {
    'http.request.url': 'https://a.vn',
    'email.send.subject': 'Bao cao ngay',
    'trigger.schedule.cron': 'Moi ngay (cron: 0 0 8 * * *)',
  });
  assert.deepEqual(result.value.connections, { 'email.send': CONN });
});

test('answers payload rejects blanks, bad URLs, a non-uuid connection and oversize totals', () => {
  const q = [{ code: 'VALUE', field: 'a.b' }];
  assert.deepEqual(buildAnswers({ prompt: 'p', questions: q, values: { 'VALUE:a.b': '   ' } }), {
    ok: false,
    reason: 'missing',
    keys: ['VALUE:a.b'],
    urlKeys: [],
  });
  const url = [{ code: 'URL', field: 'http.request.url' }];
  const badUrl = buildAnswers({ prompt: 'p', questions: url, values: { 'URL:http.request.url': 'abc' } });
  assert.equal(badUrl.reason, 'invalid_url');
  assert.deepEqual(badUrl.urlKeys, ['URL:http.request.url']);
  // a blank field and a bad URL are both reported in one round
  const both = buildAnswers({ prompt: 'p', questions: [...q, ...url], values: { 'URL:http.request.url': 'abc' } });
  assert.deepEqual([both.keys, both.urlKeys], [['VALUE:a.b'], ['URL:http.request.url']]);
  const conn = [{ code: 'CONNECTION', field: 'email.send' }];
  assert.equal(buildAnswers({ prompt: 'p', questions: conn, values: { 'CONNECTION:email.send': 'not-a-uuid' } }).reason, 'invalid');
  assert.equal(
    buildAnswers({ prompt: 'x'.repeat(3890), questions: q, values: { 'VALUE:a.b': 'y'.repeat(50) } }).reason,
    'too_long',
  );
});

test('editor state carries node names and layout positions', () => {
  const state = buildEditorState(
    { nodes: [{ id: 'n1', type: 'trigger.manual' }, { id: 'n2', type: 'email.send' }] },
    { n1: { x: 100, y: 100 } },
    (n) => `L:${n.type}`,
  );
  assert.deepEqual(state.nodes.n1, { name: 'L:trigger.manual', position: { x: 100, y: 100 } });
  assert.equal(state.nodes.n2.name, 'L:email.send');
  assert.equal(typeof state.nodes.n2.position.x, 'number');
});
