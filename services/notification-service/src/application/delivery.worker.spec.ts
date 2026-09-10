import { DeliveryWorker } from './delivery.worker';
import { DeliveryError } from '../domain/notification';
import {
  mockRepository,
  testDelivery,
  testSettings,
} from '../testing/fixtures';

describe('durable delivery worker', () => {
  const repo = mockRepository();
  const send = jest.fn();
  const receipt = jest.fn();
  const worker = new DeliveryWorker(repo, testSettings(), {
    TELEGRAM: { send },
    EXPO_PUSH: { send, receipt },
  });
  beforeEach(() => jest.resetAllMocks());
  it('persists successful sends', async () => {
    send.mockResolvedValue({ kind: 'sent' });
    const row = testDelivery();
    await worker.deliver(row);
    expect(repo.finish).toHaveBeenCalledWith(
      row,
      expect.objectContaining({
        status: 'SENT',
        scheduledAt: null,
        sentAt: expect.any(Date) as Date,
      }),
    );
  });
  it.each([true, false])(
    'classifies retryable=%s failures',
    async (retryable) => {
      send.mockRejectedValue(new DeliveryError('PROVIDER_ERROR', retryable));
      await worker.deliver(testDelivery());
      expect(repo.finish.mock.calls[0][1]).toMatchObject({
        status: 'FAILED',
        scheduledAt: retryable ? (expect.any(Date) as Date) : null,
      });
    },
  );
  it('stops at the attempt limit', async () => {
    send.mockRejectedValue(new DeliveryError('TIMEOUT', true));
    const row = testDelivery();
    row.retryCount = 5;
    await worker.deliver(row);
    expect(repo.finish.mock.calls[0][1].scheduledAt).toBeNull();
  });
  it('persists receipt tickets and checks them after restart without resending', async () => {
    const row = testDelivery();
    row.provider = 'EXPO_PUSH';
    send.mockResolvedValue({ kind: 'receipt', id: 'ticket' });
    await worker.deliver(row);
    const payload = repo.finish.mock.calls[0][1].payload!;
    expect(payload._receiptId).toBe('ticket');
    row.payload = payload;
    receipt.mockResolvedValue({ kind: 'sent' });
    await worker.deliver(row);
    expect(send).toHaveBeenCalledTimes(1);
    expect(receipt).toHaveBeenCalledWith('ticket');
  });
  it('bounds missing-receipt polling without resending', async () => {
    const row = testDelivery();
    row.provider = 'EXPO_PUSH';
    row.payload._receiptId = 'ticket';
    row.payload._receiptSince = Date.now() - 24 * 3600000;
    await worker.deliver(row);
    expect(send).not.toHaveBeenCalled();
    expect(receipt).not.toHaveBeenCalled();
    expect(repo.finish.mock.calls[0][1]).toMatchObject({
      status: 'FAILED',
      scheduledAt: null,
    });
  });
  it.each([true, false])(
    'clears tickets only for definitive receipt rejection: %s',
    async (resend) => {
      const row = testDelivery();
      row.provider = 'EXPO_PUSH';
      row.payload._receiptId = 'ticket';
      row.payload._receiptSince = Date.now();
      receipt.mockRejectedValue(
        new DeliveryError('EXPO_RETRY', true, 0, resend),
      );
      await worker.deliver(row);
      const patch = repo.finish.mock.calls[0][1];
      expect(patch.payload?._receiptId).toBe(resend ? undefined : 'ticket');
      expect(patch.scheduledAt).not.toBeNull();
      expect(send).not.toHaveBeenCalled();
    },
  );
  it('does not convert a database failure after send into a provider retry', async () => {
    send.mockResolvedValue({ kind: 'sent' });
    repo.finish.mockRejectedValue(new Error('database down'));
    await expect(worker.deliver(testDelivery())).rejects.toThrow(
      'database down',
    );
    expect(repo.finish).toHaveBeenCalledTimes(1);
  });
  it('claims one row before dispatch', async () => {
    repo.claim.mockResolvedValue(null);
    await worker.tick();
    expect(send).not.toHaveBeenCalled();
    expect(repo.claim).toHaveBeenCalledWith(5, 60000);
  });
});
