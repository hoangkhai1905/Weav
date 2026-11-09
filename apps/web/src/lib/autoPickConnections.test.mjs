import assert from 'node:assert/strict';
import test from 'node:test';
import { autoPickConnections } from './autoPickConnections.ts';

const provider = (type) => ({ 'email.send': 'GMAIL', 'google.sheets': 'GOOGLE_SHEETS' })[type];
const c = (id, prov, extra = {}) => ({ id, provider: prov, status: 'ACTIVE', canAttach: true, ...extra });
const def = (bConfig = { to: 'x' }) => ({
  nodes: [
    { id: 'a', type: 'trigger.manual', config: {} },
    { id: 'b', type: 'email.send', config: bConfig },
  ],
});
const nodeB = (d) => d.nodes[1];

test('attaches the only usable connection', () => {
  const out = autoPickConnections(def(), [c('g1', 'GMAIL')], provider);
  assert.deepEqual(nodeB(out).config, { to: 'x', connectionId: 'g1' });
  assert.deepEqual(out.nodes[0].config, {});
});

test('leaves the step blank when two connections match', () => {
  const out = autoPickConnections(def(), [c('g1', 'GMAIL'), c('g2', 'GMAIL')], provider);
  assert.equal(nodeB(out).config.connectionId, undefined);
});

test('ignores inactive or non-attachable connections', () => {
  const none = autoPickConnections(def(), [c('g1', 'GMAIL', { status: 'INVALID' }), c('g2', 'GMAIL', { canAttach: false })], provider);
  assert.equal(nodeB(none).config.connectionId, undefined);
  const one = autoPickConnections(def(), [c('g1', 'GMAIL', { status: 'INVALID' }), c('g3', 'GMAIL')], provider);
  assert.equal(nodeB(one).config.connectionId, 'g3');
});

test('keeps a connection the model already set', () => {
  const out = autoPickConnections(def({ to: 'x', connectionId: 'given' }), [c('g1', 'GMAIL')], provider);
  assert.equal(nodeB(out).config.connectionId, 'given');
});

test('never attaches optional connections', () => {
  const d = { nodes: [{ id: 'ai', type: 'ai.generate', config: { prompt: 'p' } }] };
  const out = autoPickConnections(d, [c('k1', 'OPENAI')], provider);
  assert.equal(out.nodes[0].config.connectionId, undefined);
});

test('does not mutate the input and tolerates bad input', () => {
  const d = def();
  const before = structuredClone(d);
  autoPickConnections(d, [c('g1', 'GMAIL')], provider);
  assert.deepEqual(d, before);
  assert.equal(autoPickConnections(null, [], provider), null);
});
