const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { groupIssues, reasonFor, webStepUrl } = require('./readiness.ts');

const t = (key, vars) => (vars ? `${key}|${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')}` : key);
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
  assert.equal(reasonFor(issue('a', 'connectionId', 'CONNECTION_NOT_AUTHORIZED'), 'email.send', t), 'workflows.readiness.notAuthorized');
  assert.equal(reasonFor(issue('a', 'config.connectionId', 'CONNECTION_NOT_AUTHORIZED'), 'email.send', t), 'workflows.readiness.notAuthorized');
});

test('reasonFor: connectionId and config.connectionId -> pick account', () => {
  const want = 'workflows.readiness.pickAccount|provider=provider.GMAIL';
  assert.equal(reasonFor(issue('a', 'connectionId'), 'email.send', t), want);
  assert.equal(reasonFor(issue('a', 'config.connectionId'), 'email.send', t), want);
});

test('reasonFor: other field uses humanized last segment', () => {
  assert.equal(reasonFor(issue('a', 'config.reply_to'), 'email.send', t), 'workflows.readiness.missingField|field=reply to');
});

test('reasonFor: known field uses aig.field label', () => {
  const tl = (k, v) => (k === 'aig.field.subject' ? 'Tiêu đề email' : t(k, v));
  assert.equal(reasonFor(issue('a', 'config.subject'), 'email.send', tl), 'workflows.readiness.missingField|field=Tiêu đề email');
});

test('reasonFor: connectionId on a node type without provider -> generic', () => {
  assert.equal(reasonFor(issue('a', 'connectionId'), 'ai.generate', t), 'workflows.readiness.generic');
});

test('reasonFor: no field -> generic, never raw code', () => {
  const r = reasonFor(issue('a', null, 'SOME_CODE'), 'email.send', t);
  assert.equal(r, 'workflows.readiness.generic');
});

test('webStepUrl', () => {
  assert.equal(webStepUrl('https://app.example.test/', 'wf-1', 'send email'), 'https://app.example.test/workflows/wf-1/builder?step=send%20email');
  assert.equal(webStepUrl('https://h.test', 'a/b', 'n'), 'https://h.test/workflows/a%2Fb/builder?step=n');
  assert.equal(webStepUrl('', 'wf-1', 'a'), null);
  assert.equal(webStepUrl(undefined, 'wf-1', 'a'), null);
});

test('readinessView: undefined readiness (loading or error) -> nothing red, publish not blocked', () => {
  const { readinessView } = require('./readiness.ts');
  const v = readinessView(undefined, ['a']);
  assert.equal(v.redCount, 0);
  assert.equal(v.publishBlocked, false);
  assert.equal(v.showGraphLine, false);
  assert.equal(v.byStep.size, 0);
});

test('readinessView: ready workflow -> not blocked', () => {
  const { readinessView } = require('./readiness.ts');
  const v = readinessView({ ready: true, issues: [] }, ['a']);
  assert.equal(v.publishBlocked, false);
});

test('readinessView: step issues -> redCount, blocked, no graph line', () => {
  const { readinessView } = require('./readiness.ts');
  const v = readinessView({ ready: false, issues: [issue('a', 'x'), issue('b', 'y'), issue('b', 'z')] }, ['a', 'b']);
  assert.equal(v.redCount, 2);
  assert.equal(v.publishBlocked, true);
  assert.equal(v.showGraphLine, false);
});

test('readinessView: graph-only issue -> blocked with graph line, zero red steps', () => {
  const { readinessView } = require('./readiness.ts');
  const v = readinessView({ ready: false, issues: [issue(null, null, 'CYCLE')] }, ['a']);
  assert.equal(v.redCount, 0);
  assert.equal(v.publishBlocked, true);
  assert.equal(v.showGraphLine, true);
});

test('withVars fills {placeholders} that the store t() ignores', () => {
  const { withVars, reasonFor } = require('./readiness.ts');
  const base = (k) => ({ 'workflows.readiness.pickAccount': 'Chọn tài khoản {provider}', 'provider.GMAIL': 'Gmail' })[k] ?? k;
  const tv = withVars(base);
  assert.equal(tv('workflows.readiness.pickAccount', { provider: 'Gmail' }), 'Chọn tài khoản Gmail');
  assert.equal(tv('provider.GMAIL'), 'Gmail');
  assert.equal(reasonFor(issue('a', 'connectionId'), 'email.send', tv), 'Chọn tài khoản Gmail');
});
