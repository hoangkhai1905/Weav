# Notification event v2 contract

`event-v2.schema.json` defines the language-neutral JSON Schema (Draft 2020-12). `examples/workspace-created.json` is a valid envelope example. The Notification service's `notificationEventV2Schema` applies the same structural allowlist and the semantic checks listed below.

## Envelope and validation

Every event has exactly these fields: `schemaVersion`, `eventId`, `eventType`, `occurredAt`, `producer`, `actorUserId`, `recipientUserIds`, `workspaceId`, `entity`, and `data`. Unknown fields are rejected at the envelope, entity, and event-data levels.

- `schemaVersion` is `2`. Event, entity, user, and non-null workspace IDs are UUIDs.
- `occurredAt` is an ISO date-time with a timezone. Delayed delivery does not make an old event invalid.
- `actorUserId` is required and is either a UUID or `null` for a background or recovery action.
- `recipientUserIds` contains 1–100 unique UUIDs.
- Workflow, workspace, and connection events require a UUID `workspaceId`; identity events require `workspaceId: null`.
- Names are raw text with at least one non-whitespace character and at most 200 characters. They are not trimmed or otherwise transformed.
- Membership event data identifies the subject with `subjectUserId`; templates never look up or print a user's name or ID.
- Event data is allowlisted. Publishers cannot supply titles, messages, URLs, raw errors, credentials, tokens, OTPs, execution payloads, or extra keys.

The application additionally enforces cross-field equality rules: a `WORKSPACE` entity ID equals `workspaceId`; identity recipients are exactly `[entity.id]`, and a non-null identity actor equals `entity.id`; `workspace.member_added`, `workspace.member_removed`, and `workspace.member_permissions_updated` recipients are exactly `[data.subjectUserId]`. JSON Schema cannot express these instance-to-instance equality rules in the standard dialect used here.

For `workspace.member_left`, Workspace resolves the current Owner as the recipient. The Owner recipient is intentionally not constrained to equal `data.subjectUserId`, which identifies the departing member.

The `producer` field is an event-family assertion, not publisher authentication. Broker credentials, permissions, and routing-key checks must establish which internal service actually published a message.

## Event catalog

| `eventType`                            | Producer            | `entity.kind` | Exact `data` keys                | Category / severity  | Target            |
| -------------------------------------- | ------------------- | ------------- | -------------------------------- | -------------------- | ----------------- |
| `workflow.created`                     | `workflow-service`  | `WORKFLOW`    | `workflowName`                   | WORKFLOW / INFO      | workflow          |
| `workflow.published`                   | `workflow-service`  | `WORKFLOW`    | `workflowName`                   | WORKFLOW / INFO      | workflow          |
| `workflow.paused`                      | `workflow-service`  | `WORKFLOW`    | `workflowName`                   | WORKFLOW / INFO      | workflow          |
| `workflow.resumed`                     | `workflow-service`  | `WORKFLOW`    | `workflowName`                   | WORKFLOW / INFO      | workflow          |
| `workflow.completed`                   | `workflow-service`  | `EXECUTION`   | `workflowName`, `workflowId`     | WORKFLOW / SUCCESS   | execution         |
| `workflow.failed`                      | `workflow-service`  | `EXECUTION`   | `workflowName`, `workflowId`     | WORKFLOW / ERROR     | execution         |
| `workspace.created`                    | `workspace-service` | `WORKSPACE`   | `workspaceName`                  | WORKSPACE / SUCCESS  | workspace         |
| `workspace.renamed`                    | `workspace-service` | `WORKSPACE`   | `workspaceName`                  | WORKSPACE / INFO     | workspace         |
| `workspace.member_added`               | `workspace-service` | `WORKSPACE`   | `workspaceName`, `subjectUserId` | WORKSPACE / INFO     | workspace         |
| `workspace.member_removed`             | `workspace-service` | `WORKSPACE`   | `workspaceName`, `subjectUserId` | WORKSPACE / WARNING  | none              |
| `workspace.member_permissions_updated` | `workspace-service` | `WORKSPACE`   | `workspaceName`, `subjectUserId` | WORKSPACE / INFO     | workspace         |
| `workspace.member_left`                | `workspace-service` | `WORKSPACE`   | `workspaceName`, `subjectUserId` | WORKSPACE / INFO     | workspace         |
| `connection.connected`                 | `workspace-service` | `CONNECTION`  | `connectionName`                 | CONNECTION / SUCCESS | connection        |
| `connection.disabled`                  | `workspace-service` | `CONNECTION`  | `connectionName`                 | CONNECTION / WARNING | connection        |
| `connection.invalid`                   | `workspace-service` | `CONNECTION`  | `connectionName`                 | CONNECTION / ERROR   | connection        |
| `identity.password_changed`            | `identity-service`  | `USER`        | none (`{}`)                      | SECURITY / WARNING   | security settings |
| `identity.password_reset`              | `identity-service`  | `USER`        | none (`{}`)                      | SECURITY / WARNING   | security settings |
| `identity.google_linked`               | `identity-service`  | `USER`        | none (`{}`)                      | SECURITY / INFO      | security settings |
| `identity.google_unlinked`             | `identity-service`  | `USER`        | none (`{}`)                      | SECURITY / WARNING   | security settings |

For workflow targets, `workflowId` is `entity.id`; for execution targets, `executionId` is `entity.id` and `workflowId` is in data. Workspace and connection targets use their corresponding entity ID and `workspaceId`. Identity targets contain no IDs.

## User-facing copy

Names in braces are inserted unchanged as plain text. Consumers must render title and message as text; they must not interpret names as HTML or markup. Targets are typed descriptors, never URLs.

| Event                                  | Vietnamese title                           | Vietnamese message                                                                                                   | English title                 | English message                                                                           |
| -------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `workflow.created`                     | Đã tạo quy trình                           | Quy trình “{workflowName}” đã được tạo.                                                                              | Workflow created              | Workflow “{workflowName}” was created.                                                    |
| `workflow.published`                   | Đã xuất bản quy trình                      | Quy trình “{workflowName}” đã được xuất bản.                                                                         | Workflow published            | Workflow “{workflowName}” was published.                                                  |
| `workflow.paused`                      | Đã tạm dừng quy trình                      | Quy trình “{workflowName}” đã được tạm dừng.                                                                         | Workflow paused               | Workflow “{workflowName}” was paused.                                                     |
| `workflow.resumed`                     | Đã tiếp tục quy trình                      | Quy trình “{workflowName}” đã được tiếp tục.                                                                         | Workflow resumed              | Workflow “{workflowName}” was resumed.                                                    |
| `workflow.completed`                   | Quy trình đã hoàn tất                      | Lần chạy quy trình “{workflowName}” đã hoàn tất thành công.                                                          | Workflow run completed        | The run of workflow “{workflowName}” completed successfully.                              |
| `workflow.failed`                      | Quy trình chạy thất bại                    | Lần chạy quy trình “{workflowName}” thất bại. Mở chi tiết lần chạy để xem thêm.                                      | Workflow run failed           | The run of workflow “{workflowName}” failed. Open the execution details to learn more.    |
| `workspace.created`                    | Đã tạo không gian làm việc                 | Không gian làm việc “{workspaceName}” đã được tạo.                                                                   | Workspace created             | Workspace “{workspaceName}” was created.                                                  |
| `workspace.renamed`                    | Đã đổi tên không gian làm việc             | Không gian làm việc đã được đổi tên thành “{workspaceName}”.                                                         | Workspace renamed             | The workspace was renamed to “{workspaceName}”.                                           |
| `workspace.member_added`               | Bạn đã được thêm vào không gian làm việc   | Bạn đã được thêm vào không gian làm việc “{workspaceName}”.                                                          | You were added to a workspace | You were added to workspace “{workspaceName}”.                                            |
| `workspace.member_removed`             | Bạn đã bị xóa khỏi không gian làm việc     | Bạn không còn là thành viên của không gian làm việc “{workspaceName}”.                                               | Workspace access removed      | You are no longer a member of workspace “{workspaceName}”.                                |
| `workspace.member_permissions_updated` | Quyền thành viên đã được cập nhật          | Quyền truy cập của bạn trong không gian làm việc “{workspaceName}” đã được cập nhật.                                 | Workspace permissions updated | Your access to workspace “{workspaceName}” was updated.                                   |
| `workspace.member_left`                | Thành viên đã rời khỏi không gian làm việc | Một thành viên đã rời khỏi không gian làm việc “{workspaceName}”.                                                    | A member left the workspace   | A member left workspace “{workspaceName}”.                                                |
| `connection.connected`                 | Đã kết nối dịch vụ                         | Kết nối “{connectionName}” đã được xác nhận.                                                                         | Connection confirmed          | Connection “{connectionName}” was confirmed.                                              |
| `connection.disabled`                  | Đã tắt kết nối                             | Kết nối “{connectionName}” đã bị tắt.                                                                                | Connection disabled           | Connection “{connectionName}” was disabled.                                               |
| `connection.invalid`                   | Cần kết nối lại                            | Kết nối “{connectionName}” không hợp lệ. Hãy kết nối lại để tiếp tục.                                                | Reconnect required            | Connection “{connectionName}” is invalid. Reconnect it to continue.                       |
| `identity.password_changed`            | Mật khẩu đã được thay đổi                  | Mật khẩu tài khoản của bạn đã được thay đổi. Nếu bạn không thực hiện việc này, hãy kiểm tra bảo mật tài khoản.       | Password changed              | Your account password was changed. If you didn't do this, review your account security.   |
| `identity.password_reset`              | Mật khẩu đã được đặt lại                   | Mật khẩu tài khoản của bạn đã được đặt lại. Nếu bạn không thực hiện việc này, hãy kiểm tra bảo mật tài khoản.        | Password reset                | Your account password was reset. If you didn't do this, review your account security.     |
| `identity.google_linked`               | Đã liên kết Google                         | Tài khoản Google đã được liên kết với tài khoản của bạn.                                                             | Google account linked         | A Google account was linked to your account.                                              |
| `identity.google_unlinked`             | Đã hủy liên kết Google                     | Liên kết Google đã được gỡ khỏi tài khoản của bạn. Nếu bạn không thực hiện việc này, hãy kiểm tra bảo mật tài khoản. | Google account unlinked       | The Google account link was removed. If you didn't do this, review your account security. |

Failed workflow copy contains no execution error details. Invalid connection copy requests reconnection without assuming a token expired. Password notifications include no password value, and identity copy contains no user ID, token, credential, OTP, or provider error.

Routine events such as `workflow.updated`, `profile.updated`, `avatar.updated`, and `connection.updated` are intentionally absent; they remain toast-only. This v2 contract and catalog are pure domain code and do not change the legacy notification event or runtime delivery behavior.
