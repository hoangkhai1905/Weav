import { Logger } from '@nestjs/common';
import { FailOpenThrottlerStorage } from './fail-open-throttler-storage';

describe('FailOpenThrottlerStorage', () => {
  afterEach(() => jest.restoreAllMocks());

  it('passes the shared storage result through', async () => {
    const record = {
      totalHits: 7,
      timeToExpire: 1,
      isBlocked: true,
      timeToBlockExpire: 2,
    };
    const inner = { increment: jest.fn().mockResolvedValue(record) };
    const storage = new FailOpenThrottlerStorage(inner);
    await expect(storage.increment('k', 60, 5, 60, 'general')).resolves.toBe(
      record,
    );
    expect(inner.increment).toHaveBeenCalledWith('k', 60, 5, 60, 'general');
  });

  it('allows the request and warns when the storage fails', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const storage = new FailOpenThrottlerStorage({
      increment: jest.fn().mockRejectedValue(new Error('valkey down')),
    });
    const record = await storage.increment('k', 60, 5, 60, 'general');
    expect(record.isBlocked).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
