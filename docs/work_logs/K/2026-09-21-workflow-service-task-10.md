# Nhật ký ngày `2026-09-21` — Workflow Service V1 Task 10

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` (tiếp tục kiểm tra ngày `2026-09-22`) |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de239fe09907a9db11e953f2f3e9588b1e3d` |
| Người thực hiện | Codex Luna MAX worker — Task 10 leases/fencing/recovery |
| Người review / nhận bàn giao | `/root` — coordinator |
| Trạng thái cuối session | Task 10 implementation and focused integration tests complete; coordinator review pending; chưa commit |
| Phạm vi session | Durable execution leases, fencing, acknowledged-message recovery, and gated UUID-only Rabbit listener |
| Liên kết liên quan | Workflow spec; Workflow V1 plan Task 10; Task 9 report; Task 8 report |

## 2. Tóm tắt điều hành

### Kết quả chính

- Thêm `ExecutionStatePort` lease contract và `ExecutionStateAdapter` dùng `CURRENT_TIMESTAMP` của PostgreSQL cho claim, renew, load, commit và release; mọi transition được fence bằng owner/token/expiry.
- Takeover giữ nguyên node `SUCCESS`/`SKIPPED`, chuyển attempt đang `RUNNING` thành `WORKER_INTERRUPTED`, giữ ngân sách attempts đã dùng và áp dụng retry delay đã lưu.
- Thêm scanner bounded, guarded và multi-replica-safe để khôi phục execution đã được broker xác nhận nhưng bị bỏ lại; recovery ghi UUID-only outbox event trong transaction DB.
- Thêm UUID-only listener với DLQ cho envelope sai, delayed durable retry khi DB lỗi tạm thời, duplicate/terminal ACK có điều kiện và runner handoff boundary. Worker/scanner không chạy mặc định; yêu cầu bật `weav.workflow.execution.worker.enabled=true` cùng một `ExecutionRunner` thật.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Compile / build | `PASS` | Maven test lifecycle; biên dịch 119 main và 39 test sources |
| Unit / integration | `PASS` | Focused `ExecutionLeaseTest,ExecutionRecoveryTest`: 15/15, 0 failure/error/skip |
| Database / broker | `PASS` | PostgreSQL 18.6 và RabbitMQ Testcontainers trong focused suite |
| Runtime service | Chưa bật | Worker/scanner feature flag mặc định tắt; Task 11 runner chưa được triển khai |
| Review thay đổi | Chưa hoàn tất | GitNexus fresh-file impacts báo `UNKNOWN`; source search/manual wiring review đã thực hiện |
| Commit / PR | Chưa tạo | Theo phạm vi worker; không stage/commit/push |

## 3. Mục tiêu và phạm vi

### Trong phạm vi

- Lease port, snapshot/transition contracts, persistence adapter, Rabbit listener, recovery scanner/configuration và regression tests.
- Khôi phục an toàn execution đã mất consumer sau ACK; không nhận công việc mới khi ứng dụng dừng.

### Ngoài phạm vi

- Task 11 runner/node execution engine và các connector.
- Sửa authoring/security/draft/definition paths hoặc Task 8 admission/outbox flows.
- Exactly-once side effects bên ngoài service; broker delivery vẫn có thể lặp và consumer phải idempotent.

### Tiêu chí hoàn thành

- Claim/renew/commit/release được fence bằng giờ DB và stale owner không thể ghi trạng thái.
- Restart/takeover bảo toàn node terminal và attempt budget.
- Recovery bounded, guarded và dùng outbox bền vững; malformed delivery vào DLQ, lỗi DB tạm thời không tạo hot loop.
- Ch focused real PostgreSQL/Rabbit regressions pass, diff sạch và có log bàn giao.

## 4. Bối cảnh và quyết định

- Task 9 đã cung cấp GraphState/readiness/condition/retry semantics; adapter chuyển persisted snapshot thành lease/transition mà không thay đổi hợp đồng này.
- Chọn database `CURRENT_TIMESTAMP` làm nguồn thời gian fence; renew dùng transaction ngắn riêng để runner dài không giữ transaction mở.
- Không ACK message vào no-op runner khi Task 11 còn thiếu. Runtime listener/scanner được gate; dependency injection yêu cầu `ExecutionRunner` thật khi bật worker.
- Khi mất lease, adapter từ chối transition và transaction rollback nguyên tử. Legacy state thiếu root/version không thể khôi phục thì thất bại rõ ràng với mã sanitized `LEGACY_STATE_UNRECOVERABLE`.

## 5. Thay đổi

### Application/domain boundary

- `application/port/out/ExecutionStatePort.java`: lease, snapshot, transition và fencing API.
- `application/port/out/ExecutionRecoveryPort.java`: bounded recovery selection/guard contract.
- `application/port/in/ExecutionRunner.java`: handoff `run(Lease)` cho runner sẽ do Task 11 cung cấp.

### Persistence, messaging, scheduling

- `infrastructure/persistence/repository/ExecutionStateAdapter.java`: PostgreSQL claim/renew/load/commit/release; transition các node, attempt, log và edge trong transaction ngắn; stale lease/constraint failure rollback.
- `infrastructure/messaging/ExecutionJobListener.java`: strict UUID-only envelope, invalid-message reject/DLQ, transient DB delayed retry với persistent TTL/retry queue, terminal/already-owned duplicate ACK, ACK delivery gốc chỉ sau positive confirm.
- `infrastructure/messaging/ExecutionWorkerRabbitConfiguration.java`: durable retry/dead-letter topology và consumer shutdown/admission behavior.
- `infrastructure/scheduling/ExecutionRecoveryScanner.java`: batch giới hạn, `FOR UPDATE SKIP LOCKED`, pending/recent outbox guard, UUID-only event insert nguyên tử.
- Cấu hình `weav.workflow.execution.worker.enabled` để ngăn consumer/scanner tự chạy trước khi có runner thật.

### Regression tests

- `ExecutionLeaseTest`: cạnh tranh claim, renew/heartbeat, stale owner, takeover với SUCCESS/SKIPPED và attempt budget, rollback nguyên tử, thiếu legacy root.
- `ExecutionRecoveryTest`: recovery sau ACK/lease expiry, runner handoff thật trong test, broker confirm, duplicate terminal, malformed-to-DLQ, DB retry trước ACK, shutdown/requeue và null-map/finishedAt contracts.

Không thêm migration Task 10; các state fields cần thiết đã được Task 8 V3 cung cấp.

## 6. Kiểm tra và bằng chứng

Chạy từ `services/workflow-service` với `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` và local Maven repository `C:\Users\nhoan\.m2\repository`:

```powershell
.\mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' '-Dtest=ExecutionLeaseTest,ExecutionRecoveryTest' test
```

- Kết quả cuối: `ExecutionLeaseTest` 8/8, `ExecutionRecoveryTest` 7/7; tổng `15/15`, 0 failure/error/skip, `BUILD SUCCESS`.
- Surefire chạy real PostgreSQL 18.6/RabbitMQ Testcontainers; Maven lifecycle compile toàn bộ main/test sources.
- `git diff --check`: exit 0. Quét trailing whitespace PowerShell trên 9 file Task 10 thuộc ownership: không thấy kết quả.

### Điều chưa được kiểm tra

- Chưa chạy full Workflow suite sau khi các Task 10 và M1 fixes cùng ổn định; coordinator giữ slot để chạy combined suite.
- Chưa bật consumer trong deployment; Task 11 runner/runtime acceptance vẫn còn.
- GitNexus index chưa bao gồm các file mới: impact trả `UNKNOWN`/target-not-found; đã kiểm tra Spring bean, listener, scheduler và test wiring bằng source search/manual review nhưng graph chưa được xác nhận.

## 7. Sự cố và rủi ro

- Một lần test broker confirm bị timeout; các lần cuối với mandatory routing, confirms/returns và regression trực tiếp đều pass. Nguyên nhân lần timeout riêng lẻ chưa được xác định, không kết luận đó là defect đã sửa.
- Một test stale-owner cần unwrap nguyên nhân cụ thể do Spring repository proxy bọc exception; rollback test được sửa để cung cấp snapshot node đầy đủ. Các test cuối cùng pass.
- Lưu ý delivery là at-least-once; duplicate publish/consume vẫn có thể xảy ra. Không tuyên bố exactly-once external side effects.

## 8. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Coordinator review Task 10 diff và chạy combined Workflow suite sau M1 fixes.
2. Trước commit, refresh GitNexus/index hoặc xác nhận tác động mới, sau đó chạy `detect_changes`; root owns review/acceptance.

### Hạn chế

- Không triển khai Task 11 tại session này. Giữ worker/scanner disabled trong runtime cho tới khi real `ExecutionRunner` được nối và verified.
- Không stage, commit hoặc push.

## 9. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; workspace chia sẻ chứa các task khác |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Luna MAX worker |
| Cần đọc trước khi tiếp tục | Workflow spec, approved plan Task 10, file này và `scratchtask-10-report.md` |
