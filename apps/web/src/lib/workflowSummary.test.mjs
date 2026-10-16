import assert from 'node:assert/strict';
import test from 'node:test';
import { describeWorkflow, orderedStepTypes } from './workflowSummary.ts';

const dict = { 'wfsum.trigger.trigger.gmail': 'khi có email mới', 'wfsum.step.ai.extract': 'nhờ AI lấy thông tin', 'wfsum.joiner': ', rồi ' };
const t = (key) => dict[key] ?? key;
const labelOf = (type) => `Nhãn ${type}`;

test('orders steps from the trigger along the edges and hides raw codes', () => {
  const nodes = [{ id: 'c', type: 'google.sheets' }, { id: 'a', type: 'trigger.gmail' }, { id: 'b', type: 'ai.extract' }];
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];
  const steps = orderedStepTypes(nodes, edges);
  assert.deepEqual(steps, ['ai.extract', 'google.sheets']);
  assert.deepEqual(describeWorkflow('trigger.gmail', steps, t, labelOf), { when: 'khi có email mới', then: 'nhờ AI lấy thông tin, rồi Nhãn google.sheets' });
  assert.equal(describeWorkflow('trigger.gmail', [], t, labelOf).then, null);
});
