const ids = {
  actor: '00000000-0000-4000-8000-000000000002',
  workspace: '00000000-0000-4000-8000-000000000003',
  recipient: '00000000-0000-4000-8000-000000000004',
  workflow: '00000000-0000-4000-8000-000000000005',
  execution: '00000000-0000-4000-8000-000000000006',
  connection: '00000000-0000-4000-8000-000000000007',
};

type CatalogCase = {
  eventType: string;
  category: string;
  severity: string;
  targetKind:
    | 'WORKFLOW'
    | 'EXECUTION'
    | 'WORKSPACE'
    | 'CONNECTION'
    | 'SECURITY_SETTINGS'
    | 'NONE';
};

const catalogCases: CatalogCase[] = [
  {
    eventType: 'workflow.created',
    category: 'WORKFLOW',
    severity: 'INFO',
    targetKind: 'WORKFLOW',
  },
  {
    eventType: 'workflow.published',
    category: 'WORKFLOW',
    severity: 'INFO',
    targetKind: 'WORKFLOW',
  },
  {
    eventType: 'workflow.paused',
    category: 'WORKFLOW',
    severity: 'INFO',
    targetKind: 'WORKFLOW',
  },
  {
    eventType: 'workflow.resumed',
    category: 'WORKFLOW',
    severity: 'INFO',
    targetKind: 'WORKFLOW',
  },
  {
    eventType: 'workflow.completed',
    category: 'WORKFLOW',
    severity: 'SUCCESS',
    targetKind: 'EXECUTION',
  },
  {
    eventType: 'workflow.failed',
    category: 'WORKFLOW',
    severity: 'ERROR',
    targetKind: 'EXECUTION',
  },
  {
    eventType: 'monitoring.alert.consecutive_failures',
    category: 'WORKFLOW',
    severity: 'ERROR',
    targetKind: 'EXECUTION',
  },
  {
    eventType: 'monitoring.alert.long_running',
    category: 'WORKFLOW',
    severity: 'WARNING',
    targetKind: 'EXECUTION',
  },
  {
    eventType: 'workspace.created',
    category: 'WORKSPACE',
    severity: 'SUCCESS',
    targetKind: 'WORKSPACE',
  },
  {
    eventType: 'workspace.renamed',
    category: 'WORKSPACE',
    severity: 'INFO',
    targetKind: 'WORKSPACE',
  },
  {
    eventType: 'workspace.member_added',
    category: 'WORKSPACE',
    severity: 'INFO',
    targetKind: 'WORKSPACE',
  },
  {
    eventType: 'workspace.member_removed',
    category: 'WORKSPACE',
    severity: 'WARNING',
    targetKind: 'NONE',
  },
  {
    eventType: 'workspace.member_permissions_updated',
    category: 'WORKSPACE',
    severity: 'INFO',
    targetKind: 'WORKSPACE',
  },
  {
    eventType: 'workspace.member_left',
    category: 'WORKSPACE',
    severity: 'INFO',
    targetKind: 'WORKSPACE',
  },
  {
    eventType: 'workspace.deleted',
    category: 'WORKSPACE',
    severity: 'WARNING',
    targetKind: 'NONE',
  },
  {
    eventType: 'connection.connected',
    category: 'CONNECTION',
    severity: 'SUCCESS',
    targetKind: 'CONNECTION',
  },
  {
    eventType: 'connection.disabled',
    category: 'CONNECTION',
    severity: 'WARNING',
    targetKind: 'CONNECTION',
  },
  {
    eventType: 'connection.invalid',
    category: 'CONNECTION',
    severity: 'ERROR',
    targetKind: 'CONNECTION',
  },
  {
    eventType: 'identity.password_changed',
    category: 'SECURITY',
    severity: 'WARNING',
    targetKind: 'SECURITY_SETTINGS',
  },
  {
    eventType: 'identity.password_reset',
    category: 'SECURITY',
    severity: 'WARNING',
    targetKind: 'SECURITY_SETTINGS',
  },
  {
    eventType: 'identity.google_linked',
    category: 'SECURITY',
    severity: 'INFO',
    targetKind: 'SECURITY_SETTINGS',
  },
  {
    eventType: 'identity.google_unlinked',
    category: 'SECURITY',
    severity: 'WARNING',
    targetKind: 'SECURITY_SETTINGS',
  },
];

function eventOf(eventType: string, overrides: Record<string, unknown> = {}) {
  const workspaceEvent = eventType.startsWith('workspace.');
  const identityEvent = eventType.startsWith('identity.');
  const alertEvent = eventType.startsWith('monitoring.alert.');
  const workflowExecution =
    eventType === 'workflow.completed' ||
    eventType === 'workflow.failed' ||
    alertEvent;
  const entityKind = identityEvent
    ? 'USER'
    : workflowExecution
      ? 'EXECUTION'
      : eventType.startsWith('workflow.')
        ? 'WORKFLOW'
        : eventType.startsWith('connection.')
          ? 'CONNECTION'
          : 'WORKSPACE';
  const entityId = identityEvent
    ? ids.recipient
    : workflowExecution
      ? ids.execution
      : entityKind === 'WORKFLOW'
        ? ids.workflow
        : entityKind === 'CONNECTION'
          ? ids.connection
          : ids.workspace;
  const data: Record<string, unknown> = alertEvent
    ? {
        ruleName: 'Lỗi liên tiếp',
        workflowName: 'Daily report',
        workflowId: ids.workflow,
        ...(eventType.endsWith('long_running')
          ? { durationSeconds: '125', thresholdSeconds: '60' }
          : { failureCount: '3' }),
      }
    : eventType.startsWith('workflow.')
      ? {
          workflowName: 'Daily report',
          ...(workflowExecution ? { workflowId: ids.workflow } : {}),
        }
      : workspaceEvent
        ? {
            workspaceName: 'Đội vận hành',
            ...(eventType.includes('member_')
              ? {
                  subjectUserId:
                    eventType === 'workspace.member_left'
                      ? ids.actor
                      : ids.recipient,
                }
              : {}),
          }
        : eventType.startsWith('connection.')
          ? { connectionName: 'Google Drive' }
          : {};

  return {
    schemaVersion: 2,
    eventId: '00000000-0000-4000-8000-000000000001',
    eventType,
    occurredAt: '2026-09-26T04:00:00Z',
    producer: identityEvent
      ? 'identity-service'
      : workspaceEvent || eventType.startsWith('connection.')
        ? 'workspace-service'
        : 'workflow-service',
    actorUserId: identityEvent ? ids.recipient : ids.actor,
    recipientUserIds: [ids.recipient],
    workspaceId: identityEvent ? null : ids.workspace,
    entity: { kind: entityKind, id: entityId },
    data,
    ...overrides,
  };
}

function render() {
  return (
    require('./notification-catalog') as {
      renderNotification: (
        event: unknown,
        locale?: string,
      ) => {
        category: string;
        severity: string;
        title: string;
        message: string;
        target: Record<string, unknown>;
      };
    }
  ).renderNotification;
}

function expectedTarget(targetKind: CatalogCase['targetKind']) {
  switch (targetKind) {
    case 'WORKFLOW':
      return {
        kind: 'WORKFLOW',
        workspaceId: ids.workspace,
        workflowId: ids.workflow,
      };
    case 'EXECUTION':
      return {
        kind: 'EXECUTION',
        workspaceId: ids.workspace,
        executionId: ids.execution,
      };
    case 'WORKSPACE':
      return { kind: 'WORKSPACE', workspaceId: ids.workspace };
    case 'CONNECTION':
      return {
        kind: 'CONNECTION',
        workspaceId: ids.workspace,
        connectionId: ids.connection,
      };
    case 'SECURITY_SETTINGS':
      return { kind: 'SECURITY_SETTINGS' };
    case 'NONE':
      return { kind: 'NONE' };
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
  }
  return value;
}

describe('notification catalog', () => {
  it('exports a pure notification renderer', () => {
    expect(() => require('./notification-catalog')).not.toThrow();
  });

  it('renders both locales with the specified metadata and target for all 22 event types', () => {
    for (const spec of catalogCases) {
      const event = eventOf(spec.eventType);
      for (const locale of ['vi', 'en']) {
        const content = render()(event, locale);
        expect(content.category).toBe(spec.category);
        expect(content.severity).toBe(spec.severity);
        expect(content.title.trim().length).toBeGreaterThan(0);
        expect(content.message.trim().length).toBeGreaterThan(0);
        expect(content.target).toEqual(expectedTarget(spec.targetKind));
        expect(content.title + content.message).not.toContain(ids.workspace);
        expect(content.title + content.message).not.toContain(ids.recipient);
      }
    }
  });

  it('distinguishes successful and failed workflow runs and links failures to execution details', () => {
    const completedVi = render()(eventOf('workflow.completed'), 'vi');
    const failedVi = render()(eventOf('workflow.failed'), 'vi');
    const completedEn = render()(eventOf('workflow.completed'), 'en');
    const failedEn = render()(eventOf('workflow.failed'), 'en');
    expect(completedVi.severity).toBe('SUCCESS');
    expect(completedVi.message).toContain('hoàn tất thành công');
    expect(failedVi.severity).toBe('ERROR');
    expect(failedVi.message).toContain('chi tiết lần chạy');
    expect(completedEn.message).toContain('completed successfully');
    expect(failedEn.message).toContain('execution details');
    expect(failedEn.message).not.toContain('raw failure');
  });

  it('words monitoring alerts with the rule, the workflow and the numbers, and links them to the run', () => {
    const failuresVi = render()(
      eventOf('monitoring.alert.consecutive_failures'),
      'vi',
    );
    const failuresEn = render()(
      eventOf('monitoring.alert.consecutive_failures'),
      'en',
    );
    const slowVi = render()(eventOf('monitoring.alert.long_running'), 'vi');
    const slowEn = render()(eventOf('monitoring.alert.long_running'), 'en');
    expect(failuresVi.message).toContain('“Lỗi liên tiếp”');
    expect(failuresVi.message).toContain('“Daily report”');
    expect(failuresVi.message).toContain('3 lần liên tiếp');
    expect(failuresEn.message).toContain('failed 3 times in a row');
    expect(slowVi.message).toContain('đã chạy hơn 2 phút 5 giây');
    expect(slowVi.message).toContain('ngưỡng 1 phút');
    expect(slowEn.message).toContain('has run for over 2 min 5 s');
    expect(slowEn.message).toContain('1 min limit');
    for (const content of [failuresVi, failuresEn, slowVi, slowEn]) {
      expect(content.target).toEqual({
        kind: 'EXECUTION',
        workspaceId: ids.workspace,
        executionId: ids.execution,
      });
    }
  });

  it('removes the workspace target after membership removal', () => {
    const removed = render()(eventOf('workspace.member_removed'), 'en');
    expect(removed.target).toEqual({ kind: 'NONE' });
    expect(removed.message).toContain('no longer a member');
  });

  it('keeps member_left addressed to the Owner with its existing bilingual copy', () => {
    const vi = render()(eventOf('workspace.member_left'), 'vi');
    const en = render()(eventOf('workspace.member_left'), 'en');
    expect(vi.target).toEqual({
      kind: 'WORKSPACE',
      workspaceId: ids.workspace,
    });
    expect(en.target).toEqual({
      kind: 'WORKSPACE',
      workspaceId: ids.workspace,
    });
    expect(vi.title).toBe('Thành viên đã rời khỏi không gian làm việc');
    expect(vi.message).toBe(
      'Một thành viên đã rời khỏi không gian làm việc “Đội vận hành”.',
    );
    expect(en.title).toBe('A member left the workspace');
    expect(en.message).toBe('A member left workspace “Đội vận hành”.');
  });

  it('asks users to reconnect invalid connections without claiming token expiry', () => {
    const vi = render()(eventOf('connection.invalid'), 'vi');
    const en = render()(eventOf('connection.invalid'), 'en');
    expect(vi.message).toContain('kết nối lại');
    expect(en.message).toContain('Reconnect');
    expect((vi.message + en.message).toLowerCase()).not.toMatch(
      /hết hạn|expired/,
    );
  });

  it('advises account security after password changes and resets', () => {
    for (const eventType of [
      'identity.password_changed',
      'identity.password_reset',
    ]) {
      const vi = render()(eventOf(eventType), 'vi');
      const en = render()(eventOf(eventType), 'en');
      expect(vi.message).toContain('Nếu bạn không thực hiện');
      expect(en.message).toContain("If you didn't do this");
    }
  });

  it('uses the Vietnamese locale by default', () => {
    const event = eventOf('workflow.created');
    expect(render()(event)).toEqual(render()(event, 'vi'));
  });

  it('returns deterministic plain-text content without mutating its input', () => {
    const event = deepFreeze(eventOf('workflow.created'));
    const before = JSON.stringify(event);
    const first = render()(event, 'en');
    const second = render()(event, 'en');
    expect(second).toEqual(first);
    expect(JSON.stringify(event)).toBe(before);
    expect(Object.keys(first).sort()).toEqual([
      'category',
      'message',
      'severity',
      'target',
      'title',
    ]);
    expect(Object.keys(first.target)).not.toContain('url');
    expect(first.title + first.message).not.toMatch(/https?:\/\//i);
  });

  it('interpolates user names as unchanged text and does not construct markup', () => {
    const workflowName = 'R&D <b>West</b> "Ops"';
    const event = eventOf('workflow.created', { data: { workflowName } });
    const content = render()(event, 'en');
    expect(content.message).toBe(
      'Workflow “' + workflowName + '” was created.',
    );
  });

  it('does not put IDs, credentials, tokens, or provider errors into identity copy', () => {
    for (const eventType of [
      'identity.password_changed',
      'identity.password_reset',
      'identity.google_linked',
      'identity.google_unlinked',
    ]) {
      const content = render()(eventOf(eventType), 'en');
      const copy = content.title + ' ' + content.message;
      expect(copy).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      expect(copy.toLowerCase()).not.toMatch(
        /bearer|access token|credential|provider error|otp/,
      );
    }
  });
});
