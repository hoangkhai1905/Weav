# Nhật ký Week 5: sửa backend (lane W5-D, batch 1)

Nhánh `feat/w5-d-backend-exec` (từ `week5` ef69d9a). Nguồn: `docs/work_logs/K/qa/e2e-audit.md`, `docs/superpowers/specs/2026-10-07-week5-plan.md` (D1). Trạng thái: batch 1 (backend) hoàn thành, chờ coordinator review; batch 2 (UI executions) chưa làm.

## workflow-service

| Việc | Thay đổi | Ghi chú |
| --- | --- | --- |
| #21 một đồng hồ | `ExecutionStateAdapter.claim` đặt `started_at` từ `Clock` (`workflowExecutionClock`) thay cho `CURRENT_TIMESTAMP`; thông báo `RECOVERY_EXHAUSTED` dùng `clock.instant()` | Lease (`lease_until`) giữ đồng hồ DB vì chỉ so sánh với chính DB; không đổi `created_at`. Test: `ExecutionLeaseTest.startedAtComesFromTheInjectedClockNotTheDatabaseClock` |
| #58 `email.send` nhận `Name <addr>` | `GmailNodeExecutor.parseRecipients(field, value)` nhận `addr`, `Name <addr>`, `"Name" <addr>`, danh sách phân tách dấu phẩy (dấu phẩy trong ngoặc kép được giữ). Chỉ giữ địa chỉ trần, bỏ tên hiển thị | Không thêm dependency (jakarta.mail không có trên classpath). Vẫn từ chối CR/LF và ký tự điều khiển; giữ giới hạn 10 người nhận. `email.send.json` không ràng buộc định dạng nên không đổi |
| #58 `trigger.gmail` input | Thêm `fromEmail` (địa chỉ trần), `fromName` (tên hoặc `""`); `from` giữ nguyên | `GmailMessageParser.sender`; test `GmailMessageParserTest`; mô tả `trigger.gmail.json` cập nhật |
| #59 lỗi node có trường | `NodeExecutor.Failure.invalidField(field, reason)`; `ExecutionRunner` lưu lỗi node/run dạng `{code, message, details:{field}}` | Chỉ email node dùng; không đưa giá trị vào lỗi/log. Test `ExecutionRunnerTest`, `GmailNodeExecutorTest` |
| D1 trigger thủ công tùy chọn | `DefinitionValidator`: bỏ `MANUAL_TRIGGER_REQUIRED`; thay bằng `TRIGGER_REQUIRED` (cần ít nhất một `trigger.*`); giữ `MULTIPLE_MANUAL_TRIGGERS`. `WorkflowExecutionRepositoryAdapter.createManual`: gốc là `trigger.manual` nếu có, nếu không là trigger đầu tiên theo thứ tự định nghĩa; lần chạy vẫn ghi `trigger_type=MANUAL`, input `{}` hoặc input client gửi. `ExecutionStateAdapter.hasRecoverablePinnedState` chấp nhận gốc `trigger.*` bất kỳ cho lần chạy MANUAL | Định nghĩa cũ có node manual không đổi |

## ai-service (chỉ phần D1)

- `generation-result.ts`: cần ít nhất một `trigger.*`, tối đa một `trigger.manual` (trước: đúng một manual).
- `prompts.ts`: không thêm `trigger.manual` cạnh trigger khác; thêm `fromEmail`/`fromName` vào mô tả input Gmail.
- Test: `generation-result.spec.ts` (schedule-only hợp lệ, không trigger thì lỗi), `use-cases.spec.ts` (đổi tên ca).

## notification-service (#32)

- `Notifications.consume`: bỏ qua (không tạo inbox) sự kiện `workflow.created|published|paused|resumed` khi mọi người nhận là chính `actorUserId`. `workflow.completed|failed` và hành động của người khác giữ nguyên. Sự kiện đã mang `actorUserId` nên không đổi publisher/contract.

## Kiểm tra

- `pnpm --dir services/notification-service test` 102 pass; `test:e2e` 19 pass; `build` OK; eslint các file đã sửa: cùng 4 lỗi `unbound-method` đã có ở spec trước đó.
- `pnpm --dir services/ai-service test` 204 pass; `build` OK.
- workflow-service: `./mvnw verify` 830 test, 1 lỗi (test lifecycle bên dưới, đã sửa); sau sửa chạy lại riêng test đó: pass.

## Rủi ro / việc tiếp theo

- `WorkflowNotificationLifecyclePersistenceIntegrationTest.compiledNotificationConsumerPersistsAllSixV2EventsInJwtScopedInbox` chạy thật khi `services/notification-service/dist` đã build; sau #32 chỉ còn 2 dòng inbox (completed/failed), test đã cập nhật (6 -> 2, creator 0).
- Chỉ email node trả `details.field`; các executor khác (telegram, sheets, http) chưa.
- Batch 2: trang executions (`Live*.tsx`, `WorkflowsPage.tsx`, `execution.api.ts`) và `docs/handoff/2026-10-week5-mobile.md`.

## Batch 2: web executions UI và tài liệu (apps/web, docs)

Trạng thái: hoàn thành, chờ coordinator review và kiểm tra trình duyệt thật.

| Việc | Thay đổi |
| --- | --- |
| #41 thứ tự bước | `lib/executions/runView.ts` `orderSteps`: sắp theo đồ thị của định nghĩa hiện tại (Kahn, hòa theo thứ tự định nghĩa); bước không có trong định nghĩa xếp cuối theo thời gian bắt đầu. API không có endpoint đọc phiên bản đã ghim nên một lượt chạy của phiên bản cũ dùng định nghĩa hiện tại |
| #51 bước không chạy | `NodeExecutionResult.skipped` (thêm tùy chọn, đặt khi node SKIPPED/CANCELLED); bước skipped hoặc còn PENDING trong lượt đã kết thúc hiện "Không chạy" và không được chọn mặc định (chọn bước lỗi, nếu không thì bước đã chạy đầu tiên) |
| #52 polling | `lib/executions/useLivePolling.ts`: 2 s khi lượt đang mở hoặc bất kỳ lượt nào trong danh sách là QUEUED/RUNNING; không chồng yêu cầu, tạm dừng khi `document.hidden`, dừng khi kết thúc/unmount. Dùng trong `ExecutionsTriPane` và trang danh sách toàn cục |
| #60 nhãn trigger | `triggerTypeLabel` (+ khóa `runs.trigger_type.gmail`, fallback dễ đọc) ở chi tiết, danh sách lượt chạy và danh sách workflow |
| #61 cột trigger | API danh sách không trả trigger (mọi dòng mặc định manual). Dùng loại của lượt chạy tự động gần nhất nếu có; workflow chưa có lượt tự động vẫn hiện Thủ công. Cần backend: thêm trigger vào summary. `mapDetail` trong `workflow-v1.api.ts` chọn trigger đầu tiên nên node manual cũ có thể thắng |
| #28 | Nút ⋯ và menu của từng dòng có tên truy cập kèm tên workflow |
| #59 UI | `details.field` hiện nhãn tiếng Việt (`runs.field.*`) ở banner lỗi và khung chi tiết bước |
| D1 | Không có đoạn nào trong file của lane này chặn "Chạy" khi thiếu `trigger.manual`. `WorkflowBuilderPage.tsx` (lane A) dòng ~1163/~1172 còn gắn với `trigger.manual` |
| Tài liệu | `docs/handoff/2026-10-week5-mobile.md` (mới), `docs/api/week4-node-contracts.md` (khóa `fromEmail`/`fromName`) |

Ghi chú: phần chi tiết/bước nằm ở `components/executions/ExecutionsTriPane.tsx`; `LiveExecutionDetailPage.tsx` chỉ chuyển hướng nên không đổi.

Kiểm tra: `pnpm --dir apps/web build` OK; eslint các file đã sửa chỉ còn 2 lỗi `set-state-in-effect` đã có từ trước (LiveWorkflowExecutionsPage dòng 88, WorkflowsPage dòng 138); `git diff --check` sạch; Playwright (cổng 4178, `VITE_API_MODE=http`) các spec baseline (`workflow-api-v1`, `workflow-ui`, `request-budget`, `notification-live-runtime`, `localization`) cùng danh sách lỗi như trước khi sửa (28 lỗi cũ), spec mới `e2e/executions-live.spec.ts` 2/2 pass (polling dừng ở SUCCESS, thứ tự đồ thị, bước không chạy, nhãn trường lỗi).

## Batch 3: theo review (backend + web)

- ExecutionLeaseTest: run MANUAL có gốc `trigger.webhook` claim được; run tự động sai loại gốc và run MANUAL có gốc không phải trigger bị từ chối.
- `MAPPING_ERROR` có `details.field` (tên trường cấu hình của node, resolve từng trường) và thông điệp "refers to a value that is missing". `NodeExecutor.Failure` có một constructor chính, `field` là final, thêm `Failure.forField`. Test: ExecutionRunnerTest.
- `GmailMessageParser.sender`: fallback khoan dung (nhóm `<...>` cuối hợp lệ); test dấu nháy thoát và fallback. `GmailNodeExecutorTest`: các ca địa chỉ biên, 11 người nhận ("between 1 and 10"); `splitMailboxes`/`parseRecipients` dừng sớm khi vượt giới hạn.
- ai-service: từ chối trigger manual không có cạnh ra khi còn trigger khác; test hai manual (từ chối), manual + webhook (chấp nhận), manual chết (từ chối).
- #61: `GET .../workflows` thêm `triggerTypes: string[]` (từ draft definition, thứ tự định nghĩa; gateway chỉ proxy, không map trường). Web dùng nó (trigger không phải manual thắng), chỉ rơi về lượt chạy tự động gần nhất khi API không có trường; `mapDetail` cũng ưu tiên trigger không phải manual. Test: WorkflowDraftHttpTest, WorkflowResponseTest, `executions-live.spec.ts` (3 test).
- Kiểm tra: xem báo cáo cuối của lane (Maven verify, web build, Playwright).

## Review round (batches 2 và 3)

- H1: trang lượt chạy toàn cục poll mỗi 10 s, chỉ tải lại các workflow đang có lượt chạy live, tải lại đầy đủ tối đa mỗi 30 s; khung theo workflow vẫn 2 s.
- M1: `ExecutionsTriPane` bỏ qua phản hồi cũ (ref workflow/run hiện tại). M2: `useLivePolling` lùi theo cấp số nhân khi tick lỗi (2 s tới 30 s, reset khi thành công), tick báo lỗi bằng `false`/throw, dừng khi 401; khung chỉ poll danh sách khi có lượt live trong danh sách, chỉ poll chi tiết khi lượt đang mở live. Test mới: backoff trong `executions-live.spec.ts`.
- L1: handoff §5 khớp §7 (`details.field` cho lỗi cấu hình email và mọi `MAPPING_ERROR`). L2: `sender` chỉ fallback khi có đúng một nhóm `<...>` ngoài ngoặc kép (test `Ada <ada@x.com> (<evil@y.com>)`). L3: `MappingException.missingValue()` đặt ở resolver thay cho kiểm tra chuỗi.
- Kiểm tra: Maven focused (GmailMessageParserTest, GmailNodeExecutorTest, ExecutionRunnerTest, MappingResolverTest, DefinitionValidatorTest) pass; web build OK; eslint chỉ còn lỗi cũ; Playwright executions-live (4 test), workflow-api-v1, request-budget pass.

## Live #58 follow-up

- Symptom: execution `eaf71fe7` (Gmail trigger): stored trigger input had no `fromEmail`/`fromName`; `reply_email` failed with the generic `MAPPING_ERROR` (no `details.field`).
- Finding: no code path drops the keys. `GmailMessageParser.parse` -> `GmailMailbox` -> `GmailTriggerProcessor` -> `admissions.automatic(message.input())` -> `ExecutionRunner.triggerOutput` store the map unfiltered (no whitelist/projection anywhere in workflow-service main). `fromEmail`/`fromName` were added in 3651848 (09:43) and per-field mapping errors in 880db3e (10:11); the container (`Dockerfile.dev`, `spring-boot:run` from src copied at image build 10:15, started 10:26) has both (class contains `fromEmail`, `missingValue`).
- Both symptoms (no sender keys + generic mapping error) match a run admitted and executed by the previous container (before 10:26), i.e. a stale run, not a bug in current code. Not proven with timestamps (no DB access used); check `workflow_executions.created_at` of `eaf71fe7` against 10:26 local.
- Per-field naming already covers email.send: `resolveConfig` resolves every config field with its key. Added tests to lock both behaviors: `GmailAdmissionPersistenceTest` (stored execution input contains fromEmail/fromName), `ExecutionRunnerTest.aMissingMappedRecipientNamesTheToFieldOfEmailSend`.
- Next: send a fresh mail on the rebuilt stack and re-run the live check.
