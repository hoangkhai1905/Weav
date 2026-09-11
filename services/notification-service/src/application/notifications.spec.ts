import { Notifications } from './notifications';
import { mockRepository, testDelivery, testEvent } from '../testing/fixtures';

describe('notification use cases', () => {
  const repo = mockRepository();
  const service = new Notifications(repo);
  beforeEach(() => jest.resetAllMocks());
  it('awaits durable ingestion and propagates failures to the consumer', async () => {
    repo.ingest.mockRejectedValue(new Error('offline'));
    await expect(service.consume(testEvent())).rejects.toThrow('offline');
    expect(repo.ingest).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed messages before touching persistence', async () => {
    await expect(service.consume({})).rejects.toThrow();
    expect(repo.ingest).not.toHaveBeenCalled();
  });
  it('uses current user and stable paginated cursor', async () => {
    const first = testDelivery(),
      second = testDelivery();
    repo.list.mockResolvedValue([first, second]);
    const result = await service.list(first.userId, { limit: 1 });
    expect(repo.list).toHaveBeenCalledWith(first.userId, { limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(
      JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString()),
    ).toEqual({ id: first.id, createdAt: first.createdAt.toISOString() });
  });
  it('returns 404 for missing or foreign IDs', async () => {
    repo.markRead.mockResolvedValue(null);
    await expect(service.markRead('user', 'foreign')).rejects.toMatchObject({
      status: 404,
    });
    expect(repo.markRead).toHaveBeenCalledWith('user', 'foreign');
  });
  it('scopes read-all and unread-count', async () => {
    repo.markAllRead.mockResolvedValue(2);
    repo.unreadCount.mockResolvedValue(0);
    expect(await service.markAllRead('user')).toEqual({ updatedCount: 2 });
    expect(await service.unreadCount('user')).toEqual({ count: 0 });
    expect(repo.markAllRead).toHaveBeenCalledWith('user');
    expect(repo.unreadCount).toHaveBeenCalledWith('user');
  });
});
