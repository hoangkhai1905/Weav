/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- in-memory Prisma fake */
import { PrismaInboxRepository } from './prisma.inbox.repository';
import { testSettings } from '../testing/fixtures';
import { notificationEventV2Schema } from '../domain/notification-event';

const ids = {
  event: '00000000-0000-4000-8000-000000000011',
  inviter: '00000000-0000-4000-8000-000000000002',
  workspace: '00000000-0000-4000-8000-000000000003',
};
const invitation = notificationEventV2Schema.parse({
  schemaVersion: 2,
  eventId: ids.event,
  eventType: 'workspace.invitation.created',
  occurredAt: '2026-10-10T04:00:00Z',
  producer: 'workspace-service',
  actorUserId: ids.inviter,
  recipientUserIds: [ids.inviter],
  workspaceId: ids.workspace,
  entity: { kind: 'WORKSPACE', id: ids.workspace },
  data: {
    workspaceName: 'Đội vận hành',
    inviterName: 'Nguyễn An',
    inviteeEmail: 'new.member@example.com',
    expiresAt: '2026-10-17T04:00:00Z',
  },
});

type Row = Record<string, any>;

/** Minimal in-memory stand-in for the Prisma transaction used by ingest. */
function fakeClient() {
  const inbox: Row[] = [];
  const deliveries: Row[] = [];
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    notificationInbox: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          inbox.filter((r) => r.sourceEventId === where.sourceEventId),
        ),
      ),
      createMany: jest.fn(({ data }: any) => {
        for (const row of data)
          if (!inbox.some((r) => r.dedupKey === row.dedupKey))
            inbox.push({ ...row });
        return Promise.resolve({ count: data.length });
      }),
      count: jest.fn(({ where }: any) =>
        Promise.resolve(
          inbox.filter(
            (r) =>
              r.sourceEventId === where.sourceEventId &&
              where.userId.in.includes(r.userId),
          ).length,
        ),
      ),
    },
    notificationDelivery: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          deliveries.filter((r) => r.sourceEventId === where.sourceEventId),
        ),
      ),
      createMany: jest.fn(({ data }: any) => {
        for (const row of data)
          if (
            !deliveries.some(
              (r) =>
                r.sourceEventId === row.sourceEventId &&
                r.userId === row.userId &&
                r.provider === row.provider &&
                r.destination === row.destination,
            )
          )
            deliveries.push({ ...row });
        return Promise.resolve({ count: data.length });
      }),
    },
  };
  return {
    inbox,
    deliveries,
    client: { $transaction: (fn: any) => fn(tx) },
  };
}

describe('PrismaInboxRepository.ingest for workspace.invitation.created', () => {
  it('creates one inbox row and one EMAIL delivery, and a replay is a no-op', async () => {
    const repo = new PrismaInboxRepository(testSettings());
    const fake = fakeClient();
    (repo as unknown as { client: unknown }).client = fake.client;

    await repo.ingest(invitation);
    await expect(repo.ingest(invitation)).resolves.toBeUndefined();

    expect(fake.inbox).toHaveLength(1);
    expect(fake.inbox[0]).toMatchObject({
      userId: ids.inviter,
      eventType: 'workspace.invitation.created',
    });
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.deliveries[0]).toMatchObject({
      userId: ids.inviter,
      inboxId: fake.inbox[0].id,
      sourceEventId: ids.event,
      provider: 'EMAIL',
      destination: 'new.member@example.com',
      eventType: 'workspace.invitation.created',
      executionId: null,
      payload: {
        workspaceName: 'Đội vận hành',
        inviterName: 'Nguyễn An',
        expiresAt: '2026-10-17T04:00:00Z',
      },
    });
  });
});
