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

describe('generationResultSchema node names', () => {
  it('keeps an optional readable step name and rejects an empty or overlong one', () => {
    const named = ready(
      [{ ...start, name: 'Chạy thủ công' }, { ...http('one'), name: 'Gọi API' }],
      [{ from: 'start', to: 'one' }],
    );
    expect(named.success).toBe(true);
    expect(named.success && named.data.status === 'ready' && named.data.intent.nodes[1].name).toBe('Gọi API');
    expect(ready([{ ...start, name: '' }, http('one')], [{ from: 'start', to: 'one' }]).success).toBe(false);
    expect(ready([{ ...start, name: 'x'.repeat(81) }, http('one')], [{ from: 'start', to: 'one' }]).success).toBe(false);
    expect(ready([start, http('one')], [{ from: 'start', to: 'one' }]).success).toBe(true);
  });
});

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

describe('generationResultSchema nested configs', () => {
  const rich = generationResultSchema([
    { type: 'trigger.manual', configFields: [] },
    {
      type: 'logic.condition',
      configFields: ['left', 'operator', 'right', 'combinator', 'conditions'],
    },
    {
      type: 'email.send',
      configFields: [
        'to',
        'subject',
        'body',
        'attachments',
        'replyToMessageId',
      ],
    },
  ]);
  const multi = {
    id: 'check',
    type: 'logic.condition',
    config: {
      combinator: 'or',
      conditions: [
        { left: '{{trigger.input.a}}', operator: 'gt', right: 1 },
        { left: '{{trigger.input.b}}', operator: 'eq', right: 'x' },
      ],
    },
  };
  const mail = (attachments: unknown) => ({
    id: 'mail',
    type: 'email.send',
    config: {
      to: 'a@example.com',
      subject: 's',
      body: 'b',
      replyToMessageId: '{{trigger.input.messageId}}',
      attachments,
    },
  });
  const graph = (attachments: unknown) =>
    rich.safeParse({
      status: 'ready',
      intent: {
        name: 'W',
        nodes: [start, multi, mail(attachments)],
        edges: [
          { from: 'start', to: 'check' },
          { from: 'check', to: 'mail', port: 'true' },
        ],
      },
    });

  it('accepts the multi-condition form and a template attachments list', () => {
    expect(graph('{{trigger.input.attachments}}').success).toBe(true);
  });

  it('accepts attachments given as objects with a public url', () => {
    expect(
      graph([{ url: 'https://example.com/a.pdf', filename: 'a.pdf' }]).success,
    ).toBe(true);
  });

  it('still rejects an internal attachment url', () => {
    expect(graph([{ url: 'http://localhost/a.pdf' }]).success).toBe(false);
  });
});

describe('generationResultSchema triggers', () => {
  const withSchedule = generationResultSchema([
    { type: 'trigger.schedule', configFields: ['cron'] },
    { type: 'http.request', configFields: ['method', 'url'] },
  ]);
  const body = (nodes: unknown[], edges: { from: string; to: string }[]) =>
    withSchedule.safeParse({
      status: 'ready',
      intent: { name: 'W', nodes, edges },
    });

  it('accepts a workflow whose only trigger is not manual', () => {
    const trigger = {
      id: 'tick',
      type: 'trigger.schedule',
      config: { cron: '0 0 8 * * *' },
    };
    expect(
      body([trigger, http('one')], [{ from: 'tick', to: 'one' }]).success,
    ).toBe(true);
  });

  const both = generationResultSchema([
    { type: 'trigger.manual', configFields: [] },
    { type: 'trigger.webhook', configFields: [] },
    { type: 'http.request', configFields: ['method', 'url'] },
  ]);
  const manual = (id: string) => ({ id, type: 'trigger.manual', config: {} });
  const hook = { id: 'hook', type: 'trigger.webhook', config: {} };
  const both_ = (nodes: unknown[], edges: { from: string; to: string }[]) =>
    both.safeParse({ status: 'ready', intent: { name: 'W', nodes, edges } });

  it('rejects two manual triggers', () => {
    expect(
      both_(
        [manual('m1'), manual('m2'), http('one')],
        [
          { from: 'm1', to: 'one' },
          { from: 'm2', to: 'one' },
        ],
      ).success,
    ).toBe(false);
  });

  it('accepts a manual trigger next to a webhook when both lead somewhere', () => {
    expect(
      both_(
        [manual('m1'), hook, http('one')],
        [
          { from: 'm1', to: 'one' },
          { from: 'hook', to: 'one' },
        ],
      ).success,
    ).toBe(true);
  });

  it('rejects a dead manual trigger next to another trigger', () => {
    expect(
      both_([manual('m1'), hook, http('one')], [{ from: 'hook', to: 'one' }])
        .success,
    ).toBe(false);
  });

  it('rejects a workflow with no trigger', () => {
    expect(body([http('one')], []).success).toBe(false);
  });
});
