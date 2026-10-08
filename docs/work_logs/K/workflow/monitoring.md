# Nhật ký: mô-đun giám sát (W6-A)

> Một log cho cả tính năng, cập nhật tại chỗ. Mẫu: `docs/work_logs/log_template.md` (bản rút gọn).

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-08 |
| Nhánh | `feat/w6-a-monitoring` (từ `week6` 1cafb47), worktree `T:\Weav-wt\w6-a` |
| Người thực hiện | Coding agent lane W6-A (coordinator review/commit) |
| Trạng thái | Hoàn thành code + kiểm tra tự động; chưa commit; chưa kiểm tra trên stack thật |
| Phạm vi | Lịch sử chạy toàn workspace, số liệu tổng hợp, quy tắc cảnh báo + thông báo, trang Executions và Dashboard dùng endpoint mới |

## 2. Tóm tắt

- `GET /workspaces/{w}/executions` (lọc status/workflowId/from/to, phân trang) và `GET /workspaces/{w}/monitoring/summary?days=1..30` (một lần gọi, tổng hợp bằng SQL, xu hướng theo ngày UTC có điền số 0).
- Quy tắc cảnh báo `CONSECUTIVE_FAILURES` và `LONG_RUNNING` (CRUD, tối đa 20/workspace). Khi một lượt chạy kết thúc (SUCCESS/FAILED), sau khi transaction commit, `AlertEvaluator` đánh giá các quy tắc và đưa sự kiện `monitoring.alert.*` vào notification outbox có sẵn (cùng đường đi với `workflow.failed`).
- Web: trang `/executions` (thẻ số liệu, biểu đồ xu hướng, bảng lọc, tab quy tắc cảnh báo), Dashboard lấy số liệu từ `monitoring/summary`, mục sidebar "Giám sát".

## 3. Quyết định kỹ thuật

| Quyết định | Lý do | Giới hạn / việc theo dõi |
| --- | --- | --- |
| Thời gian của một lượt chạy = `created_at` (lọc, sắp xếp, nhóm ngày); thời lượng = `finished_at - started_at` | Cùng khóa với danh sách theo workflow; `started_at` null khi đang QUEUED; có index `(workflow_id, created_at)` sẵn | Ngày tính theo UTC, ghi trong OpenAPI và UI |
| Tỷ lệ thành công = SUCCESS / (SUCCESS + FAILED), null nếu chưa có lượt nào kết thúc; CANCELLED/đang chạy không tính | Tránh làm tỷ lệ sai khi còn lượt đang chạy | Thời lượng trung bình/p95 chỉ tính lượt SUCCESS/FAILED có đủ hai mốc |
| Hook hoàn tất: `ExecutionStateAdapter.recordTerminalNotification` đăng ký `afterCommit` gọi `ExecutionFinishedListener` (cổng mới), mọi lỗi listener bị nuốt + log | Không đánh giá trong transaction của lượt chạy; phủ cả đường `RECOVERY_EXHAUSTED` | Nếu tiến trình chết giữa commit và đánh giá thì mất một lần cảnh báo (chấp nhận, không có hàng đợi) |
| Idempotency và cooldown: bảng `alert_rule_firings` (`UNIQUE(rule_id, execution_id)`, chỉ mục `(rule_id, workflow_id, fired_at)`); `fire()` chạy `REQUIRES_NEW`, khóa `pg_advisory_xact_lock(rule+workflow)` | Một lượt chạy không bắn một quy tắc hai lần; cooldown không bị race | Cooldown theo cặp (quy tắc, workflow) |
| Quy tắc không gắn workflow = đánh giá cho workflow vừa chạy xong (không gộp toàn workspace) | Khớp mô tả "bất kỳ workflow nào fail N lần liên tiếp" | `CONSECUTIVE_FAILURES`: N lượt SUCCESS/FAILED gần nhất đều FAILED và cách nhau <= M phút |
| Người nhận = người tạo quy tắc + người tạo workflow, `requires_monitor_access=true` (publisher kiểm tra lại `WORKFLOW_MONITOR`) | Workflow-service chỉ có API kiểm tra quyền theo từng user, không có API liệt kê thành viên | Gửi cho mọi thành viên cần endpoint nội bộ của workspace-service (ngoài lane) |
| Quyền: đọc = `WORKFLOW_MONITOR`, tạo/sửa/xóa = `WORKFLOW_EDIT` | Mọi thành viên (không phải owner) đều có `WORKFLOW_EDIT`; không có vai trò viewer riêng ở workspace-service | Nếu cần "chỉ owner/editor" phải thêm capability ở workspace-service |
| Thông báo chỉ vào hộp thư trong ứng dụng (inbox v2), giống `workflow.failed` | notification-service hiện KHÔNG có kênh email: chỉ Telegram/Expo (đường legacy) và inbox; Resend/SMTP chỉ có ở identity-service (OTP). Notification-service cũng không biết email người dùng | Email cần: endpoint email nội bộ ở identity-service + provider email ở notification-service (ngoài lane, cần quyết định) |
| Số đếm trong `data` của sự kiện là chuỗi số (`failureCount`, `durationSeconds`, `thresholdSeconds`) | Outbox của workflow dùng `Map<String,String>` | Schema JSON/Zod kiểm `^[0-9]{1,9}$` |

## 4. Thay đổi

- **Migration `V13__monitoring_alerts.sql`** (chỉ thêm): bảng `alert_rules`, `alert_rule_firings`, index một phần `idx_workflow_executions_finished`, mở rộng `ck_notification_outbox_type` và `ck_notification_outbox_entity` cho hai loại sự kiện mới.
- **workflow-service:** `MonitoringController`, `MonitoringService`, `AlertRuleService`, `AlertEvaluator`, `MonitoringQueryAdapter`, `AlertRuleAdapter`, cổng `MonitoringQueryPort`/`AlertRuleStore`/`ExecutionFinishedListener`, `AlertRuleType`; `WorkflowNotificationEvent` thêm hai factory + nhánh kiểm tra; `ExecutionStateAdapter` thêm hook (constructor 6 tham số giữ nguyên, thêm bản 7 tham số); `ExecutionQueryAdapter.sanitizeString` thành package-private static để tái dùng.
- **notification-service:** `notification-event.ts` (hai biến thể), `notification-catalog.ts` (nội dung vi/en, đích EXECUTION), spec cập nhật (19 -> 21 loại sự kiện).
- **packages/contracts:** `events/notification/event-v2.schema.json` + README; `http/workflow/openapi.yaml` + README.
- **api-gateway:** `MonitoringProxyController` trong `workflow.module.ts` (query kiểu `string | number`) + spec.
- **web:** `api/monitoring.api.ts` (có nhánh mock), `pages/ExecutionsOverviewPage.tsx`, `components/monitoring/*`, `lib/monitoring/format.ts`, `DashboardPage` (số liệu + chạy gần đây từ endpoint mới, link "View executions" -> `/executions`), `App.tsx` (route `/executions`), `Sidebar.tsx` (mục "Giám sát"), `translations.ts` (khóa `monitoring.*`, `nav.monitoring`, `dashboard.monitoring_link`), `workflow-v1.api.ts` (export `workflowRequest`).

## 5. Route / sự kiện / bảng / biến môi trường

- Route mới (workflow-service, gateway thêm tiền tố `/api/v1`): `GET /workspaces/{w}/executions`, `GET /workspaces/{w}/monitoring/summary`, `GET|POST /workspaces/{w}/alert-rules`, `PUT|DELETE /workspaces/{w}/alert-rules/{id}`.
- Sự kiện: `monitoring.alert.consecutive_failures`, `monitoring.alert.long_running`.
- Bảng: `alert_rules`, `alert_rule_firings`. Không có biến môi trường mới.

## 6. Kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| workflow-service | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` | PASS, 882 test, 0 lỗi (kể cả các test môi trường thường đỏ) |
| Test mới (Java) | `MonitoringServiceTest`, `AlertRuleServiceTest`, `AlertEvaluatorTest`, `MonitoringHttpTest` (Testcontainers), 2 test hook trong `ExecutionLeaseTest`, 2 test trong `WorkflowNotificationEventTest` | PASS |
| notification-service | `pnpm test` / `pnpm test:e2e` / `pnpm build` | 104 test PASS / 19 PASS / build OK |
| api-gateway | `pnpm test` / `pnpm test:e2e` / `pnpm build` | 117 PASS / 117 PASS / build OK |
| web | `tsc --noEmit -p tsconfig.app.json`, `pnpm --dir apps/web build`, eslint file đã sửa | PASS |
| Playwright (cổng 4182) | `monitoring.spec.ts` (8 test, lặp 3 lần ổn định) | PASS |
| Playwright so sánh | dashboard-real-data, navigation-structure, executions-live, honest-pages, localization | trước 4 lỗi (quick actions + 3 localization), sau cùng 4 lỗi đó; không có lỗi mới. `navigation-structure` "legacy routes" cập nhật vì `/executions` không còn redirect |
| Định dạng diff | `git diff --check` | sạch |

### Chưa kiểm tra

- Chưa chạy trên stack docker thật (RabbitMQ -> notification-service -> inbox, trình duyệt thật). Cần coordinator kiểm tra: tạo quy tắc LONG_RUNNING ngưỡng 1 giây, chạy một workflow, xem thông báo trong chuông.
- Email: không có kênh email trong notification-service (xem mục 3).
- Chưa đo EXPLAIN trên Neon (không chạy SQL trên Neon theo quy ước); index đã thêm dựa trên truy vấn.

## 7. Việc tiếp theo

1. Quyết định kênh email (cần endpoint email ở identity-service và provider ở notification-service).
2. Nếu cần gửi cho mọi thành viên: thêm endpoint liệt kê thành viên có `WORKFLOW_MONITOR` ở workspace-service.
3. Hợp nhất union với W6-D2: `event-v2.schema.json`, `notification-event.ts`/`notification-catalog.ts` + spec (số loại sự kiện), `App.tsx`, `translations.ts`, `workflow.module.ts`, đánh lại số migration nếu D2 cũng dùng V13.

## 8. Vòng review 1 (2026-10-08)

Quyết định của K: cảnh báo chỉ gửi trong ứng dụng (không có kênh email; cảnh báo ra ngoài sẽ đến từ template W6-B); người nhận = người tạo quy tắc + người tạo workflow.

- **M1:** `GET /executions` luôn bị giới hạn 90 ngày: thiếu `from` thì `from = (to hoặc now) - 90 ngày`; thiếu `to` thì để mở phía trên; `from` cũ hơn 90 ngày mà không có `to` bị 400. `to` là cận trên loại trừ. Cập nhật OpenAPI và test.
- **M2:** `LongRunningAlertSweeper` (`@Scheduled`, mặc định 60 giây, `WORKFLOW_ALERT_SWEEP_ENABLED/POLL_INTERVAL/INITIAL_DELAY/BATCH_SIZE`, lô 200) gọi `AlertEvaluator.sweepOverdue`. Một câu SQL nối `alert_rules` với `workflow_executions` RUNNING/WAITING (quy tắc theo workflow hoặc toàn workspace), loại các cặp đã có trong `alert_rule_firings`; bắn qua `fire()` nên cooldown và `UNIQUE(rule_id, execution_id)` giữ tính idempotent cùng với kiểm tra lúc hoàn tất. Index một phần `idx_workflow_executions_active` trong V13. Test chạy sweep trực tiếp (properties test tắt job nền).
- **L1:** danh sách quy tắc và phép đếm giới hạn bỏ qua quy tắc của workflow đã xóa mềm. **L2:** `insertIfBelowLimit` lấy `pg_advisory_xact_lock` theo workspace rồi đếm + chèn (test hai luồng).
- **L4-L7:** nhãn "(UTC)" cho ô ngày và bộ đếm "hôm nay"; UI từ chối `from` cũ hơn 90 ngày khi không có `to`, ẩn thân bảng khi `rangeError`, dịch lỗi 400 về khoảng thời gian; danh sách "Lỗi gần đây" từ `summary.recentFailures`; sửa chú thích `MonitoringResponse`.
- **L8:** index V13 được tạo không-concurrent (đủ ở quy mô luận văn; nhánh production lớn thì tạo `CONCURRENTLY` thủ công trước).
- **L3:** việc đánh giá chạy trên luồng worker sau commit; `REQUIRES_NEW` của `fire()` chỉ cần kết nối thứ hai khi có quy tắc bắn.
