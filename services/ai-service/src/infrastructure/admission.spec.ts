import { Admission } from './admission';

describe('Admission', () => {
  it('admits up to the global maximum, then refuses until a slot is released', () => {
    const admission = new Admission(2, 5);
    const a = admission.tryAcquire('w1');
    const b = admission.tryAcquire('w2');
    expect(a).toEqual(expect.any(Function));
    expect(b).toEqual(expect.any(Function));
    expect(admission.tryAcquire('w3')).toBeNull();
    a!();
    expect(admission.tryAcquire('w3')).toEqual(expect.any(Function));
  });

  it('caps concurrency per workspace without blocking other workspaces', () => {
    const admission = new Admission(10, 2);
    expect(admission.tryAcquire('w1')).not.toBeNull();
    expect(admission.tryAcquire('w1')).not.toBeNull();
    expect(admission.tryAcquire('w1')).toBeNull();
    expect(admission.tryAcquire('w2')).not.toBeNull();
  });

  it('frees exactly one slot per release; releasing twice is a no-op', () => {
    const admission = new Admission(2, 2);
    const first = admission.tryAcquire('w1')!;
    const second = admission.tryAcquire('w1')!;
    expect(admission.tryAcquire('w1')).toBeNull();
    first();
    first();
    first();
    // One slot came back, not three: the second holder still counts.
    const third = admission.tryAcquire('w1');
    expect(third).not.toBeNull();
    expect(admission.tryAcquire('w1')).toBeNull();
    second();
    third!();
    expect(admission.tryAcquire('w1')).not.toBeNull();
  });

  it('forgets a workspace once its last slot is released', () => {
    const admission = new Admission(1, 1);
    admission.tryAcquire('w1')!();
    const internal = admission as unknown as {
      perWorkspace: Map<string, number>;
      total: number;
    };
    expect(internal.perWorkspace.size).toBe(0);
    expect(internal.total).toBe(0);
  });

  it('refuses everything when the maximum is 0', () => {
    expect(new Admission(0, 1).tryAcquire('w1')).toBeNull();
    expect(new Admission(1, 0).tryAcquire('w1')).toBeNull();
  });
});
