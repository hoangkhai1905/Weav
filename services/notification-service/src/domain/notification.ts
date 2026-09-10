import { z } from 'zod';

export const providerSchema = z.enum(['TELEGRAM', 'EXPO_PUSH']);
export const statusSchema = z.enum(['PENDING', 'SENDING', 'SENT', 'FAILED']);
export const eventTypeSchema = z.enum([
  'workflow.completed',
  'workflow.failed',
]);
export const executionEventSchema = z
  .object({
    eventId: z.uuid(),
    eventType: eventTypeSchema,
    occurredAt: z.iso.datetime({ offset: true }),
    aggregateType: z.literal('workflow_execution'),
    aggregateId: z.uuid(),
    payload: z.object({
      executionId: z.uuid(),
      workflowId: z.uuid(),
      workspaceId: z.uuid(),
      userId: z.uuid(),
      workflowName: z.string().trim().min(1).max(200),
      status: z.enum(['SUCCESS', 'FAILED']),
      finishedAt: z.iso.datetime({ offset: true }),
      summary: z.string().max(1000).optional(),
      error: z
        .object({
          code: z.string().max(80).optional(),
          message: z.string().max(1000).optional(),
        })
        .nullable()
        .optional(),
      recipients: z
        .array(
          z.object({
            provider: providerSchema,
            destination: z.string().trim().min(1).max(512),
          }),
        )
        .min(1)
        .max(100),
    }),
  })
  .superRefine((event, ctx) => {
    if (
      event.aggregateId !== event.payload.executionId ||
      (event.eventType === 'workflow.completed') !==
        (event.payload.status === 'SUCCESS')
    ) {
      ctx.addIssue({ code: 'custom', message: 'Inconsistent execution event' });
    }
  });
export type ExecutionEvent = z.infer<typeof executionEventSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type Status = z.infer<typeof statusSchema>;
export type Payload = Record<string, unknown>;
export interface Delivery {
  id: string;
  userId: string;
  executionId: string | null;
  sourceEventId: string | null;
  provider: Provider;
  destination: string;
  eventType: string;
  payload: Payload;
  status: Status;
  retryCount: number;
  lastError: Payload | null;
  readAt: Date | null;
  scheduledAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface ListQuery {
  limit: number;
  cursor?: { id: string; createdAt: Date };
  unreadOnly?: boolean;
  eventType?: string;
  status?: Status;
}
export abstract class DeliveryRepository {
  abstract ingest(event: ExecutionEvent, payload: Payload): Promise<void>;
  abstract list(userId: string, query: ListQuery): Promise<Delivery[]>;
  abstract unreadCount(userId: string): Promise<number>;
  abstract markRead(userId: string, id: string): Promise<Delivery | null>;
  abstract markAllRead(userId: string): Promise<number>;
  abstract claim(
    maxAttempts: number,
    leaseMs: number,
  ): Promise<Delivery | null>;
  abstract finish(delivery: Delivery, patch: DeliveryPatch): Promise<void>;
  abstract ready(): Promise<boolean>;
}
export interface DeliveryPatch {
  status: Status;
  scheduledAt: Date | null;
  sentAt?: Date;
  lastError?: Payload | null;
  payload?: Payload;
}
export type SendResult =
  { kind: 'sent' } | { kind: 'receipt'; id: string } | { kind: 'pending' };
export interface NotificationProvider {
  send(delivery: Delivery): Promise<SendResult>;
  receipt?(id: string): Promise<SendResult>;
}
export class DeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterMs = 0,
    readonly resend = false,
  ) {
    super(code);
  }
}
export function retryDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  retryAfterMs = 0,
): number {
  return Math.max(
    Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs),
    retryAfterMs,
  );
}
// Provider output, raw execution input/output, and arbitrary upstream errors are never copied.
export function publicPayload(event: ExecutionEvent): Payload {
  return {
    workflowId: event.payload.workflowId,
    workspaceId: event.payload.workspaceId,
    workflowName: event.payload.workflowName,
    title:
      event.eventType === 'workflow.completed'
        ? 'Workflow completed'
        : 'Workflow failed',
    message:
      event.eventType === 'workflow.completed'
        ? 'Workflow completed successfully.'
        : 'Workflow failed. Open the execution for details.',
    finishedAt: event.payload.finishedAt,
  };
}
export function deliveryView(row: Delivery) {
  const { workflowId, workspaceId, workflowName, title, message, finishedAt } =
    row.payload;
  return {
    id: row.id,
    userId: row.userId,
    executionId: row.executionId,
    provider: row.provider,
    eventType: row.eventType,
    title,
    message,
    payload: { workflowId, workspaceId, workflowName, finishedAt },
    status: row.status,
    read: row.readAt !== null,
    readAt: row.readAt,
    scheduledAt: row.scheduledAt,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
