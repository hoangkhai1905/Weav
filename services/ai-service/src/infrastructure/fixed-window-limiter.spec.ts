import { FixedWindowLimiter } from './fixed-window-limiter';

describe('FixedWindowLimiter', () => {
  function setup(limit: number, windowMs = 60_000) {
    let t = 1_000;
    const limiter = new FixedWindowLimiter(limit, windowMs, () => t);
    return { limiter, advance: (ms: number) => (t += ms) };
  }

  it('allows `limit` hits per window, then refuses', () => {
    const { limiter } = setup(3);
    expect([1, 2, 3, 4, 5].map(() => limiter.tryHit('u'))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it('counts each key on its own', () => {
    const { limiter } = setup(1);
    expect(limiter.tryHit('a')).toBe(true);
    expect(limiter.tryHit('a')).toBe(false);
    expect(limiter.tryHit('b')).toBe(true);
  });

  it('starts a new window once windowMs has passed, not before', () => {
    const { limiter, advance } = setup(1, 1000);
    expect(limiter.tryHit('u')).toBe(true);
    advance(999);
    expect(limiter.tryHit('u')).toBe(false);
    advance(1);
    expect(limiter.tryHit('u')).toBe(true);
    expect(limiter.tryHit('u')).toBe(false);
  });

  it('refused hits do not extend the window', () => {
    const { limiter, advance } = setup(1, 1000);
    limiter.tryHit('u');
    advance(600);
    limiter.tryHit('u');
    advance(400);
    expect(limiter.tryHit('u')).toBe(true);
  });

  it('drops expired windows once more than 10 000 keys are tracked', () => {
    const { limiter, advance } = setup(1, 1000);
    for (let i = 0; i < 10_001; i++) limiter.tryHit(`k${i}`);
    advance(1000);
    limiter.tryHit('fresh');
    const windows = (limiter as unknown as { windows: Map<string, unknown> })
      .windows;
    expect(windows.size).toBe(1);
    expect(windows.has('fresh')).toBe(true);
  });
});
