const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { reconnectCount, templateErrorKey, templateGroup } = require('./template.helpers.ts');

const nodes = (...types) => types.map((type, i) => ({ id: `n${i}`, type }));

test('reconnectCount counts the steps that need a connection', () => {
  assert.equal(reconnectCount([]), 0);
  assert.equal(reconnectCount(nodes('trigger.manual', 'http.request', 'transform.set')), 0);
  assert.equal(reconnectCount(nodes('discord.send_message', 'slack.send_message', 'teams.send_message', 'format.text')), 3);
  assert.equal(
    reconnectCount(
      nodes('trigger.gmail', 'trigger.telegram', 'email.send', 'telegram.send_message', 'google.sheets.append_row', 'google.calendar.create_event'),
    ),
    6,
  );
  // "google" alone or a lookalike prefix is not a Google step.
  assert.equal(reconnectCount(nodes('googleish.step', 'email.sendx')), 0);
});

test('templateErrorKey maps status and phase to a friendly key', () => {
  assert.equal(templateErrorKey({ status: 404 }, 'lookup'), 'tpl.err.codeNotFound');
  assert.equal(templateErrorKey({ status: 404 }, 'load'), 'tpl.err.notFound');
  assert.equal(templateErrorKey({ status: 404 }, 'use'), 'tpl.err.notFound');
  assert.equal(templateErrorKey({ status: 403 }, 'use'), 'tpl.err.useForbidden');
  assert.equal(templateErrorKey({ status: 403 }, 'load'), 'tpl.err.loadFailed');
  assert.equal(templateErrorKey({ status: 429 }, 'lookup'), 'tpl.err.tooMany');
  assert.equal(templateErrorKey({ status: 429 }, 'use'), 'tpl.err.tooMany');
  assert.equal(templateErrorKey({ status: 500 }, 'lookup'), 'tpl.err.lookupFailed');
  assert.equal(templateErrorKey({ status: 500 }, 'use'), 'tpl.err.useFailed');
  assert.equal(templateErrorKey({ status: 500 }, 'load'), 'tpl.err.loadFailed');
  // No status: the request never got an answer.
  assert.equal(templateErrorKey({ code: 'ERR_NETWORK' }, 'lookup'), 'au.err.network');
  assert.equal(templateErrorKey(undefined, 'use'), 'au.err.network');
  // A malformed body also has no status but is not a network problem.
  assert.equal(templateErrorKey({ code: 'INVALID_RESPONSE' }, 'lookup'), 'tpl.err.lookupFailed');
});

test('templates are grouped by what starts them', () => {
  assert.equal(templateGroup(['trigger.gmail', 'ai.extract', 'google.sheets']), 'email');
  assert.equal(templateGroup(['trigger.telegram', 'telegram.send_message']), 'chat');
  assert.equal(templateGroup(['trigger.schedule', 'email.send']), 'schedule');
  assert.equal(templateGroup(['trigger.webhook']), 'webhook');
  assert.equal(templateGroup(['trigger.manual', 'http.request']), 'other');
  assert.equal(templateGroup(['http.request']), 'other');
  assert.equal(templateGroup([]), 'other');
});
