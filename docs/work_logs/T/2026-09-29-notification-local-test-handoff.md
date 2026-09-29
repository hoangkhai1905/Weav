# Nhật ký ngày 2026-09-29 — Notification local test handoff

## 1. Metadata

- Múi giờ: Asia/Saigon; dự án Weav; người thực hiện: controller; người nhận/review: user.
- Checkout nhận: `D:/End/Weav`, nhánh `api-gateway`, HEAD `8d2da5efbc1e41aee51e8d69147fc67e16288bbd`.
- Worktree nguồn: `C:/Users/nguye/.codex/worktrees/notification-expansion/Weav`, nhánh `codex/notification-expansion`, HEAD `b0cf1b5bd49f64d476851ffe2013131ca6135212`.
- Trạng thái: PAUSED; gộp working changes để user test, KHÔNG tuyên bố feature hoàn tất/readiness.

## 2. Tóm tắt điều hành

- Ghi lại đề xuất workspace-wide execution history cần Gateway/Workflow BE + mobile. Chưa triển khai endpoint mới hoặc sửa production compatibility.
- Đã chuyển 261 file (132 tracked modified, 129 new) về checkout chính; 3 file untracked đã trùng nội dung được giữ, ledger chính có lịch sử đầy đủ hơn được giữ. Hash đối chiếu tất cả file chuyển/trùng: PASS.
- Giữ nguyên source worktree làm điểm phục hồi; không stage, commit, push, archive, deploy hoặc chạy migration.
- Task10 vẫn NO-GO: mobile gọi `/api/workflows` và `/api/executions` bị 404. Chứng cứ live ở báo cáo Task10 là kết quả worker trước bàn giao, không phải lượt chạy độc lập tại checkout chính.

## 3. Mục tiêu và phạm vi

- Yêu cầu: dừng phát triển, lưu đề xuất vào tài liệu, đưa code hiện có về main checkout để người dùng tự test.
- Trong phạm vi: chuyển chính xác Git-listed implementation files, bảo vệ thay đổi riêng, kiểm tra tĩnh/unit/build tại đích, cập nhật tài liệu.
- Ngoài phạm vi: triển khai proposal, sửa 404, chạy full-stack/browser, migration shared DB, deploy, sửa các lỗi khác, dọn disk hoặc worktree.

## 4. Bối cảnh và ràng buộc

- Source chưa có feature commit; vì vậy đây là tích hợp working changes, không phải `git merge`/merge commit.
- Main có commit mới chỉ sửa `docs/development/SETUP.md`, không overlap implementation. Dirty `apps/web/src/pages/AiGeneratorPage.tsx` không overlap.
- Không chép `.git`, `.env`, dependency folders, generated output; không đụng `examples/motion-primitives-website/`.
- Skill finishing-a-development-branch dùng cho kiểm tra integration safety; không thực hiện happy-path commit/cleanup vì user chỉ yêu cầu test handoff và acceptance còn blocked. Verification-before-completion yêu cầu kiểm tra mới tại đích trước khi ghi PASS.

## 5. Nhật ký thực hiện

1. Gửi stop/interrupt tới Harvey `01a0e7d7-0fc8-7e90-b94f-c5236fa4bcfe`, không giao thêm task.
2. So sánh HEAD, tracked changes, untracked collisions; xác nhận không overlap code. Giữ ledger main và Task10 fix1 brief main-only.
3. Tạo backup preimage + manifest, kiểm tra path containment/reparse points trên file chuyển; copy theo từng path chính xác, không recursive copy repository.
4. Đối chiếu SHA256 file chuyển/trùng và 4 protected files: AiGeneratorPage, SETUP, ledger main, Task10 fix1 brief — PASS.
5. Chạy các kiểm tra ở mục 9; ghi trạng thái PAUSED trong plan/ledger. Các sửa docs sau transfer được thực hiện riêng, có chủ đích.

## 6. Quyết định kỹ thuật

- Không mở rộng feature. Proposal deferred được giữ tại `docs/superpowers/notification-expansion.md#deferred-scope`.
- Không tạo commit chứa milestone chưa được accept hoặc kéo dirty user files vào commit.
- Giữ source worktree. Backup nằm tại `C:/Users/nguye/AppData/Local/Temp/weav-notification-handoff-5d1dd0394a614d0d81fd4558aa35a989`; `manifest.json` ghi paths, actions, hashes và `before/` lưu file đích có sẵn trước transfer. Temp có thể bị OS cleanup; source worktree vẫn giữ nguyên. Không phục hồi đè tự động sau khi user bắt đầu sửa/test.

## 7. Thay đổi, dữ liệu và cấu hình

- Chuyển implementation sẵn có Tasks1–9 + Task10 harness: web/mobile notification UX; Gateway/Notification inbox v2; Identity/Workspace/Workflow outbox; contracts, migrations, tests và báo cáo.
- Không tự author/refactor code production trong lượt này. Các thay đổi BE notification sẵn có được chuyển; BE endpoint executions mới trong proposal thì chưa làm.
- Migration SQL đã có trong bản chuyển nhưng CHƯA áp dụng bởi lượt handoff. Spring service khởi động có thể chạy Flyway theo cấu hình; kiểm tra đúng DB local/disposable trước khi user khởi động. Notification dùng explicit migration command theo rollout checklist.
- Không đọc/in `.env`, credential, connection strings; không đổi provider hoặc broker đang chạy.

## 8. File/tài liệu ảnh hưởng

- Danh sách 265 source paths và actions/hashes: backup `manifest.json` (261 copy, 3 identical, 1 keep-target-ledger).
- Tài liệu hợp nhất: `docs/superpowers/notification-expansion.md`, log này.
- Báo cáo từng task và rollout checklist đã được cô đọng vào hai file hợp nhất; trạng thái NO-GO vẫn còn hiệu lực.

## 9. Kiểm tra và bằng chứng tại D:/End/Weav

| Kiểm tra | Kết quả | Giới hạn |
| --- | --- | --- |
| SHA256 transfer + protected files | PASS | Kiểm tra nội dung chuyển; không chứng minh runtime |
| `pnpm --dir apps/mobile exec node --test` | PASS 102/102 | Có 7 tests export/static harness, không phải UI/native E2E |
| `pnpm --dir apps/mobile exec tsc --noEmit` | PASS exit0 | Typecheck |
| `pnpm --dir apps/web build` | PASS exit0 | Có cảnh báo bundle >500kB; không chứng minh UI |
| `node --test apps/web/e2e/task10-error-sanitizer.test.cjs apps/mobile/e2e/task10-export-origin.test.cjs apps/mobile/e2e/task10-static-routes.test.cjs` | PASS 15/15 | 7 tests trùng mobile suite, không cộng thành số test độc lập |
| `pnpm --dir services/notification-service test -- --runInBand` | PASS 10 suites, 93/93 tests, exit0 | Unit tests; warnings từ negative test fixtures |
| `git diff --check` | PASS exit0, gồm lượt cuối sau cập nhật docs | Có CRLF advisories, không phải whitespace error |

Chưa chạy lại Java suites, Notification DB/broker integration, Gateway build/tests hoặc authenticated browser/full stack tại checkout nhận. Không suy diễn PASS từ báo cáo cũ; runtime evidence và các gap trước đây vẫn ở Task4–10 reports.

## 10. Rủi ro và blocker

- GitNexus source `detect-changes --scope all --repo .` (CLI1.6.12): 132 files/684 symbols/208 processes, risk CRITICAL; output rút gọn và chưa phủ hết untracked files, không được coi là clean/full coverage. Đã cảnh báo trước transfer, không commit.
- Upstream `WorkflowPublicationService`: HIGH, 11 direct/16 total impacted, 1 process/4 modules, có WorkflowController caller. Không dùng shared-axis MEDIUM để hạ HIGH. `App`: UNKNOWN; text check xác nhận import/render ở `apps/web/src/main.tsx`, không coi zero callers là unused. Đây là kiểm tra rủi ro integration, không chứng nhận toàn bộ symbols mới đã được index.
- Mobile Workflow/Execution legacy routes vẫn 404. Task10 trước đó chạy tới cuối các notification assertions nhưng strict browser failure gate exit1. Không bỏ qua/relax assertion.
- Task10 runner có guard nguồn branch `codex/notification-expansion`/base `b0cf1b5`; không chạy nguyên xi trên main `api-gateway`/`8d2da5e`. Không sửa guard để ép pass.
- Rollout NO-GO còn các runtime/retention/operator gates; không dùng bản gộp này làm bằng chứng deploy-ready.

## 11. Trạng thái bàn giao / việc tiếp theo

1. User test tại `D:/End/Weav` với cấu hình dev hiện có; đọc `docs/development/SETUP.md` và rollout migration inventory trước khi bật service. Handoff không khởi động stack hoặc tự migrate DB.
2. Review các toast thường nhật, inbox mốc quan trọng, unread/read/mark-all, VI/EN và scope người dùng/workspace; ghi lại lỗi thực tế.
3. Chỉ triển khai proposal khi user xác nhận scope mới; không tự giao task tiếp theo. Nếu tiếp tục cần đọc git status/log vì checkout chính nay có implementation + dirty user changes.
4. Trước commit sau này: acceptance tests cần pass, rà diff, GitNexus change detection đủ coverage, loại trừ unrelated files/secrets/generated outputs. Không coi log này là commit authorization cho milestone chưa hoàn tất.

## 12. Tham chiếu

- `docs/superpowers/notification-expansion.md`
- `docs/work_logs/T/2026-09-28-notification-task-10.md`
- `docs/work_logs/T/2026-09-29-notification-local-test-handoff.md`

## 13. Kết thúc session

- Phát triển: PAUSED theo user; không thêm task.
- Commit/PR/deploy/shared migration: không tạo/thực hiện.
- Recovery: source worktree giữ nguyên + backup preimages/manifest; không xóa dữ liệu.
- Acceptance Task10: BLOCKED / NO-GO; handoff để test không đồng nghĩa feature đã hoàn tất.

## 14. Chẩn đoán 404 notification v2 sau handoff

- User báo web `GET http://localhost:3000/api/v2/notifications/unread-count` 404. Áp dụng systematic-debugging, chỉ kiểm tra read-only; không sửa production hoặc khởi động lại service.
- Fresh unauthenticated GET tại Gateway: v2 trả 404 `Cannot GET /api/v2/notifications/unread-count`; v1 trả 401 `Bearer token required`. Probe trực tiếp loopback bên trong Notification container: v2 trả 404, v1 trả 401. Đây là thiếu route runtime, không phải bằng chứng thiếu quyền hoặc lỗi DB.
- Local source đã có `NotificationV2ProxyController` và `InboxNotificationsController`. Đọc hai file source tương ứng bên trong `weav-api-gateway-1` / `weav-notification-service-1` chỉ xuất boolean: cả hai `hasV2=false`, `hasV1=true`.
- `docker inspect` trường chọn lọc: cả hai containers có `Mounts=[]`; Gateway được tạo 2026-09-25, Notification 2026-09-16. Dockerfile.dev COPY code tại build; Compose không có develop.watch cho hai service này. Vì vậy gộp code về filesystem không cập nhật code bên trong các containers cũ.
- Root cause đã xác nhận: web mới gọi v2 nhưng Gateway và Notification đang chạy code cũ chỉ có v1. Cần rebuild/recreate ít nhất hai service để nạp route v2; restart container cũ không thay source. Đây là lỗi khác với mobile Workflow/Execution 404 còn hoãn.
- GitNexus query CLI1.6.12 đã chạy trước đọc source; trả partial/degraded FTS (thiếu Protocol/Category), index behind 1 commit. Dùng kết quả làm chỉ dẫn file và kiểm tra literal route/source/runtime trực tiếp, không coi graph là đầy đủ. Repo GitNexus exploration/debugging skill files không tồn tại, đã báo dùng CLI fallback.
- Chưa kiểm tra schema/migration DB của stack đang chạy. Rebuild không chứng minh inbox DB sẵn sàng. Trước migration phải xác nhận DB đích; không tự áp dụng migration trên cấu hình Neon/shared. Chờ user đồng ý refresh runtime; chưa rebuild/restart/migrate hoặc giao subagent mới.

## 15. Refresh hai containers đã duyệt — thiếu inbox schema

- User đồng ý rebuild/recreate Gateway + Notification, không migration. Chỉ thực hiện hai service này; không sửa code hoặc rebuild các producer services.
- Chạy từ `D:/End/Weav`: `docker compose -p weav -f compose.yml -f compose.dev.yml -f compose.colab-ocr.dev.yml build api-gateway notification-service` — PASS exit0; sau đó cùng cấu hình `up -d --no-deps --no-build api-gateway notification-service` — PASS exit0. Giữ OCR override của Gateway hiện hữu; không restart phụ thuộc, không xóa volume/cache/image.
- Kiểm tra source trong hai containers mới: `hasV2=true`. Gateway `/health` 200; Notification `/health` 200. Gateway host port3000 và Notification loopback `/api/v2/notifications/unread-count` cùng trả 401 khi không có token, thay cho 404 trước refresh. Route-registration defect đã được giải quyết; đây KHÔNG phải authenticated inbox success hoặc browser E2E.
- Notification `/ready` trả 503. Chạy metadata SELECT trong transaction `BEGIN READ ONLY`/`ROLLBACK` bằng cấu hình DB nội bộ, chỉ xuất table/column presence: DB kết nối được; `notification.notification_deliveries` tồn tại, `notification.notification_inbox` chưa tồn tại, `notification_deliveries.inbox_id` chưa có. Không đọc dữ liệu người dùng hoặc in credential/connection string.
- Blocker còn lại đã xác nhận: schema thiếu thay đổi của `services/notification-service/prisma/migrations/202609260001_notification_inbox/migration.sql`. Không chạy migration/reconciliation; cần user duyệt DB đích và bước migration riêng trước khi inbox v2 hoạt động. Không tuyên bố thông báo đã hoạt động hoàn chỉnh.
- Các containers Identity/Workspace/Workflow/RabbitMQ vẫn có uptime cũ; chỉ hai containers được cập nhật. Skill verification-before-completion yêu cầu bằng chứng HTTP/schema mới ở trên; không lấy image build success làm runtime acceptance.

## 16. Chẩn đoán 503 Workspace connection detail

- User báo `GET /api/v1/workspaces/af71aa56-ad13-43c1-ac7a-1740b077c0c7/connections/08771023-e69f-4db9-b23f-78aff865aa6b` trả 503.
- Gateway `/health` trả 200; Workspace `/actuator/health` trả 200 với DB/readiness UP. Gateway log đã map route connection detail đúng. Workspace log ghi nhiều `DependencyUnavailableException` tại thời điểm request.
- Root-cause tracing: `getConnection` → `ConnectionUsageProtection` → `WorkflowConnectionUsageClient.isInUse` → Workflow internal usage endpoint. Adapter fail-closed nếu thiếu `WORKFLOW_INTERNAL_SERVICE_KEY`; cả Workspace container và Workflow container đều báo biến này `empty`. `WEAV_INTERNAL_SERVICE_KEY` đang nonempty nhưng là key cho chiều Workflow gọi Workspace, không thay thế key Workspace→Workflow.
- Compose hiện khai báo `WORKFLOW_INTERNAL_SERVICE_KEY: ${WORKFLOW_INTERNAL_SERVICE_KEY:-}` ở cả hai service, nên nếu biến host/.env không được set thì container khởi động bình thường nhưng connection detail trả 503 khi cần kiểm tra usage. Đây là lỗi cấu hình secret/service-to-service, chưa sửa code.
- Không đọc giá trị secret, không sửa `.env`, không restart service trong lần chẩn đoán này. Cách xử lý được đề xuất: đặt cùng một random secret local đủ dài cho `WORKFLOW_INTERNAL_SERVICE_KEY` ở cấu hình host/.env, rồi recreate Workspace + Workflow; sau đó kiểm tra lại route authenticated. Không cần migration cho lỗi này.

## 17. 503 workspace list ngay sau recreate

- User chạy `docker compose ... up -d --build --no-deps workspace-service workflow-service` sau khi đặt key và báo `GET /api/v1/workspaces?page=0&size=20` trả 503.
- Container Workspace/Workflow có `Status=running`, nhưng `GET http://localhost:8082/actuator/health` trả empty reply. Gateway log ghi liên tục `Workspace upstream failed ... error=fetch failed`; Docker logs của hai container vẫn đang tải các dependency Maven từ Central, chưa có log `Started ...`/HTTP readiness.
- Root cause của 503 lượt này là ứng dụng Spring Boot chưa bind HTTP port sau recreate; `up -d` chỉ xác nhận container process đã chạy, không chờ Maven/Spring ready. Không phải kết luận mới về database hoặc route. Identity có một log Forbidden lẻ trong giai đoạn startup/request cũ, nhưng chưa dùng làm root cause vì Workspace chưa sẵn sàng.
- Chờ log startup hoàn tất rồi kiểm tra `/actuator/health`; không cần rebuild lại. Có thể theo dõi bằng `docker compose ... logs -f workspace-service workflow-service`, nhấn Ctrl+C chỉ để dừng xem log, không dừng container. Sau khi health trả 200 mới refresh web; nếu còn 503 lúc đó mới truy tiếp dependency/auth.

## 18. Root cause mới nhất của OAuth connection 503

- User báo cả GET connection detail và POST `/oauth/authorize` trả 503. `WorkflowConnectionUsageClient` là bước fail trước khi xử lý Google OAuth; probe nội bộ từ container xác nhận key `WORKFLOW_INTERNAL_SERVICE_KEY` nhận 401, còn key chiều ngược lại nhận 200.
- Đối chiếu source và runtime cho thấy cấu hình bị collision do Spring Boot relaxed binding: Workflow được truyền đồng thời `WORKFLOW_INTERNAL_SERVICE_KEY` và `WEAV_INTERNAL_SERVICE_KEY`; biến `WEAV_INTERNAL_SERVICE_KEY` tự ánh xạ vào `weav.internal.service-key`, ghi đè placeholder `${WORKFLOW_INTERNAL_SERVICE_KEY:}` trong `application.properties`. Vì vậy Workflow thực tế chấp nhận nhầm key `WEAV...`, trong khi Workspace gửi `WORKFLOW...`.
- Đây là lỗi mapping cấu hình service-to-service, không phải lỗi Google OAuth hoặc dữ liệu connection. Không sửa code trong lượt chẩn đoán. Cần tách tên property/env cho hai chiều hoặc dùng workaround local có chủ đích; không coi việc dùng chung hai key là cấu hình production đúng.
- Workspace `/actuator/health` tiếp tục trả 503 vì `.env` đang đặt `RABBITMQ_HOST=localhost`; trong container điều này trỏ về chính Workspace. TCP tới `rabbitmq:5672` từ container đã thông, nên local Compose cần dùng hostname `rabbitmq` cho Workspace. Đây là blocker độc lập ảnh hưởng Rabbit health/outbox.
- Một lệnh diagnostic đã vô tình in giá trị secret key vào output tool. Không ghi lại giá trị trong log này; các key đó nên được rotate sau khi local test ổn định.

## 19. Workflow list 503 do workflow-service chưa khởi động

- User báo Gateway `GET /api/v1/workspaces/{workspaceId}/workflows?page=0&size=100` trả 503.
- Gateway log ghi `Workflow upstream failed`; probe trực tiếp `http://localhost:8083/actuator/health` không kết nối được. `weav-workflow-service-1` ở trạng thái `Exited (1)`.
- Workflow container fail trong `mvn spring-boot:run` khi tải dependency Maven `com.github.docker-java:docker-java-api:3.7.1`: `Premature end of Content-Length delimited message body`. Đây là lỗi tải dependency/infrastructure, không phải lỗi API/frontend.
- Không sửa code. Cần chạy lại riêng Workflow để Maven resume/download artifact còn thiếu, chờ log `Started WorkflowServiceApplication`, rồi kiểm tra port 8083 trước khi refresh web.

## 20. Hợp nhất tài liệu notification

- Các brief, plan, design, rollout và task log rời của notification expansion được hợp nhất thành `docs/superpowers/notification-expansion.md` và work log này.
- README service và HTTP/event contract vẫn giữ riêng vì là tài liệu vận hành/contract trực tiếp của từng package.
- Bản hợp nhất giữ các quyết định sản phẩm, milestone status, test limitations, rollout/rollback, deferred mobile scope và toàn bộ runtime handoff mới nhất; không ghi secret hoặc connection string.
