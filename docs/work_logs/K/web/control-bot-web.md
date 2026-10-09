# Control bot (W6-B2): Discord connection, node inspectors, templates

Trạng thái: hoàn thành phần code, chưa commit (coordinator commit). Nhánh `feat/w6-b2-control-bot-web` (từ `week6` 042f384). Spec: `docs/superpowers/specs/2026-10-09-w6b-control-bot-design.md`; plan: `docs/superpowers/plans/2026-10-09-w6b-control-bot.md`.

## Quyết định

- workspace-service: `DISCORD` + `TOKEN`; secret là webhook URL, kiểm bằng `CredentialPayloadCodec.DISCORD_WEBHOOK_URL` (full match) khi lưu và khi giải mã. Không có CHECK constraint ở cột `provider` nên không cần migration. Thêm `DiscordConnectionProvider` (test = GET webhook; 2xx verified, 401/404 auth invalid, còn lại dependency failure) để "Test connection" chạy.
- Web: form token dùng chung cho Telegram và Discord (`isToken`); Discord kiểm regex ở client, server là nguồn quyết định.
- Inspector `weav.workflow` và `trigger.workflow_event` là component riêng (`ControlBotInspectors.tsx`) vì cần picker workflow và multi-select; `discord.send_message` dùng `SchemaField` + `CharCounter`.
- Templates dùng category `chat` (không thêm filter mới để khỏi sửa `CreateWorkflowPage`). Email cảnh báo bỏ `to` (người dùng điền sau).

## File thay đổi

- workspace-service: `ConnectionProvider`, `ConnectionProviderPolicy`, `CredentialPayloadCodec`, `ResolvedConnectionCredential`, `WorkspaceApplicationConfig`, `DiscordConnectionProvider` (mới); test `DiscordCredentialTest`, `DiscordConnectionProviderTest` (mới), `ConnectionAuthorizationPolicyTest` (switch).
- web: `connection.api.ts`, `ConnectionsPage.tsx`, `WorkflowBuilderPage.tsx`, `CustomWorkflowNode.tsx`, `nodeCatalog.ts`, `nodeLabels.ts`, `nodeReadiness.ts`, `templates/index.ts`, `translations.ts` (khối `W6-B control bot`), `ControlBotInspectors.tsx` (mới), `e2e/control-bot.spec.ts` (mới), `e2e/honest-templates.spec.ts` (giới hạn số template 8 → 12).

## Kiểm tra

- `./mvnw -q test -Dtest=DiscordCredentialTest,...`: pass. `./mvnw verify` (workspace-service): 451 test, 3 lỗi môi trường `WorkspaceNotificationRuntimeIntegrationTest` (thiếu `notification-service/dist`).
- `tsc -p tsconfig.app.json`: sạch. `pnpm build`: ok. eslint file đã sửa: chỉ còn lỗi có sẵn ở `WorkflowBuilderPage.tsx:531` (setState trong effect, không phải code mới).
- Playwright (cổng 4185): baseline 28 fail / 82 pass; sau khi sửa 28 fail / 92 pass, cùng danh sách fail (25 `workflow-ui`, 3 `workspace-connections`); 10 test mới đều pass.

## Rủi ro / việc tiếp theo

- Đã thêm `DISCORD` vào gateway (`workspace.controller.ts` z.enum, `workspace.e2e-spec.ts`) và `packages/contracts/http/workspace/openapi.yaml`; gateway test 137, e2e 133, build, eslint đều pass.
- Review round 1: inspector `weav.workflow`/`trigger.workflow_event` render với `key={selectedNodeId}`; đổi operation reset textarea input; JSON sai thì xóa `config.input`.
- Kiểm tay trên trình duyệt với webhook Discord thật (K tự dán URL).
