const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../test-support/register-typescript.cjs');
const { requiredConnectionProvider, autoPickConnections } = require('./auto-pick.ts');

const c = (id, provider, extra = {}) => ({ id, provider, status: 'ACTIVE', canAttach: true, ...extra });
const def = (config = { to: 'x' }) => ({
  schemaVersion: '1',
  edges: [],
  nodes: [
    { id: 'a', type: 'trigger.manual', config: {} },
    { id: 'b', type: 'email.send', config },
  ],
});

test('requiredConnectionProvider skips http.request and ai.*', () => {
  assert.equal(requiredConnectionProvider('email.send'), 'GMAIL');
  assert.equal(requiredConnectionProvider('http.request'), null);
  assert.equal(requiredConnectionProvider('ai.generate'), null);
});

test('attaches the only usable connection', () => {
  const out = autoPickConnections(def(), [c('g1', 'GMAIL')], requiredConnectionProvider);
  assert.deepEqual(out.nodes[1].config, { to: 'x', connectionId: 'g1' });
  assert.deepEqual(out.nodes[0].config, {});
});

test('two matches attach nothing', () => {
  const out = autoPickConnections(def(), [c('g1', 'GMAIL'), c('g2', 'GMAIL')], requiredConnectionProvider);
  assert.equal(out.nodes[1].config.connectionId, undefined);
});

test('ignores INVALID and canAttach:false', () => {
  const none = autoPickConnections(def(), [c('g1', 'GMAIL', { status: 'INVALID' }), c('g2', 'GMAIL', { canAttach: false })], requiredConnectionProvider);
  assert.equal(none.nodes[1].config.connectionId, undefined);
  const one = autoPickConnections(def(), [c('g1', 'GMAIL', { status: 'INVALID' }), c('g3', 'GMAIL')], requiredConnectionProvider);
  assert.equal(one.nodes[1].config.connectionId, 'g3');
});

test('keeps an existing connectionId', () => {
  const out = autoPickConnections(def({ to: 'x', connectionId: 'given' }), [c('g1', 'GMAIL')], requiredConnectionProvider);
  assert.equal(out.nodes[1].config.connectionId, 'given');
});

test('never attaches http.request or ai.generate', () => {
  const d = { schemaVersion: '1', edges: [], nodes: [
    { id: 'h', type: 'http.request', config: {} },
    { id: 'ai', type: 'ai.generate', config: {} },
  ] };
  const out = autoPickConnections(d, [c('h1', 'HTTP'), c('k1', 'OPENAI')], requiredConnectionProvider);
  assert.equal(out.nodes[0].config.connectionId, undefined);
  assert.equal(out.nodes[1].config.connectionId, undefined);
});

test('does not mutate the input', () => {
  const d = def();
  const before = structuredClone(d);
  const out = autoPickConnections(d, [c('g1', 'GMAIL')], requiredConnectionProvider);
  assert.deepEqual(d, before);
  assert.notEqual(out, d);
});
