import { generationResultSchema } from './generation-result';

const schema = generationResultSchema([
  { type: 'trigger.manual', configFields: [] },
  { type: 'logic.switch', configFields: ['cases', 'value'] },
  { type: 'logic.condition', configFields: ['left', 'operator', 'right'] },
  { type: 'http.request', configFields: ['method', 'url'] },
]);

const http = (id: string) => ({
  id,
  type: 'http.request',
  config: { method: 'GET', url: 'https://example.com' },
});
const sw = {
  id: 'route',
  type: 'logic.switch',
  config: { value: '{{trigger.input.kind}}', cases: ['a', 'b'] },
};
const cond = {
  id: 'check',
  type: 'logic.condition',
  config: { left: '1', operator: 'eq', right: '1' },
};
const start = { id: 'start', type: 'trigger.manual', config: {} };

const ready = (
  nodes: unknown[],
  edges: { from: string; to: string; port?: string }[],
) => schema.safeParse({ status: 'ready', intent: { name: 'W', nodes, edges } });

describe('generationResultSchema edge ports', () => {
  const switchGraph = (port?: string) =>
    ready(
      [start, sw, http('one')],
      [
        { from: 'start', to: 'route' },
        { from: 'route', to: 'one', ...(port === undefined ? {} : { port }) },
      ],
    );

  it('accepts a switch graph with case and default ports', () => {
    expect(switchGraph('a').success).toBe(true);
    expect(switchGraph('default').success).toBe(true);
  });

  it('rejects a switch edge with an unknown case', () => {
    expect(switchGraph('zzz').success).toBe(false);
  });

  it('rejects a switch edge without a port', () => {
    expect(switchGraph().success).toBe(false);
  });

  it('accepts condition true/false ports and rejects others', () => {
    const graph = (port?: string) =>
      ready(
        [start, cond, http('one')],
        [
          { from: 'start', to: 'check' },
          { from: 'check', to: 'one', ...(port ? { port } : {}) },
        ],
      );
    expect(graph('true').success).toBe(true);
    expect(graph('maybe').success).toBe(false);
    expect(graph().success).toBe(false);
  });

  it('rejects a port on a source that has none', () => {
    expect(
      ready([start, http('one')], [{ from: 'start', to: 'one', port: 'true' }])
        .success,
    ).toBe(false);
  });

  it('rejects a port longer than 64 characters', () => {
    const long = 'a'.repeat(65);
    const result = ready(
      [start, { ...sw, config: { ...sw.config, cases: [long] } }, http('one')],
      [
        { from: 'start', to: 'route' },
        { from: 'route', to: 'one', port: long },
      ],
    );
    expect(result.success).toBe(false);
  });

  it('accepts several edges sharing one valid port', () => {
    expect(
      ready(
        [start, sw, http('one'), http('two')],
        [
          { from: 'start', to: 'route' },
          { from: 'route', to: 'one', port: 'a' },
          { from: 'route', to: 'two', port: 'a' },
        ],
      ).success,
    ).toBe(true);
  });

  it('rejects a switch without an array of cases on a non-default port', () => {
    for (const config of [{ value: 'x' }, { value: 'x', cases: 'a' }]) {
      expect(
        ready(
          [start, { ...sw, config }, http('one')],
          [
            { from: 'start', to: 'route' },
            { from: 'route', to: 'one', port: 'a' },
          ],
        ).success,
      ).toBe(false);
    }
  });

  it('rejects an empty port and a condition port the cases lack', () => {
    expect(switchGraph('').success).toBe(false);
    expect(switchGraph('false').success).toBe(false);
  });
});
