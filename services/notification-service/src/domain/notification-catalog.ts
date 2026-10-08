import type { NotificationEventV2 } from './notification-event';

export type NotificationLocale = 'vi' | 'en';
export type NotificationCategory =
  'WORKFLOW' | 'WORKSPACE' | 'CONNECTION' | 'SECURITY';
export type NotificationSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export type NotificationTarget =
  | { kind: 'WORKFLOW'; workspaceId: string; workflowId: string }
  | { kind: 'EXECUTION'; workspaceId: string; executionId: string }
  | { kind: 'WORKSPACE'; workspaceId: string }
  | { kind: 'CONNECTION'; workspaceId: string; connectionId: string }
  | { kind: 'SECURITY_SETTINGS' }
  | { kind: 'NONE' };

export interface NotificationContent {
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  target: NotificationTarget;
}

const localized = (
  locale: NotificationLocale,
  vi: string,
  en: string,
): string => (locale === 'vi' ? vi : en);

const content = (
  category: NotificationCategory,
  severity: NotificationSeverity,
  title: string,
  message: string,
  target: NotificationTarget,
): NotificationContent => ({ category, severity, title, message, target });

function unreachable(event: never): never {
  throw new Error('Unsupported notification event');
}

export function renderNotification(
  event: NotificationEventV2,
  locale: NotificationLocale = 'vi',
): NotificationContent {
  switch (event.eventType) {
    case 'workflow.created':
      return content(
        'WORKFLOW',
        'INFO',
        localized(locale, 'Đã tạo quy trình', 'Workflow created'),
        localized(
          locale,
          `Quy trình “${event.data.workflowName}” đã được tạo.`,
          `Workflow “${event.data.workflowName}” was created.`,
        ),
        {
          kind: 'WORKFLOW',
          workspaceId: event.workspaceId,
          workflowId: event.entity.id,
        },
      );
    case 'workflow.published':
      return content(
        'WORKFLOW',
        'INFO',
        localized(locale, 'Đã xuất bản quy trình', 'Workflow published'),
        localized(
          locale,
          `Quy trình “${event.data.workflowName}” đã được xuất bản.`,
          `Workflow “${event.data.workflowName}” was published.`,
        ),
        {
          kind: 'WORKFLOW',
          workspaceId: event.workspaceId,
          workflowId: event.entity.id,
        },
      );
    case 'workflow.paused':
      return content(
        'WORKFLOW',
        'INFO',
        localized(locale, 'Đã tạm dừng quy trình', 'Workflow paused'),
        localized(
          locale,
          `Quy trình “${event.data.workflowName}” đã được tạm dừng.`,
          `Workflow “${event.data.workflowName}” was paused.`,
        ),
        {
          kind: 'WORKFLOW',
          workspaceId: event.workspaceId,
          workflowId: event.entity.id,
        },
      );
    case 'workflow.resumed':
      return content(
        'WORKFLOW',
        'INFO',
        localized(locale, 'Đã tiếp tục quy trình', 'Workflow resumed'),
        localized(
          locale,
          `Quy trình “${event.data.workflowName}” đã được tiếp tục.`,
          `Workflow “${event.data.workflowName}” was resumed.`,
        ),
        {
          kind: 'WORKFLOW',
          workspaceId: event.workspaceId,
          workflowId: event.entity.id,
        },
      );
    case 'workflow.completed':
      return content(
        'WORKFLOW',
        'SUCCESS',
        localized(locale, 'Quy trình đã hoàn tất', 'Workflow run completed'),
        localized(
          locale,
          `Lần chạy quy trình “${event.data.workflowName}” đã hoàn tất thành công.`,
          `The run of workflow “${event.data.workflowName}” completed successfully.`,
        ),
        {
          kind: 'EXECUTION',
          workspaceId: event.workspaceId,
          executionId: event.entity.id,
        },
      );
    case 'workflow.failed':
      return content(
        'WORKFLOW',
        'ERROR',
        localized(locale, 'Quy trình chạy thất bại', 'Workflow run failed'),
        localized(
          locale,
          `Lần chạy quy trình “${event.data.workflowName}” thất bại. Mở chi tiết lần chạy để xem thêm.`,
          `The run of workflow “${event.data.workflowName}” failed. Open the execution details to learn more.`,
        ),
        {
          kind: 'EXECUTION',
          workspaceId: event.workspaceId,
          executionId: event.entity.id,
        },
      );
    case 'workspace.created':
      return content(
        'WORKSPACE',
        'SUCCESS',
        localized(locale, 'Đã tạo không gian làm việc', 'Workspace created'),
        localized(
          locale,
          `Không gian làm việc “${event.data.workspaceName}” đã được tạo.`,
          `Workspace “${event.data.workspaceName}” was created.`,
        ),
        { kind: 'WORKSPACE', workspaceId: event.workspaceId },
      );
    case 'workspace.renamed':
      return content(
        'WORKSPACE',
        'INFO',
        localized(
          locale,
          'Đã đổi tên không gian làm việc',
          'Workspace renamed',
        ),
        localized(
          locale,
          `Không gian làm việc đã được đổi tên thành “${event.data.workspaceName}”.`,
          `The workspace was renamed to “${event.data.workspaceName}”.`,
        ),
        { kind: 'WORKSPACE', workspaceId: event.workspaceId },
      );
    case 'workspace.member_added':
      return content(
        'WORKSPACE',
        'INFO',
        localized(
          locale,
          'Bạn đã được thêm vào không gian làm việc',
          'You were added to a workspace',
        ),
        localized(
          locale,
          `Bạn đã được thêm vào không gian làm việc “${event.data.workspaceName}”.`,
          `You were added to workspace “${event.data.workspaceName}”.`,
        ),
        { kind: 'WORKSPACE', workspaceId: event.workspaceId },
      );
    case 'workspace.member_removed':
      return content(
        'WORKSPACE',
        'WARNING',
        localized(
          locale,
          'Bạn đã bị xóa khỏi không gian làm việc',
          'Workspace access removed',
        ),
        localized(
          locale,
          `Bạn không còn là thành viên của không gian làm việc “${event.data.workspaceName}”.`,
          `You are no longer a member of workspace “${event.data.workspaceName}”.`,
        ),
        { kind: 'NONE' },
      );
    case 'workspace.member_permissions_updated':
      return content(
        'WORKSPACE',
        'INFO',
        localized(
          locale,
          'Quyền thành viên đã được cập nhật',
          'Workspace permissions updated',
        ),
        localized(
          locale,
          `Quyền truy cập của bạn trong không gian làm việc “${event.data.workspaceName}” đã được cập nhật.`,
          `Your access to workspace “${event.data.workspaceName}” was updated.`,
        ),
        { kind: 'WORKSPACE', workspaceId: event.workspaceId },
      );
    case 'workspace.member_left':
      return content(
        'WORKSPACE',
        'INFO',
        localized(
          locale,
          'Thành viên đã rời khỏi không gian làm việc',
          'A member left the workspace',
        ),
        localized(
          locale,
          `Một thành viên đã rời khỏi không gian làm việc “${event.data.workspaceName}”.`,
          `A member left workspace “${event.data.workspaceName}”.`,
        ),
        { kind: 'WORKSPACE', workspaceId: event.workspaceId },
      );
    case 'workspace.deleted':
      return content(
        'WORKSPACE',
        'WARNING',
        localized(locale, 'Không gian làm việc đã bị xóa', 'Workspace deleted'),
        localized(
          locale,
          `Không gian làm việc “${event.data.workspaceName}” đã bị chủ sở hữu xóa. Các quy trình của nó đã dừng.`,
          `Workspace “${event.data.workspaceName}” was deleted by its owner. Its workflows have been stopped.`,
        ),
        { kind: 'NONE' },
      );
    case 'connection.connected':
      return content(
        'CONNECTION',
        'SUCCESS',
        localized(locale, 'Đã kết nối dịch vụ', 'Connection confirmed'),
        localized(
          locale,
          `Kết nối “${event.data.connectionName}” đã được xác nhận.`,
          `Connection “${event.data.connectionName}” was confirmed.`,
        ),
        {
          kind: 'CONNECTION',
          workspaceId: event.workspaceId,
          connectionId: event.entity.id,
        },
      );
    case 'connection.disabled':
      return content(
        'CONNECTION',
        'WARNING',
        localized(locale, 'Đã tắt kết nối', 'Connection disabled'),
        localized(
          locale,
          `Kết nối “${event.data.connectionName}” đã bị tắt.`,
          `Connection “${event.data.connectionName}” was disabled.`,
        ),
        {
          kind: 'CONNECTION',
          workspaceId: event.workspaceId,
          connectionId: event.entity.id,
        },
      );
    case 'connection.invalid':
      return content(
        'CONNECTION',
        'ERROR',
        localized(locale, 'Cần kết nối lại', 'Reconnect required'),
        localized(
          locale,
          `Kết nối “${event.data.connectionName}” không hợp lệ. Hãy kết nối lại để tiếp tục.`,
          `Connection “${event.data.connectionName}” is invalid. Reconnect it to continue.`,
        ),
        {
          kind: 'CONNECTION',
          workspaceId: event.workspaceId,
          connectionId: event.entity.id,
        },
      );
    case 'identity.password_changed':
      return content(
        'SECURITY',
        'WARNING',
        localized(locale, 'Mật khẩu đã được thay đổi', 'Password changed'),
        localized(
          locale,
          'Mật khẩu tài khoản của bạn đã được thay đổi. Nếu bạn không thực hiện việc này, hãy kiểm tra bảo mật tài khoản.',
          "Your account password was changed. If you didn't do this, review your account security.",
        ),
        { kind: 'SECURITY_SETTINGS' },
      );
    case 'identity.password_reset':
      return content(
        'SECURITY',
        'WARNING',
        localized(locale, 'Mật khẩu đã được đặt lại', 'Password reset'),
        localized(
          locale,
          'Mật khẩu tài khoản của bạn đã được đặt lại. Nếu bạn không thực hiện việc này, hãy kiểm tra bảo mật tài khoản.',
          "Your account password was reset. If you didn't do this, review your account security.",
        ),
        { kind: 'SECURITY_SETTINGS' },
      );
    case 'identity.google_linked':
      return content(
        'SECURITY',
        'INFO',
        localized(locale, 'Đã liên kết Google', 'Google account linked'),
        localized(
          locale,
          'Tài khoản Google đã được liên kết với tài khoản của bạn.',
          'A Google account was linked to your account.',
        ),
        { kind: 'SECURITY_SETTINGS' },
      );
    case 'identity.google_unlinked':
      return content(
        'SECURITY',
        'WARNING',
        localized(locale, 'Đã hủy liên kết Google', 'Google account unlinked'),
        localized(
          locale,
          'Liên kết Google đã được gỡ khỏi tài khoản của bạn. Nếu bạn không thực hiện việc này, hãy kiểm tra bảo mật tài khoản.',
          "The Google account link was removed. If you didn't do this, review your account security.",
        ),
        { kind: 'SECURITY_SETTINGS' },
      );
    default:
      return unreachable(event);
  }
}
