import { Notifications } from './notifications';
import { randomUUID } from 'node:crypto';
import { executionEventSchema } from '../domain/notification';
import { InboxRepository } from '../domain/inbox';
import { mockRepository, testDelivery, testEvent } from '../testing/fixtures';

describe('notification use cases', () => {
  const repo = mockRepository();
  const inboxRepository = {
    ingest: jest.fn().mockResolvedValue(undefined),
    list: jest.fn(),
    unreadCount: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    ready: jest.fn(),
    reconcileLegacy: jest.fn(),
  } as unknown as InboxRepository;
  const service = Reflect.construct(Notifications, [repo, inboxRepository]) as Notifications;
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
  it('routes schemaVersion 2 events to inbox persistence without legacy deliveries', async () => {
    const workspaceId = randomUUID();
    const event = {
      schemaVersion: 2,
      eventId: randomUUID(),
      eventType: 'workspace.created',
      occurredAt: '2026-09-27T04:00:00Z',
      producer: 'workspace-service',
      actorUserId: randomUUID(),
      recipientUserIds: [randomUUID()],
      workspaceId,
      entity: { kind: 'WORKSPACE', id: workspaceId },
      data: { workspaceName: 'Operations' },
    };

    await service.consume(event);

    expect(inboxRepository.ingest).toHaveBeenCalledWith(event);
    expect(repo.ingest).not.toHaveBeenCalled();
  });
  it('skips the inbox for a workflow lifecycle event whose only recipient is its actor', async () => {
    const ingest = (inboxRepository as unknown as { ingest: jest.Mock }).ingest;
    const actor = randomUUID();
    const workflowId = randomUUID();
    const event = (recipient: string) => ({
      schemaVersion: 2,
      eventId: randomUUID(),
      eventType: 'workflow.paused',
      occurredAt: '2026-09-27T04:00:00Z',
      producer: 'workflow-service',
      actorUserId: actor,
      recipientUserIds: [recipient],
      workspaceId: randomUUID(),
      entity: { kind: 'WORKFLOW', id: workflowId },
      data: { workflowName: 'Daily report' },
    });

    await service.consume(event(actor));
    expect(ingest).not.toHaveBeenCalled();

    await service.consume(event(randomUUID()));
    expect(ingest).toHaveBeenCalledTimes(1);
  });
  it('rejects a present unsupported schemaVersion instead of falling back to legacy', async () => {
    await expect(
      service.consume({ ...testEvent(), schemaVersion: 3 }),
    ).rejects.toThrow();

    expect(repo.ingest).not.toHaveBeenCalled();
    expect(inboxRepository.ingest).not.toHaveBeenCalled();
  });
  it('treats UUID casing variants as the same legacy execution identity', () => {
    const event = testEvent();
    expect(
      executionEventSchema.safeParse({
        ...event,
        aggregateId: event.aggregateId.toUpperCase(),
        payload: {
          ...event.payload,
          executionId: event.payload.executionId.toLowerCase(),
        },
      }).success,
    ).toBe(true);
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
