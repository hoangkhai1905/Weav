import {
  deliveryView,
  executionEventSchema,
  publicPayload,
  retryDelay,
} from './notification';
import { testDelivery, testEvent } from '../testing/fixtures';

describe('notification domain', () => {
  it('accepts terminal events and strips arbitrary fields', () => {
    expect(
      executionEventSchema.parse({ ...testEvent(), secret: 'hidden' }),
    ).not.toHaveProperty('secret');
  });
  it.each([
    'missing recipient',
    'mismatched status',
    'bad id',
    'mismatched execution',
  ])('rejects %s', (kind) => {
    const event = testEvent();
    if (kind === 'missing recipient') event.payload.recipients = [];
    if (kind === 'mismatched status') event.payload.status = 'FAILED';
    if (kind === 'bad id') event.eventId = 'bad';
    if (kind === 'mismatched execution') event.aggregateId = event.eventId;
    expect(executionEventSchema.safeParse(event).success).toBe(false);
  });
  it('does not copy raw summary/error or internal receipt/destination into the inbox', () => {
    const event = testEvent();
    event.payload.summary = 'sensitive';
    event.payload.error = { message: 'sensitive' };
    expect(JSON.stringify(publicPayload(event))).not.toContain('sensitive');
    const row = testDelivery();
    row.destination = 'sensitive';
    row.payload._receiptId = 'private';
    expect(JSON.stringify(deliveryView(row))).not.toMatch(
      /sensitive|private|destination/,
    );
  });
  it('bounds exponential delay while respecting provider retry-after', () => {
    expect([1, 2, 3, 4, 8].map((n) => retryDelay(n, 1000, 5000))).toEqual([
      1000, 2000, 4000, 5000, 5000,
    ]);
    expect(retryDelay(1, 1000, 5000, 10000)).toBe(10000);
  });
});
