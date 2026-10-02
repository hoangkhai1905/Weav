import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ids = {
  event: '00000000-0000-4000-8000-000000000001',
  actor: '00000000-0000-4000-8000-000000000002',
  workspace: '00000000-0000-4000-8000-000000000003',
  recipient: '00000000-0000-4000-8000-000000000004',
  workflow: '00000000-0000-4000-8000-000000000005',
  execution: '00000000-0000-4000-8000-000000000006',
  connection: '00000000-0000-4000-8000-000000000007',
};

type EventCase = {
  eventType: string;
  producer: string;
  entityKind: string;
  workspaceRequired: boolean;
  data: Record<string, unknown>;
};

const eventCases: EventCase[] = [
  {
    eventType: 'workflow.created',
    producer: 'workflow-service',
    entityKind: 'WORKFLOW',
    workspaceRequired: true,
    data: { workflowName: 'Daily report' },
  },
  {
    eventType: 'workflow.published',
    producer: 'workflow-service',
    entityKind: 'WORKFLOW',
    workspaceRequired: true,
    data: { workflowName: 'Daily report' },
  },
  {
    eventType: 'workflow.paused',
    producer: 'workflow-service',
    entityKind: 'WORKFLOW',
    workspaceRequired: true,
    data: { workflowName: 'Daily report' },
  },
  {
    eventType: 'workflow.resumed',
    producer: 'workflow-service',
    entityKind: 'WORKFLOW',
    workspaceRequired: true,
    data: { workflowName: 'Daily report' },
  },
  {
    eventType: 'workflow.completed',
    producer: 'workflow-service',
    entityKind: 'EXECUTION',
    workspaceRequired: true,
    data: { workflowName: 'Daily report', workflowId: ids.workflow },
  },
  {
    eventType: 'workflow.failed',
    producer: 'workflow-service',
    entityKind: 'EXECUTION',
    workspaceRequired: true,
    data: { workflowName: 'Daily report', workflowId: ids.workflow },
  },
  {
    eventType: 'workspace.created',
    producer: 'workspace-service',
    entityKind: 'WORKSPACE',
    workspaceRequired: true,
    data: { workspaceName: 'Đội vận hành' },
  },
  {
    eventType: 'workspace.renamed',
    producer: 'workspace-service',
    entityKind: 'WORKSPACE',
    workspaceRequired: true,
    data: { workspaceName: 'Đội vận hành' },
  },
  {
    eventType: 'workspace.member_added',
    producer: 'workspace-service',
    entityKind: 'WORKSPACE',
    workspaceRequired: true,
    data: { workspaceName: 'Đội vận hành', subjectUserId: ids.recipient },
  },
  {
    eventType: 'workspace.member_removed',
    producer: 'workspace-service',
    entityKind: 'WORKSPACE',
    workspaceRequired: true,
    data: { workspaceName: 'Đội vận hành', subjectUserId: ids.recipient },
  },
  {
    eventType: 'workspace.member_permissions_updated',
    producer: 'workspace-service',
    entityKind: 'WORKSPACE',
    workspaceRequired: true,
    data: { workspaceName: 'Đội vận hành', subjectUserId: ids.recipient },
  },
  {
    eventType: 'workspace.member_left',
    producer: 'workspace-service',
    entityKind: 'WORKSPACE',
    workspaceRequired: true,
    data: { workspaceName: 'Đội vận hành', subjectUserId: ids.actor },
  },
  {
    eventType: 'connection.connected',
    producer: 'workspace-service',
    entityKind: 'CONNECTION',
    workspaceRequired: true,
    data: { connectionName: 'Google Drive' },
  },
  {
    eventType: 'connection.disabled',
    producer: 'workspace-service',
    entityKind: 'CONNECTION',
    workspaceRequired: true,
    data: { connectionName: 'Google Drive' },
  },
  {
    eventType: 'connection.invalid',
    producer: 'workspace-service',
    entityKind: 'CONNECTION',
    workspaceRequired: true,
    data: { connectionName: 'Google Drive' },
  },
  {
    eventType: 'identity.password_changed',
    producer: 'identity-service',
    entityKind: 'USER',
    workspaceRequired: false,
    data: {},
  },
  {
    eventType: 'identity.password_reset',
    producer: 'identity-service',
    entityKind: 'USER',
    workspaceRequired: false,
    data: {},
  },
  {
    eventType: 'identity.google_linked',
    producer: 'identity-service',
    entityKind: 'USER',
    workspaceRequired: false,
    data: {},
  },
  {
    eventType: 'identity.google_unlinked',
    producer: 'identity-service',
    entityKind: 'USER',
    workspaceRequired: false,
    data: {},
  },
];

function eventOf(eventType: string, overrides: Record<string, unknown> = {}) {
  const spec = eventCases.find(
    (candidate) => candidate.eventType === eventType,
  );
  if (!spec) throw new Error('Unknown test fixture: ' + eventType);

  const entityIds: Record<string, string> = {
    WORKFLOW: ids.workflow,
    EXECUTION: ids.execution,
    WORKSPACE: ids.workspace,
    CONNECTION: ids.connection,
    USER: ids.recipient,
  };
  const entityId = entityIds[spec.entityKind];
  const subjectUserId = spec.data.subjectUserId;
  const recipientUserId =
    eventType === 'workspace.member_left'
      ? ids.recipient
      : typeof subjectUserId === 'string'
        ? subjectUserId
        : ids.recipient;

  return {
    schemaVersion: 2,
    eventId: ids.event,
    eventType,
    occurredAt: '1999-12-31T23:59:59Z',
    producer: spec.producer,
    actorUserId: spec.entityKind === 'USER' ? ids.recipient : ids.actor,
    recipientUserIds: [recipientUserId],
    workspaceId: spec.workspaceRequired ? ids.workspace : null,
    entity: { kind: spec.entityKind, id: entityId },
    data: { ...spec.data },
    ...overrides,
  };
}

function schema() {
  return (
    require('./notification-event') as {
      notificationEventV2Schema: {
        safeParse(value: unknown): { success: boolean };
      };
    }
  ).notificationEventV2Schema;
}

function rejects(value: unknown) {
  expect(schema().safeParse(value).success).toBe(false);
}

describe('notification event v2 schema', () => {
  it('exports the v2 event schema', () => {
    expect(() => require('./notification-event')).not.toThrow();
  });

  it('accepts all 19 allowlisted event envelopes, including delayed delivery timestamps', () => {
    for (const spec of eventCases) {
      expect(schema().safeParse(eventOf(spec.eventType)).success).toBe(true);
    }
  });

  it('accepts timezone offsets and identity recovery events without an actor', () => {
    expect(
      schema().safeParse(
        eventOf('workflow.created', {
          occurredAt: '2026-09-26T11:00:00+07:00',
        }),
      ).success,
    ).toBe(true);
    expect(
      schema().safeParse(
        eventOf('identity.password_reset', { actorUserId: null }),
      ).success,
    ).toBe(true);
  });

  it('compares UUID identities case-insensitively after UUID validation', () => {
    const workspaceId = 'ab000000-0000-4000-8000-000000000003';
    const memberUserId = 'bc000000-0000-4000-8000-000000000004';
    expect(
      schema().safeParse(
        eventOf('workspace.created', {
          workspaceId: workspaceId.toUpperCase(),
          entity: { kind: 'WORKSPACE', id: workspaceId },
        }),
      ).success,
    ).toBe(true);
    expect(
      schema().safeParse(
        eventOf('workspace.member_added', {
          recipientUserIds: [memberUserId.toUpperCase()],
          data: { workspaceName: 'Đội vận hành', subjectUserId: memberUserId },
        }),
      ).success,
    ).toBe(true);
    expect(
      schema().safeParse(
        eventOf('identity.password_changed', {
          entity: { kind: 'USER', id: memberUserId.toUpperCase() },
          actorUserId: memberUserId,
          recipientUserIds: [memberUserId],
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects unknown and routine update event types', () => {
    for (const eventType of [
      'workflow.updated',
      'profile.updated',
      'avatar.updated',
      'connection.updated',
      'workflow.unknown',
    ]) {
      rejects(eventOf('workflow.created', { eventType }));
    }
  });

  it('rejects a producer or entity kind that does not match the event family', () => {
    rejects(eventOf('workflow.created', { producer: 'workspace-service' }));
    rejects(
      eventOf('workflow.created', {
        entity: { kind: 'WORKSPACE', id: ids.workspace },
      }),
    );
    rejects(
      eventOf('identity.password_changed', {
        entity: { kind: 'CONNECTION', id: ids.connection },
      }),
    );
  });

  it('rejects unknown envelope, entity, and event-data fields', () => {
    rejects(eventOf('workflow.created', { debug: true }));
    rejects(
      eventOf('workflow.created', {
        entity: { kind: 'WORKFLOW', id: ids.workflow, url: '/unsafe' },
      }),
    );
    rejects(
      eventOf('workflow.created', {
        data: { workflowName: 'Daily report', message: 'untrusted' },
      }),
    );
    rejects(
      eventOf('identity.password_changed', { data: { token: 'secret' } }),
    );
  });

  it('rejects arbitrary content, URLs, errors, credentials, and tokens at every object level', () => {
    const forbidden = [
      'title',
      'message',
      'url',
      'error',
      'token',
      'credential',
    ];
    for (const key of forbidden) {
      rejects(eventOf('workflow.created', { [key]: 'untrusted' }));
      rejects(
        eventOf('workflow.created', {
          entity: { kind: 'WORKFLOW', id: ids.workflow, [key]: 'untrusted' },
        }),
      );
      rejects(
        eventOf('workflow.created', {
          data: { workflowName: 'Daily report', [key]: 'untrusted' },
        }),
      );
    }
  });

  it('requires every envelope field and each event-specific data field', () => {
    for (const field of [
      'schemaVersion',
      'eventId',
      'eventType',
      'occurredAt',
      'producer',
      'actorUserId',
      'recipientUserIds',
      'workspaceId',
      'entity',
      'data',
    ]) {
      const value = eventOf('workflow.created');
      delete (value as Record<string, unknown>)[field];
      rejects(value);
    }
    rejects(eventOf('workflow.created', { data: {} }));
    rejects(
      eventOf('workflow.completed', { data: { workflowName: 'Daily report' } }),
    );
  });

  it('validates UUIDs in envelope, entity, recipients, and event-specific data', () => {
    rejects(eventOf('workflow.created', { eventId: 'not-a-uuid' }));
    rejects(eventOf('workflow.created', { actorUserId: 'not-a-uuid' }));
    rejects(eventOf('workflow.created', { recipientUserIds: ['not-a-uuid'] }));
    rejects(
      eventOf('workflow.created', {
        entity: { kind: 'WORKFLOW', id: 'not-a-uuid' },
      }),
    );
    rejects(eventOf('workflow.created', { workspaceId: 'not-a-uuid' }));
    rejects(
      eventOf('workflow.completed', {
        data: { workflowName: 'Daily report', workflowId: 'not-a-uuid' },
      }),
    );
    rejects(
      eventOf('workspace.member_added', {
        data: { workspaceName: 'Đội vận hành', subjectUserId: 'not-a-uuid' },
      }),
    );
  });

  it('requires an ISO datetime with a timezone but does not reject old events', () => {
    expect(schema().safeParse(eventOf('workflow.created')).success).toBe(true);
    rejects(eventOf('workflow.created', { occurredAt: '2026-09-26T11:00:00' }));
    rejects(eventOf('workflow.created', { occurredAt: 'yesterday' }));
  });

  it('requires a workspace UUID for workspace, connection, and workflow events and null for identity', () => {
    rejects(eventOf('workflow.created', { workspaceId: null }));
    rejects(eventOf('connection.connected', { workspaceId: null }));
    rejects(
      eventOf('identity.password_changed', { workspaceId: ids.workspace }),
    );
    expect(schema().safeParse(eventOf('identity.google_linked')).success).toBe(
      true,
    );
  });

  it('rejects empty, oversized, and duplicate recipient lists', () => {
    rejects(eventOf('workflow.created', { recipientUserIds: [] }));
    const manyRecipients = Array.from(
      { length: 101 },
      (_, index) =>
        '00000000-0000-4000-8000-' + String(index).padStart(12, '0'),
    );
    rejects(eventOf('workflow.created', { recipientUserIds: manyRecipients }));
    rejects(
      eventOf('workflow.created', {
        recipientUserIds: [ids.recipient, ids.recipient],
      }),
    );
  });

  it('requires workspace entity IDs to equal workspaceId', () => {
    rejects(
      eventOf('workspace.created', {
        entity: { kind: 'WORKSPACE', id: ids.connection },
      }),
    );
  });

  it('requires membership events to target exactly their subject user', () => {
    rejects(
      eventOf('workspace.member_added', { recipientUserIds: [ids.actor] }),
    );
    rejects(
      eventOf('workspace.member_removed', { recipientUserIds: [ids.actor] }),
    );
    rejects(
      eventOf('workspace.member_permissions_updated', {
        recipientUserIds: [ids.actor],
      }),
    );
  });

  it('accepts member_left when the departing member differs from the Owner recipient', () => {
    const event = eventOf('workspace.member_left');
    expect(event.actorUserId).toBe(ids.actor);
    expect(event.data).toEqual({
      workspaceName: 'Đội vận hành',
      subjectUserId: ids.actor,
    });
    expect(event.recipientUserIds).toEqual([ids.recipient]);
    expect(schema().safeParse(event).success).toBe(true);
  });

  it('requires identity events to target their user and forbids a different non-null actor', () => {
    rejects(
      eventOf('identity.password_changed', { recipientUserIds: [ids.actor] }),
    );
    rejects(eventOf('identity.google_linked', { actorUserId: ids.actor }));
  });

  it('rejects whitespace-only and overlong names without rewriting accepted text', () => {
    for (const [eventType, field] of [
      ['workflow.created', 'workflowName'],
      ['workspace.created', 'workspaceName'],
      ['connection.connected', 'connectionName'],
    ]) {
      rejects(eventOf(eventType, { data: { [field]: ' \t\n' } }));
      rejects(eventOf(eventType, { data: { [field]: 'x'.repeat(201) } }));
    }
    const name = ' Research & Development <ops> ';
    expect(
      schema().safeParse(
        eventOf('workflow.created', { data: { workflowName: name } }),
      ).success,
    ).toBe(true);
  });

  it('matches the JSON Schema draft and all 19 event branches to the Zod fixture matrix', () => {
    const schemaDocument = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../../packages/contracts/events/notification/event-v2.schema.json',
        ),
        'utf8',
      ),
    ) as Record<string, any>;
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../../packages/contracts/events/notification/examples/workspace-created.json',
        ),
        'utf8',
      ),
    );
    expect(schemaDocument.$schema).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    );
    expect(schemaDocument.type).toBe('object');
    expect(schemaDocument.additionalProperties).toBe(false);
    expect(schemaDocument.required).toEqual([
      'schemaVersion',
      'eventId',
      'eventType',
      'occurredAt',
      'producer',
      'actorUserId',
      'recipientUserIds',
      'workspaceId',
      'entity',
      'data',
    ]);
    expect(schemaDocument.properties.schemaVersion.const).toBe(2);
    expect(schemaDocument.properties.eventType.enum).toEqual(
      eventCases.map((spec) => spec.eventType),
    );
    expect(schemaDocument.properties.eventId.format).toBe('uuid');
    expect(schemaDocument.properties.actorUserId.oneOf).toHaveLength(2);
    expect(schemaDocument.properties.occurredAt.format).toBe('date-time');
    expect(schemaDocument.properties.recipientUserIds).toMatchObject({
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { format: 'uuid' },
    });
    expect(schemaDocument.properties.entity.additionalProperties).toBe(false);

    const branches = schemaDocument.allOf.find((entry: any) =>
      Array.isArray(entry.oneOf),
    )?.oneOf as any[];
    expect(branches).toHaveLength(19);
    for (const spec of eventCases) {
      const branch = branches.find(
        (candidate) => candidate.properties.eventType.const === spec.eventType,
      );
      expect(branch).toBeDefined();
      expect(branch.properties.producer.const).toBe(spec.producer);
      expect(branch.properties.entity.properties.kind.const).toBe(
        spec.entityKind,
      );
      expect(branch.properties.data.additionalProperties).toBe(false);
      expect(Object.keys(branch.properties.data.properties).sort()).toEqual(
        Object.keys(spec.data).sort(),
      );
      expect(branch.properties.data.required.sort()).toEqual(
        Object.keys(spec.data).sort(),
      );
      expect(branch.properties.workspaceId).toEqual(
        spec.workspaceRequired
          ? { type: 'string', format: 'uuid' }
          : { type: 'null' },
      );
    }
    expect(fixture).toEqual({
      schemaVersion: 2,
      eventId: '00000000-0000-4000-8000-000000000001',
      eventType: 'workspace.created',
      occurredAt: '2026-09-26T04:00:00Z',
      producer: 'workspace-service',
      actorUserId: '00000000-0000-4000-8000-000000000002',
      recipientUserIds: ['00000000-0000-4000-8000-000000000002'],
      workspaceId: '00000000-0000-4000-8000-000000000003',
      entity: { kind: 'WORKSPACE', id: '00000000-0000-4000-8000-000000000003' },
      data: { workspaceName: 'Đội vận hành' },
    });
    expect(schema().safeParse(fixture).success).toBe(true);
  });

  it('keeps each name bound and non-whitespace constraint aligned in JSON Schema', () => {
    const schemaDocument = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../../packages/contracts/events/notification/event-v2.schema.json',
        ),
        'utf8',
      ),
    ) as any;
    const branches = schemaDocument.allOf.find((entry: any) =>
      Array.isArray(entry.oneOf),
    ).oneOf as any[];
    for (const eventType of [
      'workflow.created',
      'workspace.created',
      'connection.connected',
    ]) {
      const branch = branches.find(
        (candidate) => candidate.properties.eventType.const === eventType,
      );
      const nameProperty = Object.values(
        branch.properties.data.properties,
      )[0] as any;
      expect(nameProperty).toMatchObject({
        type: 'string',
        maxLength: 200,
        pattern: '\\S',
      });
    }
  });
});
