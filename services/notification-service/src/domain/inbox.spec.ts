import { inboxDedupKey, inboxIdForKey } from './inbox';

const eventId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const legacyDeliveryId = '00000000-0000-4000-8000-000000000003';

describe('notification inbox identity', () => {
  it('canonicalizes event and user UUIDs into one deterministic group key', () => {
    expect(inboxDedupKey(userId.toUpperCase(), eventId.toUpperCase())).toBe(
      `event:${eventId}:user:${userId}`,
    );
  });

  it('keeps null-event legacy deliveries separate by delivery and user', () => {
    expect(inboxDedupKey(userId, null, legacyDeliveryId)).toBe(
      `legacy:${legacyDeliveryId}:user:${userId}`,
    );
    expect(
      inboxDedupKey(userId, null, '00000000-0000-4000-8000-000000000004'),
    ).not.toBe(inboxDedupKey(userId, null, legacyDeliveryId));
  });

  it('derives the specified RFC UUIDv5 value for an event and user', () => {
    expect(inboxIdForKey(`event:${eventId}:user:${userId}`)).toBe(
      '79119c18-a0be-5554-8003-9555c5e252f8',
    );
  });

  it('rejects malformed UUIDs and null events without a delivery UUID', () => {
    expect(() => inboxDedupKey('not-a-uuid', eventId)).toThrow();
    expect(() => inboxDedupKey(userId, 'not-a-uuid')).toThrow();
    expect(() => inboxDedupKey(userId, null)).toThrow();
    expect(() => inboxDedupKey(userId, null, 'not-a-uuid')).toThrow();
  });

  it('rejects a dedup key that cannot fit the persisted ASCII column', () => {
    expect(() => inboxIdForKey('x'.repeat(129))).toThrow();
    expect(() => inboxIdForKey('event:é')).toThrow();
  });
});
