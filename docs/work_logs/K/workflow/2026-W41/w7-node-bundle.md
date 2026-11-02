# Nhật ký: W7-A2 node bundle (format.datetime, format.text, slack.send_message, teams.send_message)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-10 |
| Nhánh | `feat/w7-a2-nodes` (từ `week6` aef8ef3), worktree `T:\Weav-wt\w7-a2` |
| Trạng thái | Hoàn thành code + kiểm tra; chờ coordinator commit và live check |
| Thiết kế | Brief được K duyệt 2026-10-10 (không có plan file) |

## 2. Quyết định

- Schema node dùng chung: `packages/workflow-schema/nodes/{format.datetime,format.text,slack.send_message,teams.send_message}.json`; hợp đồng `definition.schema.json` thêm enum và 4 rule `allOf` ở cuối (chỉ số cũ không đổi).
- `format.*` là executor thuần (`application/node`, `@Component`), `sideEffect: false`. Slack/Teams là `sideEffect: true`.
- Provider mới `SLACK`, `TEAMS` (TOKEN, secret là URL webhook). Cột `provider` là `VARCHAR(32)`, không có CHECK: không cần migration.
- Kiểm tra kết nối Slack/Teams chỉ kiểm tra hình dạng URL đã lưu, không gửi gì (webhook chỉ nhận POST gửi tin).
- `format.datetime`: khi không đặt `timezone`, giá trị có offset giữ offset của nó; ngày, giờ không offset, epoch dùng UTC (đặt `timezone` thì luôn đổi sang múi giờ đó). Khác một chút so với "mặc định UTC" trong brief để `format` không làm lệch giờ người dùng nhập.
- Pattern và timezone sai là lỗi validate khi lưu nháp (`INVALID_DATETIME_PATTERN`, `INVALID_TIMEZONE`); các trường bắt buộc theo thao tác kiểm tra khi publish.

## 3. Quy tắc URL

- Slack: `^https://hooks\.slack\.com/services/T[A-Z0-9]{1,20}/B[A-Z0-9]{1,20}/[A-Za-z0-9]{1,64}$`, không port, query, userinfo.
- Teams: https, port mặc định hoặc 443, host (chữ thường) kết thúc `.logic.azure.com` hoặc `.api.powerplatform.com` với ít nhất một ký tự trước hậu tố, không userinfo/fragment, path chứa `/workflows/`, không chứa `..`, kết thúc `/triggers/manual/paths/invoke`, query chứa `sig=`, tối đa 2048 ký tự ASCII in được.
- Kiểm tra ở 3 lớp: `CredentialPayloadCodec` (workspace-service), executor, `PinnedHttpTransport` (host cố định). URL/query không bao giờ vào log hoặc thông báo lỗi.

## 4. File thay đổi

- workspace-service: `ConnectionProvider`, `ConnectionProviderPolicy`, `CredentialPayloadCodec`, `ResolvedConnectionCredential`, `WorkspaceApplicationConfig`, mới `SlackConnectionProvider`, `TeamsConnectionProvider`; test mới `SlackTeamsCredentialTest`, `SlackConnectionProviderTest`, `TeamsConnectionProviderTest`, sửa `ConnectionAuthorizationPolicyTest`.
- workflow-service: `NodeSideEffects`, `DefinitionValidator`, `PinnedHttpTransport` (`executeSlackWebhook`, `executeTeamsWebhook`, `isTeamsWebhookUri`), `WorkspaceClient` (PROVIDERS), mới `FormatDatetimeNodeExecutor`, `FormatTextNodeExecutor`, `SlackSendMessageNodeExecutor`, `TeamsSendMessageNodeExecutor`; test mới tương ứng + sửa `NodeConfigSchemasTest`, `DefinitionValidatorTest`.
- api-gateway: `workspace.controller.ts` (enum provider thêm SLACK, TEAMS) và `test/workspace.e2e-spec.ts`.
- contracts: `workspace/openapi.yaml` (enum provider), `workflow/definition.schema.json`.
- web: `connection.api.ts`, `ConnectionsPage.tsx`, `nodeCatalog.ts`, `nodeLabels.ts`, `nodeReadiness.ts`, `CustomWorkflowNode.tsx`, `SchemaField.tsx` (trần số theo node), `WorkflowBuilderPage.tsx`, `publishErrors.ts`, `translations.ts` (khối `W7-A2`), `e2e/w7-nodes.spec.ts`.

## 5. Lệnh và kết quả

- `./mvnw verify` workspace-service: 485 test, 1 fail + 3 error đều không do lane này (xem rủi ro).
- `./mvnw verify` workflow-service: 1066 test, 0 fail, 1 error môi trường (`WorkflowNotificationLifecyclePersistenceIntegrationTest`, thiếu `notification-service/dist`).
- `jest test/workspace.e2e-spec.ts` (api-gateway): 14 pass.
- `tsc --noEmit -p tsconfig.app.json`: sạch. `pnpm --dir apps/web build`: pass.
- Playwright `w7-nodes.spec.ts` + `control-bot.spec.ts` (port 4187): 15/15 pass.
- `git diff --check`: sạch.

## 5b. Vòng sửa 1 (review)

- B1 kết quả `format.datetime` nằm trong try: năm cực đoan trả `FORMAT_INVALID_DATETIME`. B2 `number_format` giới hạn 64 ký tự trước khi parse. B3 mô tả `timezone` sửa lại. B4 Slack escape `&`, `<`, `>` (chặn `<!channel>`, link giả). B5 sửa test cũ `WorkflowContractValidationTest` (thêm `WORKFLOW_EVENT`). B6 trường thừa của thao tác khác được chấp nhận khi lưu/publish và bỏ qua khi chạy (có test).
- Teams: yêu cầu tham số `sig` không rỗng (`(^|&)sig=[^&]+`) ở backend (codec, transport) và client (`searchParams.get('sig')`).
- Web: `amount` nhận số âm; `maxLength` của `format.text` tối thiểu 1; ô `format.datetime.value` là text tự do (trước đây bị coi là số nguyên nên không nhập được ngày).
- **Teams trả 2xx (thường 202) nghĩa là Power Automate đã nhận yêu cầu, không đảm bảo luồng Workflows chạy thành công về sau; Weav không thấy lỗi muộn đó.**

## 6. Rủi ro và việc tiếp theo

- workspace-service: `WorkflowContractValidationTest.workflowDetailContractAddsOnlyTheSafeTriggerProjection` fail vì enum trigger `WORKFLOW_EVENT` từ W6-B, file không do lane này sửa; 3 `WorkspaceNotificationRuntimeIntegrationTest` thiếu notification-service `dist` (môi trường).
- `workflow-catalog-v1.spec.ts` và vài case `workspace-connections.spec.ts` đã đỏ từ trước (danh sách node V1 cũ thiếu discord/weav.workflow).
- Live check: tạo Slack Incoming Webhook và Teams Workflows webhook thật, tạo kết nối, chạy workflow gửi tin.
