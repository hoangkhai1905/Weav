# Nhật ký AI Service V1 — spec, plan và implementation (`2026-09-25` → `2026-09-30`)

> File duy nhất cho AI Service V1. Gộp từ ba log cũ (`2026-09-25-ai-service-spec-and-plan.md`, `2026-09-30-ai-spec-plan-review.md`, `2026-09-30-ai-service-v1-implementation.md`) và từ các report/review của từng task trong SDD workspace (đã xóa sau khi gộp). Mọi quyết định, finding và mục deferred cần giữ lại đều nằm ở đây.

## 0. Lịch sử spec và plan

- **2026-09-25 — Spec + plan (chỉ tài liệu).** Hướng V1 đã duyệt: AI Service NestJS stateless, adapter DeepSeek thay thế được, xác thực Service JWT, JSON chặt có giới hạn, bốn operation: generate, `ai.extract`, `ai.classify`, `ai.summarize`. Workflow sở hữu authorization, compile `WorkflowIntent` tất định, definition chuẩn, persistence, execution và retry policy. Definition extract cũ vẫn đọc/sửa/publish được nhưng cần `outputSchema` để chạy. Thiếu dữ kiện khi generate thì hỏi lại, không đoán. Deadline AI 60 s; Workflow gọi AI 65 s; generate 75 s. Gateway (route, contract, config, CI, test public edge) thuộc partner; plan gồm 11 task chỉ cho AI Service và Workflow.
- **2026-09-30 — Review spec/plan so với code (chỉ tài liệu, nhánh `feature/ai-service`).** Spec được sửa (§10 ghi quyết định) và plan viết lại thành 11 task test-first theo file. Các khoảng trống tìm thấy và quyết định:
  - Workspace không có endpoint liệt kê metadata connection → người dùng chọn connection ID trong builder, Workflow kiểm từng cái bằng `authorizeAttachment`, AI không bao giờ thấy connection.
  - Web chưa có wiring AI thật (`ai.api.ts` là mock thừa; builder ghi `schemaDescription`) → web builder vào scope, mobile giữ mock.
  - Đã có mẫu OCR (`OcrClient`, `WorkflowServiceJwtIssuer`) → tách `ServiceJwtSigner` dùng chung.
  - Retry theo HTTP status không an toàn → Workflow retry theo mã lỗi AI, không theo status.
  - Keyword schema có thể mang secret → `outputSchema` là static field, profile không có `default`/`const`/`examples`/`$ref`; độ sâu schema 16 → 8.
  - Lease heartbeat 15 s độc lập nên call AI 65 s an toàn.
  - Hoãn: CI, duplicate-key trên AI ingress, `$ref`.
  - Implementation chạy trên nhánh mới `feature/ai-service-impl` (cắt từ `fix/workspace-connection`, merge docs vào: `76cc791`).

## 1. Metadata

| Trường                       | Giá trị                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| Ngày làm việc                | `2026-09-30`                                                         |
| Múi giờ ghi log              | `Asia/Saigon`                                                        |
| Dự án / repository           | `Weav`                                                               |
| Nhánh / commit               | `feature/ai-service-impl`: `76cc791` (base) → `95a7d76` (merge lane D) |
| Người thực hiện              | Coordinator (Claude, Orca run `run_8981cdd5d65a`) + worker: opencode (lane A, D), GitHub Copilot (lane B, C); review: antigravity, Copilot (Task 1 re-review) |
| Người review / nhận bàn giao | Coordinator tự review toàn nhánh (không review riêng với `main` vì `main` tụt xa) |
| Trạng thái cuối ngày         | `Hoàn thành` — 11/11 task review sạch và đã merge; live acceptance 5 PASS + 1 PARTIAL + 1 FAIL tại Workflow hop (F3 là V1 known limitation); Gateway route vẫn absent |
| Phạm vi session              | `AI Service V1: Tasks 1–11 (implement, review, merge, live acceptance)` |
| Liên kết liên quan           | `docs/superpowers/specs/2026-09-25-ai-service-v1-design.md`           |

## 2. Tóm tắt điều hành

### Kết quả chính

- AI Service (NestJS) hoàn chỉnh: schema profile, DeepSeek adapter, 4 use-cases (extract/classify/summarize/generate), HTTP routes + JWT/service-key auth, retry/timeout/admission/limits.
- Workflow Service (Spring) hoàn chỉnh: AI node executors, output-schema policy + legacy extract preservation, ServiceJwtSigner, IntentCompiler, generate endpoint.
- Web builder (Task 10): schema editor, AI readiness, generate panel, e2e; R7 fix mở Publish cho AI node.
- Task 11 Part A: key script, fake provider fixture (smoke-tested), compose overlay (config exit 0, không `up`).

### Tình trạng nhanh

| Hạng mục                | Trạng thái    | Ghi chú ngắn                                              |
| ----------------------- | ------------- | --------------------------------------------------------- |
| Build / compile         | `PASS`        | `ai-service build`, `web build`, `tsc --noEmit` exit 0    |
| Unit / integration test | `PASS`        | ai-service 66/66 unit + 21/21 e2e; workflow 439, 0 fail*  |
| Migration / database    | `Chưa áp dụng`| Không có migration trong scope                            |
| Health check            | `Đã kiểm tra` | Stack rút gọn đã `up`; ai `/health/ready` = ready; gateway/workflow/identity/workspace 200 |
| Review thay đổi         | `Đã kiểm tra` | Tasks 1–10 review clean; T11 Part A self-review           |
| Commit / PR             | `Đã tạo`      | Xem §7; Part B + F1 follow-up đã commit (`da5a62b`, `f052d46`) |

\* Workflow verify tại 09a2331 do coordinator chạy: 439 tests, 0 failures, 3 lỗi môi trường đã biết (TLS cert ×2, notification dist ×1). Task 11 Part A không chạy lại Maven theo chỉ đạo.

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Hoàn thành implement AI Service V1 theo plan (Tasks 1–11).
2. Giữ mọi thay đổi additive, tương thích ngược, đúng service boundary.
3. Ghi acceptance log và trạng thái Gateway handoff.

### Trong phạm vi

- `services/ai-service`, `services/workflow-service` (server logic, tests).
- `apps/web` (builder: schema editor, readiness, generate panel, e2e).
- `scripts/ai-dev-keys.mjs`, `services/ai-service/test/fixtures/`, `compose.ai-local.yml`, work log.

### Ngoài phạm vi / chủ động chưa làm

- Gateway generate route (spec §9): của partner team, chỉ ghi trạng thái.
- Task 11 Part B (live `up` + 7 acceptance scenarios): xong 2026-09-30 (stack rút gọn, coordinator-driven; xem §11).
- Fix 5 lint errors pre-existing của web và 148 eslint errors pre-existing của ai-service (prettier drift + verbatim test code).

### Tiêu chí hoàn thành

- [x] Tasks 1–10 implemented, reviewed clean, committed.
- [x] Task 11 Part A files tạo đúng brief, static checks pass.
- [x] Part B: live stack + 7 acceptance scenarios (5 PASS + 1 PARTIAL + 1 FAIL tại Workflow hop; xem §11).

## 4. Bối cảnh và giả định

- **Bối cảnh hệ thống:** Weav đa service; AI Service mới (NestJS) cung cấp extract/classify/summarize/generate cho Workflow Service qua Service JWT; web builder consume qua Gateway route (spec §9).
- **Giả định đã dùng:** Gateway route chưa tồn tại trên mọi branch (đã xác nhận bằng search, không đoán).
- **Ràng buộc:** Không đọc/ghi DB chéo service; additive migrations/endpoints; không commit secret, `.env`, build output; `pnpm lint` của ai-service là `eslint --fix` nên chỉ chạy read-only.
- **Nguồn sự thật:** `docs/superpowers/specs/2026-09-25-ai-service-v1-design.md` (binding) và plan `docs/superpowers/plans/2026-09-25-ai-service-v1.md` (brief từng task và ledger đã được gộp vào file này).

## 5. Nhật ký theo session / thời gian

| Thời điểm | Việc đã thực hiện                          | Kết quả / bằng chứng                                        | Trạng thái |
| --------- | ------------------------------------------ | ----------------------------------------------------------- | ---------- |
| trước     | Tasks 1–6 (lanes A/B)                      | Reports task-1..6; workflow verify chỉ còn 3 lỗi môi trường | `Xong`     |
| trước     | Tasks 7–9 (lane C) + merge 09a2331        | Review clean sau fix rounds; 439 tests, 0 failures          | `Xong`     |
| trước     | Task 10 + fix round 1 R7 (lane D)          | 3baddc1 + 63bea41; Playwright chromium 10 passed, 1 skipped | `Xong`     |
| 14:00     | T11-A Step 1: key script + chạy            | `tmp/service-keys/` sinh 2 file, cả 2 gitignored            | `Xong`     |
| 14:05     | T11-A Step 2: fake-deepseek + smoke 8 case | Mọi scenario đúng contract (trừ slow, bỏ qua 70s wait)      | `Xong`     |
| 14:08     | T11-A Step 3: compose overlay + config     | `config --quiet` exit 0, 0 warning (có `.env` đã ignore)    | `Xong`     |
| 14:10     | T11-A Step 5: static checks                | unit 66/66, e2e 18/18, builds + tsc pass, diff-check clean  | `Xong`     |
| 14:15     | T11-A Step 6: work log + report + commit   | File log này                                                | `Xong`     |
| 14:30     | T11-A fix round 1                          | fake-deepseek bind `0.0.0.0`; ai-service chỉ mount JWKS (không còn thấy private key) | `Xong` |
| 14:35–15:00 | T11 Part B: live acceptance (stack rút gọn) | 5 PASS, 1 PARTIAL, 1 FAIL tại Workflow hop (§11)          | `Xong`     |
| 15:05     | F1 fix + work log Part B (`da5a62b`, `f052d46`, `9e2a3c7`) | e2e 21/21                                  | `Xong`     |
| 15:10     | Merge lane D (`95a7d76`) + final verification | Xem §9 "Final verification"                             | `Xong`     |
| 15:20     | Self-review toàn nhánh, gộp work log, dọn worktree | Không có Critical/Important mới (§6 "Self-review")   | `Xong`     |

### Điều phối (Orca)

- Lanes song song, mỗi lane một worktree/nhánh riêng, merge `--no-ff` vào `feature/ai-service-impl` sau khi review sạch: A (Tasks 2–4, opencode) `b31c1e9`; B (Tasks 5, 6, 8, Copilot) `cf76153`; C (Tasks 7, 9, Copilot) `09a2331`; D (Tasks 10, 11, opencode) `95a7d76`. Reviewer: antigravity (khác agent với implementer).
- Fix rounds: Task 7 ×1 (thiếu test contract/retry, `@ConditionalOnProperty` làm AI node mất executor khi disabled), Task 9 ×3 (thiếu `WorkflowGenerationHttpTest`, thiếu 11/12 test service, một assertion rỗng), Task 10 ×1 (R7, report thiếu), Task 11-A ×1. Các task còn lại sạch ngay lần review đầu.
- Sự cố điều phối đáng nhớ: prompt Copilot bị mất khi TUI chưa sẵn sàng (cách tin cậy: mở terminal agent trước rồi bind dispatch); Orca tự update giữa chừng (run vẫn nguyên vẹn); watcher nền bị dừng do thiếu RAM; reviewer Task 4 chạy `pnpm lint` (là `eslint --fix`) để lại thay đổi format — coordinator xác nhận đúng là output của `--fix` rồi bỏ.

## 6. Quyết định kỹ thuật

Spec §10 là nguồn quyết định cho kiến trúc (layering, closed errors, fail-closed khi AI disabled). Các ruling của coordinator trong quá trình implement:

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| ---------- | ------------------ | --------------------- | ----------------------- |
| R1: `AI_DEPS`/`AiDeps` ra `src/ai-deps.ts` | Tránh circular import module↔controller (token undefined lúc decorate) | Giữ trong ai.module.ts | Thêm 1 file; Task 4 áp dụng |
| R2: `aiSignal` augmentation ra `request-signal.ts` + side-effect import | Type phải thấy ở mọi compile unit (kể cả ts-jest per-file) | Để trong app.ts | Thêm 1 file; Task 4 áp dụng |
| R3: `WorkflowGenerationService` nhận `@Value` boolean thay vì `AiClientProperties` | Application layer không depend infrastructure (spec §2) | Inject properties object | Flag đọc 2 nơi cùng property |
| R4: "Expected" test counts không binding | Số lượng minh họa; quan trọng là all-pass | Bắt đúng số lượng | Không có |
| R5: profile không bao giờ nhận schema mà Ajv strict reject | Mismatch profile/Ajv gây raw Error → 500 runtime | Nới lỏng profile | Schema nghiêm hơn một chút; Task 1 + Java twin Task 5 |
| R6: thêm `AI_BUSY`, `AI_PROVIDER_UNAVAILABLE`, `AI_TIMEOUT` vào `RetryPolicy.TRANSIENT_CODES` | Spec §5 + acceptance #8 yêu cầu retry 3 mã này; plan bỏ sót | Chỉ dựa vào `failure.retryable()` | Additive; Task 7 áp dụng |
| R7: xóa `ai.*` khỏi unavailable/publish-blocker ở web builder | Task 7 đã xóa ai.* khỏi server unavailable set; acceptance #7/#8 yêu cầu AI publish + run được | Giữ nguyên text cũ | Server validation vẫn gate publish; Task 10 fix round 1 |
| Least privilege: ai-service chỉ mount `workflow-service.jwks.json` | Mount cả thư mục làm lộ `workflow-service.pem` trong container AI | Giữ mount thư mục theo plan | File JWKS phải tồn tại trước `up` (chạy `node scripts/ai-dev-keys.mjs`) |
| F3 là V1 known limitation (user quyết định 2026-09-30) | AI release admission đúng khi client của nó ngắt; Workflow không huỷ call AI khi client của Workflow ngắt | Sửa ngay trong Workflow (async + phát hiện disconnect) | Theo dõi ở §10 |

### Self-review toàn nhánh (coordinator, `76cc791..95a7d76`, 116 files)

Không review riêng với `main` (theo user: `main` tụt xa nhánh này). Đọc lại các vùng rủi ro nhất: `ServiceJwtVerifier` (RS256 cố định, `kid` → JWKS local, verify chữ ký trước khi tin claim, kiểm iss/aud/exp/iat/skew/lifetime/scope/workspace/request/mode), `DeepSeekProvider` (`redirect: 'error'`, body giới hạn, `finish_reason === 'stop'`, JSON chặt, không log key), `AiClient` (request ID mới mỗi call gắn vào cả token và body, đọc giới hạn byte, JSON chặt có phát hiện key trùng, `requestId` phải khớp, chỉ map mã lỗi đã biết còn lại fail-closed, lọc token khỏi output), `WorkflowGenerationService` (flag → rate limit → `WORKFLOW_CREATE` → `authorizeAttachment` từng connection → mới gọi AI; kết quả AI lọc theo allow-list, lạ thì `INVALID_INTENT`). Kết quả: không có Critical/Important mới. Quan sát Minor: rate limiter chạy trước authorization (khóa theo actor nên vô hại, nhưng non-member vẫn làm map limiter lớn lên — cùng rủi ro "coarse eviction" ở §10).

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- Task 1 (ai-service): `errors.ts` (AiError), strict JSON parse, output-schema check/match + fixture mở rộng (R5).
- Task 2 (ai-service): DeepSeek adapter rules (§5) + provider tests.
- Task 3 (ai-service): generation result shape / use-cases.
- Task 4 (ai-service): routes, Service JWT claims, request binding, closed errors; R1/R2 áp dụng; `test/ai.e2e-spec.ts`.
- Task 5 (workflow): static `ai.extract` outputSchema policy + execution preservation; legacy `schemaDescription` publish được.
- Task 6 (workflow): `ServiceJwtSigner` tách từ OCR issuer (behavior-preserving).
- Task 7 (workflow): AI node executors, retry integration, R6 codes; fail-closed khi disabled.
- Task 8 (workflow): IntentCompiler (deterministic layout + connection negotiation).
- Task 9 (workflow): generate endpoint authorized + OpenAPI bounds + full service/HTTP coverage sau 3 fix rounds.
- Task 10 (web): xóa `ai.api.ts`; `GenerationResponse` + `generateWorkflow` (mock branch); catalog/readiness AI; `OutputSchemaEditor`; `GenerateWorkflowPanel`; nút Generate + `definitionToCanvas`; e2e mới + shared helpers; R7 mở Publish cho AI.
- Task 11-A: `scripts/ai-dev-keys.mjs` (sinh RSA-2048 + JWKS `kid workflow-dev-1`); `test/fixtures/fake-deepseek.mjs` (port 18080, 5 scenario markers + 4 default operations); `compose.ai-local.yml` (fake-deepseek/ai-service/workflow-service overlay).

### 7.2. Dữ liệu, schema và migration

- Không có migration DB. Seed/test: fixture `fake-deepseek` phục vụ acceptance local; mock storage web không đổi.
- Tương thích: mọi endpoint/thay đổi đều additive; legacy extract definitions publish được (acceptance #7).

### 7.3. Cấu hình, hạ tầng và dependency

- Overlay dùng env: `DEEPSEEK_API_KEY/MODEL/BASE_URL` (fixture), `WORKFLOW_AI_ENABLED/GENERATION_ENABLED`, `AI_SERVICE_PRIVATE_URL`, `WORKFLOW_AI_SIGNING_KEY_ID/LOCATION` (`file:/run/weav-keys/workflow-service.pem` mount từ `./tmp/service-keys`).
- `.env` copy từ main checkout để `compose config` sạch warning; đã xác nhận ignored, không commit, không thêm biến mới (`.env.example` không đổi).
- Không thêm dependency runtime mới (fixture dùng `node:http` stdlib).

### 7.4. API, bảo mật và quan sát hệ thống

- Route: `POST /v1/:operation` (AI Service, Service JWT), `POST .../workflows/generate` (Workflow, đã auth) — Gateway route (spec §9) **absent**.
- Security: key dev chỉ dùng local (`tmp/`, mode 0600, gitignored); scratch-key test (scenario 6) đã chạy trong Part B (401 cả 4 case).
- Validation/error: closed error codes (`AI_OUTPUT_INVALID`, `AI_PROVIDER_UNAVAILABLE`, `AI_TIMEOUT`, `AI_BUSY`, `UNAUTHENTICATED`…).

## 8. Danh sách file ảnh hưởng

| Loại    | Đường dẫn                                                                    | Thay đổi chính                              | Lưu ý cho người tiếp nhận              |
| ------- | ---------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------- |
| `Thêm`  | `scripts/ai-dev-keys.mjs`                                                    | Sinh RSA + JWKS dev                         | Chạy 1 lần; không commit output        |
| `Thêm`  | `services/ai-service/test/fixtures/fake-deepseek.mjs`                        | Fake provider 18080                         | Part B đã dùng qua compose overlay     |
| `Thêm`  | `compose.ai-local.yml`                                                       | Overlay 3 services                          | `config` + `up` Part B đã chạy (stack rút gọn) |
| `Thêm`  | `docs/work_logs/K/ai-service/2026-09-30-ai-service-v1.md`                    | File này (gộp 3 log cũ)                     | Log duy nhất của AI Service V1         |
| `Sửa`   | `services/ai-service/src/**` (Tasks 1–4)                                     | Domain/adapter/use-cases/routes             | Lint drift pre-existing, đừng `--fix`  |
| `Sửa`   | `services/workflow-service/**/ai/**`, executors, generation (Tasks 5–9)      | Policy/signer/executor/compiler/endpoint    | Verify tại 09a2331: 439 pass           |
| `Sửa/Xóa`| `apps/web/src/**`, `apps/web/e2e/**` (Task 10)                              | Builder AI + e2e (R7)                       | 5 lint errors pre-existing             |

Không liệt kê `.env`, `tmp/service-keys/*` (ignored, không review).

## 9. Kiểm tra và bằng chứng

| Hạng mục          | Lệnh / thao tác tái lập                                                                 | Kết quả thực tế                              | Phạm vi và giới hạn                  |
| ----------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------ |
| ai-service unit   | `pnpm --dir services/ai-service test`                                                   | `PASS` 66/66 (4 suites)                      | T11-A re-run                         |
| ai-service e2e (F1 follow-up) | `pnpm --dir services/ai-service test:e2e`                                         | `PASS` 21/21 (18 cũ + 401 cả-thiếu-header RED→GREEN + 2 case 400 với token hợp lệ) | Verify JWT trước X-Request-ID |
| ai-service e2e    | `pnpm --dir services/ai-service test:e2e`                                               | `PASS` 18/18                                 | T11-A re-run                         |
| ai-service build  | `pnpm --dir services/ai-service build`                                                  | `PASS` exit 0                                | `nest build`                         |
| ai-service eslint | `exec eslint "{src,test}/**/*.ts"` (read-only, không `--fix`)                           | 148 errors / 16 files, pre-existing          | Prettier drift + verbatim test code  |
| web tsc           | `pnpm --dir apps/web exec tsc --noEmit`                                                 | `PASS` exit 0                                | T11-A re-run                         |
| web build         | `pnpm --dir apps/web build`                                                             | `PASS` (chỉ chunk-size warning cũ)           | T11-A re-run                         |
| web e2e (T10)     | `VITE_API_MODE=mock playwright test e2e/ai-builder.spec.ts e2e/workflow-catalog-v1.spec.ts --project=chromium` | 10 passed, 1 skipped (`AI_E2E` gate) | Chromium only                        |
| fixture smoke     | `node fake-deepseek.mjs` + curl từng scenario (trừ slow)                                | 200 + đúng body ×7, 401 ×1                   | §9 chi tiết dưới                     |
| compose config    | `docker compose -f compose.yml -f compose.dev.yml -f compose.ai-local.yml --profile app config --quiet` | exit 0, 0 warning | Part A chỉ `config`; `up` đã chạy ở Part B |
| diff check        | `git diff --check`                                                                      | clean                                        |                                      |
| graph changes     | `node /t/Weav/.gitnexus/run.cjs detect-changes --scope all --repo /t/Weav`              | "No changes detected" (advisory)             | Phản ánh main checkout, không phải worktree |
| workflow verify   | Coordinator chạy tại 09a2331                                                            | 439 tests, 0 failures, 3 lỗi môi trường cũ   | T11-A không chạy lại Maven           |

### Final verification (nhánh tích hợp `95a7d76`, cả 4 lane đã merge)

| Hạng mục | Kết quả |
| -------- | ------- |
| ai-service unit / e2e / build | 66/66 · 21/21 · exit 0 |
| web `tsc --noEmit` / build | exit 0 / exit 0 |
| Playwright chromium (`VITE_API_MODE=mock`) `ai-builder` + `workflow-catalog-v1` | 10 passed, 1 skipped (generate: thiếu Gateway route) |
| workflow `mvnw verify` | 439 tests, 0 failures, 3 lỗi môi trường đã biết (chạy tại `09a2331`; lane D không đổi Java) |
| `git diff --check 76cc791..HEAD` | clean |

Lưu ý: chạy Playwright không có `VITE_API_MODE=mock` sẽ fail 8 test (web gọi API thật, không có backend) — là lỗi thiết lập lệnh, không phải regression.

### Fake-deepseek smoke (T11-A, 8/9 markers; `scenario:slow` bỏ qua wait 70s)

- `needs-input` → 200, content `needs_input` + question `URL`/`ping.config.url`.
- `unsupported` → 200, content `unsupported` + `CAPABILITY_UNAVAILABLE`.
- `invalid` → 200, content `not json` (raw).
- `auth` → 401.
- generate (no marker) → 200 ready intent `start→ping→sum` (`https://example.com`, `{{nodes.ping.output.body}}`, 200).
- extract (no marker) → 200 object từ schema (`sample`/`1`/`true`/`[]`/recurse).
- classify (no marker) → 200 `categories[0]` + confidence 0.9.
- summarize (no marker) → 200 `{"summary":"Tóm tắt 👍"}`.

### Điều chưa được kiểm tra

- Playwright firefox/webkit; `AI_E2E=1` generate case (chờ Gateway route).

## 10. Sự cố, rủi ro và blocker

| Mức độ        | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| ------------- | ------ | ---------------------- | ------------------- | --------------------------- |
| `Trung bình` | F3: Workflow không cancel AI call khi client disconnect (V1 known limitation) | Gen `4a16ad8c` chạy tới `AI_TIMEOUT` 59 997 ms sau abort 2 s; generation đồng thời cùng workspace trong ~60 s có thể 503 `AI_UNAVAILABLE` | AI-side release đã verify trực tiếp (2 020 ms); cần Workflow-side change hoặc quyết định spec | Workflow lane / backlog |
| `Trung bình` | Gateway generate route absent mọi branch (2026-09-30) | Search `workflow.module.ts` không có route | Generate e2e skip; ghi handoff | Partner team; re-check khi route có |
| `Thấp` | Local-only rate và admission limits | Theo plan (Task 11 Step 6) | Ghi nhận (Part B không phát hiện thêm) | AI lane |
| `Thấp` | Model self-reported confidence | Theo plan (Task 11 Step 6) | Ghi nhận | AI lane |
| `Thấp` | Coarse `GenerationRateLimiter` eviction | Theo plan (Task 11 Step 6) | Ghi nhận | AI lane |
| `Thấp` | Lint đỏ pre-existing (web 5, ai-service 148) | Blame-chứng minh trước 09a2331 | Không sửa trong scope này | Backlog |

### Minor đã hoãn (từ review từng task, chưa sửa)

- AI Service: độ dài description/tên property đếm theo UTF-16 (khớp `String.length()` phía Java); fixture chưa có case `required` trùng hoặc `enum` rỗng/quá lớn; `deepseek-provider.ts:47` bọc `Buffer.from` thừa; `generation-result.ts:18` không đối chiếu `from`/`to` của edge với `intent.nodes` (theo plan, Workflow kiểm topology); F4: client disconnect được log là `AI_TIMEOUT` (nên có `CLIENT_CLOSED`).
- Workflow: dòng trống thừa `DefinitionValidator.java:611`; field `properties` không dùng ở `WorkflowServiceJwtIssuer.java:21`; `IntentCompilerTest` thiếu case layout nhánh (y-offset), sort/dedup nhiều loại connection, map/invalid edge port; `IntentCompiler.java:65` và `WorkflowGenerationService.java:52` không null-guard `connections` (an toàn vì controller đổi null thành `Map.of()`); commit `a536d27` có chuỗi `\n\n` literal trước trailer.
- Web: `getPublishBlockers` (`WorkflowBuilderPage.tsx:170-208`) không chặn AI node chưa cấu hình ở client (server `validatePublish` vẫn từ chối); `GenerateWorkflowPanel.tsx:94-113` thiếu focus trap/autoFocus; `OutputSchemaEditor.tsx:16-27` xóa trắng textarea báo "JSON không hợp lệ" thay vì cho reset.
- Lint: `pnpm --dir services/ai-service lint` là `eslint --fix` và format lại file của Tasks 1–3 (prettier drift); cần một commit format riêng hoặc bỏ `--fix`.

### Lỗi có thể tái lập

```text
[web lint] 5 errors pre-existing (react-hooks/set-state-in-effect ×4, no-useless-assignment ×1) — blame b44332d9/01d4f444.
[ai-service eslint] 148 errors/16 files, 135 prettier-fixable — drift từ Tasks 1–3, reviewer đã xác nhận là --fix output thuần túy.
```

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Part B đã chạy xong (§11 "Live acceptance"); nếu chạy lại: `docker compose -f compose.yml -f compose.dev.yml -f compose.ai-local.yml --profile app up -d --build`, rồi chạy 7 scenarios.
2. Re-check Gateway route rồi chạy `AI_E2E=1 pnpm --dir apps/web exec playwright test e2e/ai-builder.spec.ts`.

### Bật DeepSeek thật (sau khi gộp log, 2026-09-30)

Trước đó, cấu hình AI của Workflow (bật cờ, URL, key ký) chỉ có trong overlay fixture `compose.ai-local.yml`, nên chỉ điền `DEEPSEEK_API_KEY` vào `.env` là không đủ. Đã chuyển vào `compose.dev.yml` (mặc định tắt) và tách key dev thành `tmp/service-keys/public/` (JWKS, chỉ mount vào ai-service) và `tmp/service-keys/private/` (private key, chỉ mount vào workflow-service). Mount theo thư mục nên thiếu key chỉ làm AI not-ready, Docker không tạo nhầm thư mục thay cho file như với mount từng file.

1. `node scripts/ai-dev-keys.mjs` (một lần; ghi đè cặp key dev).
2. Trong `.env` (không commit): `DEEPSEEK_API_KEY=<key từ DeepSeek console>`, `DEEPSEEK_MODEL=<model id, ví dụ deepseek-chat>`, `WORKFLOW_AI_ENABLED=true`, `WORKFLOW_AI_GENERATION_ENABLED=true`.
3. `docker compose -f compose.yml -f compose.dev.yml --profile app up -d --build` (không kèm `compose.ai-local.yml`, overlay đó thay provider bằng fixture).
4. Kiểm `curl http://localhost:3001/health/ready` → `{"status":"ready"}`.

### Kiểm thử với DeepSeek thật (2026-09-30, model `deepseek-flash`)

Stack rút gọn không có overlay fixture; cờ AI bật bằng biến môi trường shell khi chạy lệnh (`.env` vẫn để `false`). Key hợp lệ (`GET /models` → 200; key có `deepseek-flash`, `deepseek-v4-pro`).

- **Node AI:** một workflow chạy song song summarize + classify + extract trên email đặt hàng tiếng Việt → SUCCESS trong 11 s. Summary đúng; classify `order` 0.98; extract đủ trường, `deliveryDate` chuẩn hóa `2026-10-05`. Extract lần 1 bị `AI_BUSY` (giới hạn 2 call/workspace, 3 node chạy cùng lúc), Workflow retry lần 2 thành công (R6). Mỗi call DeepSeek 0,8–1,1 s.
- **Generate — lỗi tìm thấy và đã sửa trong prompt `GENERATE_SYSTEM`:**
  1. Model trả cron 5 trường (`0 8 * * *`), Workflow chỉ nhận 6 trường (`SpringScheduleValidation`) → `INVALID_INTENT`.
  2. Model tham chiếu `output.body`; output thật của `http.request` là `{status, data}` (lỗi giống F2) → sẽ `MAPPING_ERROR` lúc chạy.
  3. Workflow V1 bắt buộc có một `trigger.manual` khi publish (`MANUAL_TRIGGER_REQUIRED`); prompt không nói → workflow chỉ có schedule bị từ chối.
  4. Model tự thêm header `Accept: text/plain`; GitHub trả 415 → `HTTP_BUSINESS_REJECTED`.
  Đã thêm vào prompt: output của từng loại node, định dạng cron 6 trường, luật một manual trigger (schedule/webhook đi kèm), và chỉ đặt field tùy chọn khi người dùng yêu cầu. Fixture `fake-deepseek` cũng sửa `output.body` → `output.data`.
- **Sau khi sửa:** "Mỗi sáng 8 giờ, gọi https://api.github.com/zen rồi tóm tắt" → `ready` (manual + schedule `0 0 8 * * *`, GET không header, summarize `output.data`) → publish 200 → chạy SUCCESS. "Every weekday at 17:30 … classify as advice or joke" → cron `0 30 17 * * 1-5`, chạy SUCCESS (`advice` 0.95). Prompt mơ hồ "Gửi email nhắc họp mỗi thứ hai" → `needs_input` hỏi SCHEDULE + người nhận. Generate mất 2–3 s.
- Unit 66/66, e2e 21/21 sau mỗi lần sửa prompt. Tài khoản thử `ai-v1-deepseek-*@example.test` và `ai-v1-keylayout-*@example.test` còn trong DB dev.

### Cần quyết định / quyền truy cập từ người khác

- Partner team: Gateway generate route (spec §9) có chưa? Nếu có, scenario 5 mới chạy được.

### Hướng dẫn cho AI agent tiếp theo

- Đọc file log này, spec, plan (Task 11) và `git status` trước khi sửa.
- Giữ nguyên các quyết định §6; không chạy `pnpm --dir services/ai-service lint` (nó `--fix` và rewrite file).
- Không `up`/`build` container khi chưa duyệt; không commit `.env`/`tmp/`.
- Không hiển thị secret hoặc đưa giá trị `.env` vào chat, log, commit hay fixture.
- Log này đã cập nhật Part B ở §11 (kết quả quan sát thay 7 PENDING).

### Live acceptance (Part B) — DONE 2026-09-30 (coordinator live run, stack rút gọn, base `81360eb`)

Stack rút gọn: rabbitmq (container đổi tên `weav-rabbitmq-laned` qua `tmp/compose.laned-name.yml` gitignored để tránh clash với container stopped của main project), fake-deepseek, identity, workspace, workflow, ai, api-gateway. Health: ai `/health/ready` = ready; gateway/workflow/identity/workspace 200. Account throwaway `ai-v1-acceptance-1790753999612@example.test` (đăng ký qua UI thật), workspace "AI V1 Acceptance" `3d875fcd-3ee0-4a09-8fff-63e0494fa811`. Web: lane-D Vite dev `localhost:5173` (Gateway CORS cho phép; `127.0.0.1:5174` bị chặn như expected). Notification 503 ở dashboard là expected (notification-service ngoài stack).

1. Execution success — `PASS` (sau khi sửa mapping của brief, F2): workflow `88a0f79c-b9b2-44c1-bc64-beb2a1fd77da`; run `11d4060b` FAILED tại ai.summarize (`MAPPING_ERROR`, 1 attempt, non-retryable) do brief dùng `{{nodes.<http>.output.body}}`; run `a25f19f9` với `{{ nodes.fetch.output.data }}` SUCCESS (ai.summarize attempt 1, 2.6 s).
2. Retry/non-retry — `PASS`: workflow `948d51a7`; `scenario:invalid` run `813f12c7` FAILED 1 attempt `AI_OUTPUT_INVALID`; stop fake-deepseek run `23c66761` FAILED 3 attempts `AI_PROVIDER_UNAVAILABLE` (07:45:06/12/19); restart fixture, ai `/health/ready` lại ready.
3. Timeout/lease — `PASS`: `scenario:slow` run `8b54d885` FAILED 3 attempts `AI_TIMEOUT` (~60 s mỗi attempt, 07:45:47–07:48:53); log `NODE_RETRY_SCHEDULED` ×2 + `NODE_FAILED` ×1, không fence/recover/duplicate/lease, 0 exception; run thứ hai QUEUED chờ (single worker, expected).
4. Legacy extract — `PASS`: workflow `ac359584` (chỉ `schemaDescription`) draft save + publish 200; run `36de6237` FAILED 1 attempt `CONFIGURATION_ERROR` đúng message.
5. Generation — `PARTIAL` (Gateway route absent; Workflow↔AI verify trực tiếp): `AI_E2E=1` browser spec NOT run (skipped). Gọi trực tiếp workflow `:8083` với user JWT: `needs-input` 200 (307 ms), `unsupported` 200 (231 ms), prompt ping→summarize 200 ready (246 ms), Sheets prompt → ready default (CONNECTION question không verify được với fixture; đã cover bởi `WorkflowGenerationServiceTest`); call thứ 6 trong phút → 429 `GENERATION_RATE_LIMITED`. Hygiene: log ai-service chỉ có `{requestId, operation, workspaceId, outcome, durationMs}`, 0 dòng prompt/Bearer/JWT; fake-deepseek không log body.
6. Unauthorized — `PASS` + finding F1: no token + no X-Request-ID → 400 `INVALID_REQUEST` (brief expect 401); no token + valid X-Request-ID → 401; garbage token → 401; scratch-key đúng claims → 401. F1 đã fix ở commit follow-up Part 1 (verify JWT trước, e2e 18→21).
7. Cancellation — `FAIL` ở Workflow hop / `PASS` ở AI hop (F3): abort generation `scenario:slow` qua Workflow sau 2 s, AI vẫn chạy tới `AI_TIMEOUT` 59 997 ms (gen `4a16ad8c`); 2 generations kế → một 503 `AI_UNAVAILABLE`, một 200. Gọi trực tiếp ai-service `:3001` abort sau 2 s → release admission sau 2 020 ms; 2 calls kế đều 200 (đúng spec §5 / acceptance #5).

#### Findings F1–F4 và disposition

- F1 (auth order): `ai.controller.ts` check X-Request-ID trước `verifier.verify()` → unauthenticated thiếu header nhận 400 thay vì 401. **Fixed** ở commit follow-up Part 1 (verify JWT ngay sau `AI_NOT_CONFIGURED` + operation checks; e2e RED→GREEN, 21/21).
- F2 (brief mapping): scenario brief dùng `output.body`, nhưng `http.request` output là `{data, status}` → dùng `output.data`. Lỗi text brief, product fail-closed đúng. Không đổi code.
- F3 (design, Workflow): Workflow không propagate client disconnect tới AI call (generate path và có thể node-execution path). V1 known limitation đã document; AI-side release đã verify trực tiếp. Impact: generation đồng thời thứ hai cùng workspace trong ~60 s có thể nhận 503 `AI_UNAVAILABLE`. Cần Workflow-side change hoặc quyết định spec — xem rủi ro §10.
- F4 (observability minor): ai-service log client disconnect là `AI_TIMEOUT`; phân biệt `CLIENT_CLOSED` cho log chính xác — **deferred** (backlog).

#### Gateway handoff

- Route `POST /api/v1/workspaces/:id/workflows/generate` absent trên mọi branch (2026-09-30) → `AI_E2E=1` browser spec NOT run; Workflow↔AI đã verify trực tiếp bằng user JWT. Partner team own route (spec §9).

Tear down Part B: `docker compose -f compose.yml -f compose.dev.yml -f compose.ai-local.yml --profile app down`.

## 12. Tham chiếu

- `docs/superpowers/specs/2026-09-25-ai-service-v1-design.md` (binding; §10 decisions, §7.9 acceptance, §9 Gateway handoff)
- `docs/superpowers/plans/2026-09-25-ai-service-v1.md` (11 task, test-first)
- Commits: `97eeec8`+`2ebbe56` (T1) `d5e17ca` (T2) `c3c2e85` (T3) `87acc5a` (T4) `a536d27` (T5) `3075c7c` (T6) `9651d5d`+`1827fa8` (T7) `fc27d44` (T8) `67f429b`..`50e193a` (T9) `3baddc1`+`63bea41` (T10) `691e83e`..`9e2a3c7` (T11)
- Merges: `b31c1e9` (lane A) `cf76153` (lane B) `09a2331` (lane C) `95a7d76` (lane D)

## 13. Kết thúc session

| Trường                     | Giá trị                                        |
| -------------------------- | ---------------------------------------------- |
| Thời điểm dừng             | `2026-09-30 ~15:30 Asia/Saigon`                |
| Trạng thái worktree        | Lane worktrees và nhánh `feature/ai-impl-lane-*` đã xóa (đã merge hết); SDD workspace đã xóa sau khi gộp vào file này |
| Commit/PR đã tạo           | Toàn bộ trên `feature/ai-service-impl` (xem §12); chưa push, chưa tạo PR |
| Người cập nhật log         | `Coordinator (gộp 3 log + report task)`        |
| Cần đọc trước khi tiếp tục | §10 (rủi ro, Minor đã hoãn), §11 (Gateway handoff, F3) |

---

## Checklist trước khi đóng log

- [x] Tóm tắt nói rõ kết quả và phần chưa hoàn thành.
- [x] Mọi quyết định ảnh hưởng thiết kế đều có lý do.
- [x] File thay đổi và migration/dependency quan trọng đã được nêu.
- [x] Có lệnh hoặc thao tác tái lập cho các kiểm tra đã tuyên bố.
- [x] Rủi ro, blocker và next step có chủ sở hữu hoặc hành động rõ ràng.
- [x] Không có secret, token, connection string nhạy cảm hoặc PII không cần thiết.
- [x] Trạng thái commit/PR và worktree là chính xác tại thời điểm ghi.
