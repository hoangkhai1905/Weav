import { randomUUID } from 'node:crypto';
import { ENVELOPES } from './envelopes';

const base = () => ({ requestId: randomUUID(), workspaceId: randomUUID() });
const llm = { provider: 'OPENAI', apiKey: 'sk-test' };
const bodies = {
  extract: { text: 't', outputSchema: {} },
  classify: { text: 't', categories: ['a', 'b'] },
  summarize: { text: 't', maxLength: 10 },
  prompt: { prompt: 'p' },
} as const;

describe('llm selection in envelopes', () => {
  it.each(Object.keys(bodies) as (keyof typeof bodies)[])(
    'is accepted on %s',
    (op) => {
      const parsed = ENVELOPES[op].safeParse({
        ...base(),
        operation: op,
        ...bodies[op],
        llm: { ...llm, model: 'gpt-5-mini' },
      });
      expect(parsed.success).toBe(true);
    },
  );

  it('is rejected on generate', () => {
    const parsed = ENVELOPES.generate.safeParse({
      ...base(),
      operation: 'generate',
      prompt: 'p',
      capabilities: [{ type: 'a.b', configFields: [] }],
      llm,
    });
    expect(parsed.success).toBe(false);
  });

  const summarize = (l: unknown) =>
    ENVELOPES.summarize.safeParse({
      ...base(),
      operation: 'summarize',
      ...bodies.summarize,
      llm: l,
    }).success;

  it.each([
    ['apiKey over 512 chars', { ...llm, apiKey: 'k'.repeat(513) }],
    ['apiKey with newline', { ...llm, apiKey: 'sk-a\nb' }],
    ['empty apiKey', { ...llm, apiKey: '' }],
    ['model with a space', { ...llm, model: 'a b' }],
    ['empty model', { ...llm, model: '' }],
    ['model over 100 chars', { ...llm, model: 'm'.repeat(101) }],
    ['unknown provider', { ...llm, provider: 'DEEPSEEK' }],
    ['unknown llm key', { ...llm, baseUrl: 'http://evil' }],
  ])('rejects %s', (_n, l) => {
    expect(summarize(l)).toBe(false);
  });

  it('accepts a 512-char key and a model with dots and dashes', () => {
    expect(
      summarize({ ...llm, apiKey: 'k'.repeat(512), model: 'gemini-2.5-flash' }),
    ).toBe(true);
    expect(summarize({ ...llm, model: '.a:b/c-1' })).toBe(true);
    expect(summarize({ ...llm, model: 'm'.repeat(100) })).toBe(true);
  });
});
