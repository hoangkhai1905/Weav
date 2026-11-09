const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { groupIssues, reasonFor, webStepUrl } = require('./readiness.ts');

const t = (key, vars = {}) => `${key}|${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')}`;
const issue = (nodeId, field, code = 'REQUIRED') => ({ nodeId, field, code });

test('groupIssues: known step, unknown node and null node', () => {
  const issues = [issue('a', 'subject'), issue('a', 'body'), issue('zzz', 'x'), issue(null, null, 'CYCLE')];
  const g = groupIssues(issues, ['a', 'b']);
  assert.equal(g.byStep.get('a').length, 2);
  assert.equal(g.byStep.has('b'), false);
  assert.equal(g.graphIssues, 2);
  assert.equal(g.redCount, 1);
});

test('redCount counts distinct steps', () => {
  const g = groupIssues([issue('a', 'x'), issue('b', 'y'), issue('b', 'z')], ['a', 'b']);
  assert.equal(g.redCount, 2);
  assert.equal(g.graphIssues, 0);
});

test('reasonFor: CONNECTION_NOT_AUTHORIZED', () => {
  assert.equal(reasonFor(issue('a', 'connectionId', 'CONNECTION_NOT_AUTHORIZED'), 'email.send', t), 'workflows.readiness.notAuthorized|');
  assert.equal(reasonFor(issue('a', 'config.connectionId', 'CONNECTION_NOT_AUTHORIZED'), 'email.send', t), 'workflows.readiness.notAuthorized|');
});

test('reasonFor: connectionId and config.connectionId -> pick account', () => {
  const want = 'workflows.readiness.pickAccount|provider=Gmail';
  assert.equal(reasonFor(issue('a', 'connectionId'), 'email.send', t), want);
  assert.equal(reasonFor(issue('a', 'config.connectionId'), 'email.send', t), want);
});

test('reasonFor: other field uses humanized last segment', () => {
  assert.equal(reasonFor(issue('a', 'config.reply_to'), 'email.send', t), 'workflows.readiness.missingField|field=reply to');
});

test('reasonFor: no field -> generic, never raw code', () => {
  const r = reasonFor(issue('a', null, 'SOME_CODE'), 'email.send', t);
  assert.equal(r, 'workflows.readiness.generic|');
});

test('webStepUrl', () => {
  assert.equal(webStepUrl('https://app.example.test/', 'wf-1', 'send email'), 'https://app.example.test/workflows/wf-1/builder?step=send%20email');
  assert.equal(webStepUrl('', 'wf-1', 'a'), null);
  assert.equal(webStepUrl(undefined, 'wf-1', 'a'), null);
});
