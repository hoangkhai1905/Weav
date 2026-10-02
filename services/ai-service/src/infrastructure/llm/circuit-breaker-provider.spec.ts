import { AiError } from '../../domain/errors';
import { CircuitBreakerProvider } from './circuit-breaker-provider';

const req = { system: 's', user: 'u' };
const signal = new AbortController().signal;

function setup(threshold = 3) {
  let t = 0;
  const completeJson = jest.fn();
  const breaker = new CircuitBreakerProvider(
    { completeJson },
    threshold,
    30_000,
    () => t,
  );
  return {
    inner: { completeJson },
    breaker,
    advance: (ms: number) => (t += ms),
  };
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e: AiError) => e.code,
  );

describe('CircuitBreakerProvider', () => {
  it('opens after N failures, fails fast, then recovers after the open period', async () => {
    const { inner, breaker, advance } = setup();
    inner.completeJson.mockRejectedValue(
      new AiError('AI_PROVIDER_UNAVAILABLE'),
    );
    for (let i = 0; i < 3; i++)
      await breaker.completeJson(req, signal).catch(() => 0);
    expect(inner.completeJson).toHaveBeenCalledTimes(3);

    expect(await code(breaker.completeJson(req, signal))).toBe(
      'AI_PROVIDER_UNAVAILABLE',
    );
    expect(inner.completeJson).toHaveBeenCalledTimes(3); // failed fast

    advance(30_000);
    inner.completeJson.mockResolvedValue({ ok: 1 });
    expect(await code(breaker.completeJson(req, signal))).toBe('OK');
    expect(await code(breaker.completeJson(req, signal))).toBe('OK');
    expect(inner.completeJson).toHaveBeenCalledTimes(5);
  });

  it('reopens when the half-open trial fails', async () => {
    const { inner, breaker, advance } = setup(1);
    inner.completeJson.mockRejectedValue(new AiError('AI_TIMEOUT'));
    await breaker.completeJson(req, signal).catch(() => 0);
    advance(30_000);
    await breaker.completeJson(req, signal).catch(() => 0); // trial
    expect(inner.completeJson).toHaveBeenCalledTimes(2);
    await breaker.completeJson(req, signal).catch(() => 0); // open again
    expect(inner.completeJson).toHaveBeenCalledTimes(2);
  });

  it('does not count a caller hang-up', async () => {
    const { inner, breaker } = setup(1);
    const aborted = new AbortController();
    aborted.abort();
    inner.completeJson.mockRejectedValue(new AiError('AI_TIMEOUT'));
    await breaker.completeJson(req, aborted.signal).catch(() => 0);
    await breaker.completeJson(req, signal).catch(() => 0);
    expect(inner.completeJson).toHaveBeenCalledTimes(2); // still closed
  });

  it('does not count output/validation errors', async () => {
    const { inner, breaker } = setup(2);
    inner.completeJson.mockRejectedValue(new AiError('AI_OUTPUT_INVALID'));
    for (let i = 0; i < 5; i++)
      await breaker.completeJson(req, signal).catch(() => 0);
    expect(inner.completeJson).toHaveBeenCalledTimes(5);
  });
});
