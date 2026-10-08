import { z } from 'zod';

const uuidSchema = z.uuid();
const displayNameSchema = z.string().min(1).max(200).regex(/\S/);
const recipientUserIdsSchema = z
  .array(uuidSchema)
  .min(1)
  .max(100)
  .refine((userIds) => new Set(userIds).size === userIds.length, {
    message: 'Recipient user IDs must be unique',
  });

const eventSchema = <
  EventType extends string,
  Producer extends string,
  EntityKind extends string,
  WorkspaceIdSchema extends z.ZodType,
  DataSchema extends z.ZodObject,
>(
  eventType: EventType,
  producer: Producer,
  entityKind: EntityKind,
  workspaceId: WorkspaceIdSchema,
  data: DataSchema,
) =>
  z
    .object({
      schemaVersion: z.literal(2),
      eventId: uuidSchema,
      eventType: z.literal(eventType),
      occurredAt: z.iso.datetime({ offset: true }),
      producer: z.literal(producer),
      actorUserId: uuidSchema.nullable(),
      recipientUserIds: recipientUserIdsSchema,
      workspaceId,
      entity: z
        .object({ kind: z.literal(entityKind), id: uuidSchema })
        .strict(),
      data,
    })
    .strict();

const workflowNameData = z.object({ workflowName: displayNameSchema }).strict();
const executionData = z
  .object({ workflowName: displayNameSchema, workflowId: uuidSchema })
  .strict();
// W6-A monitoring alerts: counts travel as digit strings (the Workflow outbox data map is string-valued).
const countString = z.string().regex(/^[0-9]{1,9}$/);
const alertBaseData = {
  ruleName: displayNameSchema,
  workflowName: displayNameSchema,
  workflowId: uuidSchema,
};
const consecutiveFailuresData = z
  .object({ ...alertBaseData, failureCount: countString })
  .strict();
const longRunningData = z
  .object({
    ...alertBaseData,
    durationSeconds: countString,
    thresholdSeconds: countString,
  })
  .strict();
const workspaceNameData = z
  .object({ workspaceName: displayNameSchema })
  .strict();
const memberData = z
  .object({ workspaceName: displayNameSchema, subjectUserId: uuidSchema })
  .strict();
const connectionNameData = z
  .object({ connectionName: displayNameSchema })
  .strict();
const identityData = z.object({}).strict();

const eventVariants = [
  eventSchema(
    'workflow.created',
    'workflow-service',
    'WORKFLOW',
    uuidSchema,
    workflowNameData,
  ),
  eventSchema(
    'workflow.published',
    'workflow-service',
    'WORKFLOW',
    uuidSchema,
    workflowNameData,
  ),
  eventSchema(
    'workflow.paused',
    'workflow-service',
    'WORKFLOW',
    uuidSchema,
    workflowNameData,
  ),
  eventSchema(
    'workflow.resumed',
    'workflow-service',
    'WORKFLOW',
    uuidSchema,
    workflowNameData,
  ),
  eventSchema(
    'workflow.completed',
    'workflow-service',
    'EXECUTION',
    uuidSchema,
    executionData,
  ),
  eventSchema(
    'workflow.failed',
    'workflow-service',
    'EXECUTION',
    uuidSchema,
    executionData,
  ),
  eventSchema(
    'monitoring.alert.consecutive_failures',
    'workflow-service',
    'EXECUTION',
    uuidSchema,
    consecutiveFailuresData,
  ),
  eventSchema(
    'monitoring.alert.long_running',
    'workflow-service',
    'EXECUTION',
    uuidSchema,
    longRunningData,
  ),
  eventSchema(
    'workspace.created',
    'workspace-service',
    'WORKSPACE',
    uuidSchema,
    workspaceNameData,
  ),
  eventSchema(
    'workspace.renamed',
    'workspace-service',
    'WORKSPACE',
    uuidSchema,
    workspaceNameData,
  ),
  eventSchema(
    'workspace.member_added',
    'workspace-service',
    'WORKSPACE',
    uuidSchema,
    memberData,
  ),
  eventSchema(
    'workspace.member_removed',
    'workspace-service',
    'WORKSPACE',
    uuidSchema,
    memberData,
  ),
  eventSchema(
    'workspace.member_permissions_updated',
    'workspace-service',
    'WORKSPACE',
    uuidSchema,
    memberData,
  ),
  eventSchema(
    'workspace.member_left',
    'workspace-service',
    'WORKSPACE',
    uuidSchema,
    memberData,
  ),
  eventSchema(
    'connection.connected',
    'workspace-service',
    'CONNECTION',
    uuidSchema,
    connectionNameData,
  ),
  eventSchema(
    'connection.disabled',
    'workspace-service',
    'CONNECTION',
    uuidSchema,
    connectionNameData,
  ),
  eventSchema(
    'connection.invalid',
    'workspace-service',
    'CONNECTION',
    uuidSchema,
    connectionNameData,
  ),
  eventSchema(
    'identity.password_changed',
    'identity-service',
    'USER',
    z.null(),
    identityData,
  ),
  eventSchema(
    'identity.password_reset',
    'identity-service',
    'USER',
    z.null(),
    identityData,
  ),
  eventSchema(
    'identity.google_linked',
    'identity-service',
    'USER',
    z.null(),
    identityData,
  ),
  eventSchema(
    'identity.google_unlinked',
    'identity-service',
    'USER',
    z.null(),
    identityData,
  ),
] as const;

export const notificationEventTypes = Object.freeze(
  eventVariants.map((variant) => variant.shape.eventType.value),
);

const strictEventUnion = z.discriminatedUnion('eventType', eventVariants);

export const notificationEventV2Schema = strictEventUnion.superRefine(
  (event, context) => {
    if (
      event.entity.kind === 'WORKSPACE' &&
      (event.workspaceId === null ||
        event.entity.id.toLowerCase() !== event.workspaceId.toLowerCase())
    ) {
      context.addIssue({
        code: 'custom',
        path: ['entity', 'id'],
        message: 'Workspace entity ID must match workspaceId',
      });
    }

    switch (event.eventType) {
      case 'workspace.member_added':
      case 'workspace.member_removed':
      case 'workspace.member_permissions_updated':
        if (
          event.recipientUserIds.length !== 1 ||
          event.recipientUserIds[0].toLowerCase() !==
            event.data.subjectUserId.toLowerCase()
        ) {
          context.addIssue({
            code: 'custom',
            path: ['recipientUserIds'],
            message: 'Membership events must target exactly the subject user',
          });
        }
        break;
      case 'identity.password_changed':
      case 'identity.password_reset':
      case 'identity.google_linked':
      case 'identity.google_unlinked':
        if (
          event.recipientUserIds.length !== 1 ||
          event.recipientUserIds[0].toLowerCase() !==
            event.entity.id.toLowerCase()
        ) {
          context.addIssue({
            code: 'custom',
            path: ['recipientUserIds'],
            message: 'Identity events must target exactly the subject user',
          });
        }
        if (
          event.actorUserId !== null &&
          event.actorUserId.toLowerCase() !== event.entity.id.toLowerCase()
        ) {
          context.addIssue({
            code: 'custom',
            path: ['actorUserId'],
            message: 'Identity event actor must be the subject user or null',
          });
        }
        break;
    }
  },
);

export type NotificationEventV2 = z.infer<typeof notificationEventV2Schema>;
