const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const {
  questionLabel,
  providerForNodeType,
  fieldName,
  humanizeField,
  buildEditorState,
} = require('./ai.answers.ts');

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

test('question labels are friendly, never raw codes', () => {
  const dict = { 'aig.q.URL': 'U', 'aig.q.CONNECTION': 'Pick {provider}', 'provider.GMAIL': 'Gmail', 'aig.q.CONNECTION.generic': 'G', 'aig.field.subject': 'Subject', 'aig.q.VALUE.generic': 'Enter {field}' };
  const t = (k) => dict[k] ?? k;
  assert.equal(questionLabel({ code: 'URL', field: 'x' }, t), 'U');
  assert.equal(questionLabel({ code: 'CONNECTION', field: 'email.send' }, t), 'Pick Gmail');
  assert.equal(questionLabel({ code: 'CONNECTION', field: 'logic.x' }, t), 'G');
  assert.equal(questionLabel({ code: 'VALUE', field: 'email.send.subject' }, t), 'Subject');
  assert.equal(questionLabel({ code: 'VALUE', field: 'a.reply_to' }, t), 'Enter reply to');
});
