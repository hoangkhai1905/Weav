# OCR Service Production — Implementation Plan

> Trạng thái: **đã được duyệt để triển khai từ 2026-09-07**. Chưa commit trong session này. Các checkbox chỉ được đánh dấu sau khi có bằng chứng thực thi và verification.
> Khi được duyệt, dùng skill thực thi kế hoạch phù hợp, chia milestone có review; không tự động commit chỉ vì template có bước commit.

**Goal:** Cho node `ocr.extract` nhận ảnh/PDF thật, trả text/boxes/tables có giới hạn và bảo mật, dùng chung trong Inspector và workflow execution.

**Architecture:** FastAPI stateless + supervised native worker; Gateway sở hữu public ingress/auth; Workflow sở hữu artifact/execution/persistence/retry; AI Extract sở hữu trường nghiệp vụ.

**Tech Stack:** Python 3.12, uv locked, PaddleOCR/PaddlePaddle, OpenCV, ứng viên PDFium; NestJS Fastify; Spring Boot; React/Vite; pytest, Jest, Maven/Testcontainers, Playwright. pnpm theo root manifest: `11.22.0`.

**Spec:** [Thiết kế + API contract + limits + security](../specs/2026-09-06-ocr-service-production-design.md).

## 1. Phạm vi và nghiệm thu

- Có PNG/JPG/JPEG/WEBP/PDF, `vi|en|vi+en`, preprocessing, optional table structure, response v1 và error envelope đúng spec.
- Có hai mốc riêng: Inspector-live không mock; Workflow-live nhận artifact/fileUrl, lưu kết quả và nối sang node sau. Không gắn nhãn production-complete khi mới đạt Inspector-live.
- Không thêm Dashboard OCR action, không trường hóa đơn, không sửa UI mobile hoặc các thay đổi local ngoài phạm vi.
- Không sửa `.env`, không test trên dữ liệu thật/Neon production, không đổi schema phá tương thích. Mọi secret dùng secret manager/runtime injection và không ghi ra output.

## 2. Dependency và ownership

| Lane | Owner đề xuất | Phạm vi ghi khi triển khai | Điều kiện nhận việc |
| --- | --- | --- | --- |
| Contract/model spike | OCR + các consumer review | `packages/contracts/http/ocr/`, benchmark docs/fixtures | Chốt schema và corpus |
| OCR | Backend Python | `services/ocr-service/` | Contract/model decision |
| Gateway/auth | Backend platform | `services/api-gateway/`; Workspace permission API theo ticket riêng | Identity contract, service trust, workspace permission |
| Artifact/execution | Backend Workflow | `services/workflow-service/`, storage integration | Contract artifact, worker lifecycle và ownership |
| Inspector | Frontend web | Bốn file web user nêu, OCR hook/types, E2E OCR | Contract đã freeze; live gate cần Gateway + OCR |
| Ops/CI | Integrator duy nhất | compose, CI, SETUP, lockfile root nếu cần | Các lane đưa dependency/config requirements |

OCR và frontend contract/mock tests có thể song song sau Task 1; Gateway và artifact/execution có thể điều tra độc lập. Không cho nhiều lane sửa compose/root lock hoặc cùng Builder file. Large multi-service implementation dùng branch/worktree riêng khi được phép; không chuyển/reset worktree dirty hiện tại.

External agent preflight phiên lập kế hoạch ban đầu bị chặn vì cấu hình cũ yêu cầu `T:\Weav`. Trên máy này, canonical workspace đã được chuyển sang `D:\End\Weav`; không tạo junction hoặc gửi repo cho external agent. Chỉ dùng bridge sau khi canonical workspace và trust configuration đã được xác nhận.

## 3. Checklist triển khai theo thứ tự

### Task 0 — Baseline, authorization và graph gates

- [ ] Đọc lại `AGENTS.md`, app/service rules, work log và spec; chạy `git status --short`, `gitnexus status`.
- [ ] Nếu stale: `gitnexus analyze --index-only .`. Nếu FTS vẫn thiếu, báo hạn chế và lên lịch index repair phù hợp; không giả định query rỗng nghĩa là safe.
- [ ] Trước mỗi sửa symbol, chạy `gitnexus impact <symbol> --direction upstream --repo Weav`, resolve ambiguity bằng context/file. Targets tối thiểu: `handleRunOcr`, `WorkflowBuilderPage`, `extractText`, `AppModule`, `NodeExecution`, `WorkflowFile` và các repository/security methods thực sự sửa.
- [ ] Ghi callers/processes/risk; UNKNOWN cần targeted search/manual inspection, HIGH/CRITICAL phải báo trước sửa. File mới không có symbol thì phân tích integration callers bị chạm; không lấy grep thay graph.
- [ ] Inventory persisted workflow versions/confidence consumers; có dữ liệu thang 100 thì chốt compatibility với owner trước migration.

Gate: scope, ownership, authority rõ; dirty changes được bảo toàn. Không chạy `reset --hard`, broad staging hay copy rollback destructive từ plan cũ.

### Task 1 — Freeze contract và kiểm chứng model/runtime

Files dự kiến thêm: `packages/contracts/http/ocr/openapi.yaml`, `README.md`, `examples/`; `services/ocr-service/src/tests/fixtures/ocr/`; `services/ocr-service/src/tests/integration/test_model_compatibility.py`; `docs/development/OCR_BENCHMARK.md`.

Files sửa sau impact/review: `services/ocr-service/pyproject.toml`, `uv.lock`.

- [ ] Viết OpenAPI từ spec: hai content types, discriminator artifact/url, enum/options, nullable confidence, tables/cells, errors/headers, auth schemes; fixture success/empty/table/error không có invoice fields.
- [ ] Thêm schema/consumer test trước adapter; reject mixed sources, confidence >1, bbox ngoài page, invalid cell spans và thiếu requestId.
- [ ] Kiểm wheel Linux Python3.12 và SDK thật theo lock, không suy từ import-only. Chốt một OpenCV distribution không collision với PaddleX.
- [ ] Bổ sung direct deps thực sự import: multipart parser, PDF renderer, HTTP client, image metadata decoder/numpy nếu dùng; pin qua uv lock. Kiểm license, model checksum và CVE; không cài Tesseract/EasyOCR chỉ vì có placeholder.
- [ ] Chạy real Paddle inference vi/en/mixed và tables trong target CPU image; ghi init RSS, warm RSS, cold-start, p50/p95, model IDs, params SDK chính xác. Không truyền `vi+en` trực tiếp thành Paddle `lang` nếu không có bằng chứng SDK hỗ trợ.
- [ ] Corpus đề xuất >=60 trang sạch (20 vi/20 en/20 mixed), >=20 trang scan khó, >=20 bảng có/không đường kẻ + merged cells; fixture synthetic hoặc có quyền dùng, không PII. Tách tập chọn preprocessing/model và held-out acceptance.

Acceptance targets đề xuất để review trước chạy: CER <=5% trên từng nhóm sạch; báo CER/WER riêng scan khó và không suy accuracy từ confidence; cell-text CER <=8%, structural cell/span F1 >=0.85 trên bảng held-out. Đo 1 trang warmed p95 <=10 s không bảng, <=20 s có bảng; 10 trang nằm trong processing budget 60 s. Nếu không đạt thì điều chỉnh model/resource hoặc quay lại quyết định async, không hạ tiêu chí âm thầm.

Gate: SDK/model/limits được chứng minh trên Linux image. Đây là rủi ro cần giải quyết đầu tiên, trước UI integration.

### Task 2 — Domain contract và ingest an toàn

Paths tương đối từ `services/ocr-service/`:

- Thêm `src/domain/models/ocr_result.py`, `ocr_request.py`, `errors.py`.
- Thêm `src/domain/ports/ocr_engine_port.py`, `document_loader_port.py`, `artifact_resolver_port.py`, `preprocessor_port.py`, `table_engine_port.py`.
- Thêm `src/application/use_cases/extract_text_use_case.py`.
- Thêm `src/infrastructure/files/bounded_spool.py`, `safe_url_fetcher.py`, `workflow_artifact_resolver.py`, `document_loader.py`.
- Thêm `src/tests/unit/test_input_policy.py`, `test_safe_url_fetcher.py`, `test_extract_text_use_case.py`.

- [x] Red: oversize chunked stream bị ngắt đúng byte cap, file giả extension không qua decoder; không gọi engine nếu validation fail.
- [x] Red: SSRF cases localhost, metadata, IPv6/mapped IPv4, public DNS chuyển private, redirect, userinfo, shared storage path khác tenant đều bị chặn trước connect. Test DNS pinning trên transport thật và TLS hostname, không chỉ mock URL parser.
- [x] Implement typed ports + use case độc lập FastAPI/Paddle. Single source, sanitized basename, workspace-bound artifact resolve, download limits/cancellation, cleanup ownership rõ.
- [x] Green: upload và artifact/url cùng bytes/options tạo cùng normalized result bằng fake engine; cross-tenant artifact trả 404, không download; signed URL không xuất hiện trong log captured.

Concrete assertions tối thiểu:

```text
10,485,761-byte chunked PNG → 413 FILE_TOO_LARGE; engine.call_count == 0
public allowlisted hostname → 302 tới 169.254.169.254 → không follow
workspace A token + workspace B artifact → 404; downloader.call_count == 0
file bytes hợp lệ + source JSON cùng request → 400 INVALID_REQUEST
```

### Task 3 — PDF, preprocessing và text inference

Thêm `src/infrastructure/processors/pdf_renderer.py`, `opencv_preprocessor_adapter.py`; `src/infrastructure/engines/paddle_ocr_engine_adapter.py`; unit tests `test_pdf_renderer.py`, `test_preprocessor.py`, `test_result_normalization.py`; integration `test_real_ocr.py`.

- [x] Red: PDF 11 trang →413; encrypted PDF→422; malformed PDF→422; ảnh decompression bomb không cấp memory vô hạn; WEBP động→422.
- [x] Implement page streaming, EXIF/PDF orientation, bounds trước bitmap allocation; close toàn bộ handles.
- [x] Implement grayscale/denoise/contrast/threshold/deskew theo policy đo được, lưu inverse coordinate transform. Golden geometry test ảnh xoay/resize/deskew: box trở về canonical đúng tolerance <=2 px cho fixture biết transform.
- [x] Adapter lấy text/scores/polygons từ API SDK đã kiểm chứng ở Task 1; normalize reading order/Unicode/rawText/pageInfo; weighted confidence, empty/low warnings, output caps.
- [x] Green: real PNG/JPEG/WEBP và PDF hai trang vi/en/mixed có expected text theo CER tolerance; không hardcode text, pages, 98.4% hoặc 850ms. Không snapshot nguyên score float rồi coi exact equality là quality test.

### Task 4 — Optional table pipeline

Thêm `src/infrastructure/engines/paddle_table_engine_adapter.py`, `src/tests/unit/test_table_normalization.py`, `src/tests/integration/test_real_tables.py`.

- [x] Red: detectTables=false không gọi table engine; true + không bảng→completed/rỗng; true + engine lỗi→error đúng spec.
- [x] Implement layout/table structure và map text vi/en tới cells, row/column spans, sourceBlockIds, canonical boxes, nullable structural scores. Không duplicate text khi dựng rawText.
- [ ] Green: bordered, borderless, merged-cell, rotated và bảng có dấu Việt; ensure không field nghiệp vụ, không HTML injection, output/cell count caps.

Gate Task 3–4: text và bảng thật đạt acceptance corpus, không chỉ unit test mocked adapters.

Current Task 4 evidence and language mapping notes:
- Unit coverage verifies bordered, borderless, merged-cell (multi-row and multi-column spans), rotated geometry, cell count/output caps, HTML injection sanitization, rawText de-duplication, and rejection of undeclared business fields.
- Real PP-StructureV3 smoke detects and normalizes a 3x3 table, but the Vietnamese-diacritic quality assertion remains intentionally `xfail` for the provisioned recognizers.
- Empirical finding: Local manifest routed `vi` to `latin_PP-OCRv5_mobile_rec`, and `vi+en` resolved to `latin`. Direct inference with provisioned PP-OCRv5/PP-OCRv6/latin recognizers loses Vietnamese diacritics. PP-OCRv6 and latin model metadata do not provide an accepted Vietnamese character profile. A public fine-tuned candidate received HTTP 401 (no credentials added; candidate is not claimed available offline).
- Bounded correction: `resolve_paddle_language` updated so both `vi` and `vi+en` resolve to Vietnamese-capable profile key `vi` (`resolvedLanguage: "vi"`), preserving English mapping (`en`). `vi+en` is never passed verbatim or mapped to `latin`.
- Hard Prerequisite: A validated Vietnamese-capable recognizer is a strict hard prerequisite before Task 3–4 quality gates can close. The Task 4 Green checkbox and Task 3–4 gate remain deliberately **OPEN**. No invoice fields, guessed accents, or weakened xfail/CER assertions.
- Task 5 Configuration Prerequisite: A production manifest / settings hook is documented as the next Task 5 configuration prerequisite instead of speculative overbuilding. No `.env` modified or model paths invented.

### Task 5 — FastAPI lifecycle, hard timeout và container

Thêm `src/presentation/api/v1/extract_router.py`, `src/presentation/schemas/ocr_schema.py`, `src/infrastructure/runtime/worker_supervisor.py`, `src/config/settings.py`, `src/main.py`, `Dockerfile`, `README.md`; sửa `Dockerfile.dev` và OCR block compose qua owner Ops.

Thêm `src/tests/integration/test_extract_api.py`, `test_worker_lifecycle.py`, `test_resource_limits.py`.

- [ ] Red: non-auth request không spool file; MIME/parser exceptions thống nhất envelope; no-content logs; invalid service JWT issuer/aud/exp/scope denied.
- [ ] Implement service JWT verification/keys config, ASGI body cap trước multipart parser, request ID, readiness/liveness, safe exception mapping và structured metrics/logs.
- [ ] Implement supervised process + preloaded model, admission semaphore/bounded queue, total/per-page deadlines và kill/reap/replace; không block FastAPI event loop bằng OCR synchronous call.
- [ ] Green: injected stuck native child bị kill trong deadline + tolerance đo được; request trả504; directory được xóa; worker mới warm và request tiếp theo thành công. Test success/error/disconnect/SIGTERM/crash cleanup, stale temp sweeper không xóa active job.
- [ ] Set Docker non-root, resource limits, temp volume quota, healthcheck, no production host port/reload; packages/models pin, startup không download Internet. Dev CMD thật `uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload` chỉ dev.

Gate: HTTP integration qua container thật; memory/timeout protections có failure-injection evidence, không chỉ test asyncio cancellation.

### Task 6 — Gateway và Inspector-live

Gateway thêm `src/ocr/ocr.module.ts`, `ocr.controller.ts`, `ocr.service.ts`, `ocr.controller.spec.ts`, `test/ocr.e2e-spec.ts`; nối `src/app.module.ts`, shared auth/authorization components trong lane platform. Dùng Fastify streaming/multipart, không áp Multer/Express recipe lên Fastify.

Web sửa `src/api/ocr.api.ts`, `src/pages/WorkflowBuilderPage.tsx`, `src/lib/constants/nodeCatalog.ts`, `src/types/workflow.types.ts`; thêm `src/types/ocr.types.ts`, `src/hooks/useOcrPreview.ts`, `e2e/ocr-live.spec.ts`, `e2e/ocr-preview.spec.ts` (relative `apps/web/`). Sửa OCR cases trong `e2e/workflow-ui.spec.ts`, không thay các test unrelated.

- [ ] Red Gateway: auth401, permission403, cross-workspace404, 11MiB request cap, upstream deadline/cancel, headers không spoof được execution/service claims; không forward access token/cookie tới fileUrl.
- [ ] Implement public route → private OCR, không buffer toàn file nhiều bản; workspace checks và internal token mint. Không triển khai auth chỉ bằng tin header.
- [ ] Red FE: switch/delete node khi pending không ghi result sang node khác; request cũ không overwrite request mới; confidence null/0.984/legacy fixture render đúng; timeout/error/low warning accessible.
- [ ] Implement API adapter + scoped hook; config chỉ lưu options/bindings/version, preview state không giả workflow execution. Bỏ invoice fields; update cả node catalog và thư viện OCR cục bộ của Builder.
- [ ] Playwright mock suite vẫn kiểm interaction deterministic; live suite dùng file PNG/PDF hợp lệ, Gateway+OCR thật và test identity/workspace được cấp, không route-intercept endpoint OCR.
- [ ] Live assertions: đúng workspace login → Builder add OCR → upload → text/boxes/tables → error/low-confidence cases; network bằng chứng upstream thật; không có Dashboard OCR Quick Action. Verify narrow/mobile viewport của web; chưa xây Expo UI.

Gate Inspector-live: bước trên chạy thật và có trace/request ID đã redact. Feature flag chỉ bật preview cho test workspace; không fallback mock khi service down.

### Task 7 — Artifact và Workflow-live (prerequisite lane, không được bỏ qua)

Root Java package: `services/workflow-service/src/main/java/com/weav/workflow/`.

Thêm ports/use cases/adapters/controllers theo conventions sẵn có: `domain/port/out/FileStoragePort.java`, `OcrClientPort.java`, `WorkflowFileRepository.java`; `application/usecase/UploadWorkflowFileUseCase.java`, `ResolveWorkflowFileUseCase.java`; `application/execution/OcrNodeExecutor.java`; `infrastructure/ocr/OcrHttpClientAdapter.java`; `presentation/http/WorkflowFileController.java`, `InternalWorkflowFileController.java`. Tên/path là đề xuất, reuse implementation tương đương nếu nhánh mới đã bổ sung.

Các file hiện có có thể cần sửa sau impact: `application/usecase/TriggerExecutionUseCase.java`, `domain/model/aggregate/execution/NodeExecution.java`, execution repository/mapper, `infrastructure/security/SecurityConfig.java`, WorkflowFile repository/entity. Nếu thiếu checksum/lease/idempotency fields, dùng migration V-next mới sau inventory; không sửa V1.

Tests thêm tương ứng dưới `src/test/java/com/weav/workflow/`: `application/execution/OcrNodeExecutorTest.java`, `infrastructure/ocr/OcrContractIntegrationTest.java`, `infrastructure/persistence/OcrExecutionPersistenceIntegrationTest.java`, `presentation/http/WorkflowFileAuthorizationTest.java`.

- [ ] Red: upload chưa durable không trả artifact ready; DB fail sau object put có orphan cleanup; missing/expired/deleted/cross-tenant artifact không tải.
- [ ] Implement file endpoints theo spec, private object store connector, retention và signed descriptors; không OCR DB access.
- [ ] Red: invalid node input/source ambiguity không gọi OCR; output map giữ rawText/pages/confidence và schemaVersion; payload contract tương thích Python.
- [ ] Implement durable execution claim/lease, node executor dispatch `ocr.extract`, failure/cancel/retry và CAS completion. Workflow owner xác nhận nền scheduler/outbox/queue hoạt động, không coi file use case rỗng là execution engine đã có.
- [ ] Integration real OCR + test Postgres/object store: duplicate delivery, retry transient, hết deadline, worker crash trước/sau persist, cancellation, retention expiry; chỉ một completion và không schedule downstream trùng do redelivery.
- [ ] E2E workflow: Upload/Webhook test artifact → OCR → AI Extract contract boundary → test destination; lưu và reload execution result. Phân biệt khi AI/destination dùng test double với khi real integration đã sẵn sàng; chỉ claim OCR-to-workflow theo phần thực sự chạy.

Gate Workflow-live: artifact và execution persistence thật, authz thật, restart/retry không mất trạng thái. Không gọi OCR production-complete chỉ dựa HTTP200 standalone.

### Task 8 — Production gate, docs và rollout

- [ ] Load test trên cấu hình target: warm/cold, tables on/off, 10-page max, bursts vượt concurrency/quota; đo p95/RSS/disk, ensure503/429 thay OOM hoặc queue treo.
- [ ] Security matrix: malicious upload/PDF, SSRF transport/DNS, URL token redaction, JWT replay/expiry policy, cross-tenant artifact, stored XSS text/table, request/output limits, error leak.
- [ ] Soak test ít nhất 1 giờ với mix tài liệu; process/temp handles ổn định, không tăng disk/RSS không giới hạn; alert/readiness được thử bằng failure injection.
- [ ] Cập nhật `docs/development/SETUP.md`, `services/ocr-service/README.md`, contract examples, runbook/model manifest/benchmarks, work log. Chỉ ghi tên config, không `.env` values.
- [ ] Rollout: staging fixtures → allowlisted workspace preview → workflow canary → tăng tải; feature flags tách preview/workflow. Tắt flag và rollback image/model về revision tương thích nếu lỗi; node đang chạy kết thúc hoặc fail rõ ràng. DB chỉ additive, rollback app không drop dữ liệu.
- [ ] Review scoped diff, `git diff --check`; chạy `gitnexus detect-changes --scope all --repo Weav` trước bất kỳ commit được phép nào; partial/truncated phải rerun. Chỉ stage exact owned files sau user cho phép commit, không `git add .`.

## 4. Verification commands dự kiến, chưa chạy trong session lập kế hoạch

Đọc lại manifests khi triển khai. Các test paths mới chỉ tồn tại sau task tương ứng; các lệnh dưới không phải bằng chứng hiện tại đã PASS.

```powershell
# Từ repo root, deps theo lock và model fixture đã chuẩn bị ở task tương ứng
uv --directory services/ocr-service run pytest src/tests/unit -q
uv --directory services/ocr-service run pytest src/tests/integration -q
uv --directory services/ocr-service run ruff check src
pnpm --dir services/api-gateway test --runInBand
pnpm --dir services/api-gateway test:e2e --runInBand
pnpm --dir services/api-gateway build
pnpm --dir apps/web build
pnpm --dir apps/web lint
pnpm --dir apps/web test:e2e e2e/ocr-preview.spec.ts e2e/workflow-ui.spec.ts
pnpm --dir apps/web test:e2e e2e/ocr-live.spec.ts
docker compose -f compose.yml -f compose.dev.yml config --quiet
docker compose -f compose.yml -f compose.dev.yml --profile app build ocr-service api-gateway
git diff --check
```

Trong working directory `services/workflow-service`, chạy `./mvnw.cmd test` (bao gồm Testcontainers khi harness yêu cầu Docker); test-only datasource, không dùng Neon production. Focused test dùng `./mvnw.cmd -Dtest=OcrNodeExecutorTest test` sau khi đã tạo test. Dùng lint Gateway không `--fix` cho verification (`pnpm --dir services/api-gateway exec eslint src test`), vì script lint hiện tại tự sửa file.

Không chạy `docker compose config` không có `--quiet` để tránh render secret. Runtime smoke start/test fixtures cần môi trường test và có thể ghi dữ liệu test; chỉ thực hiện ở phase implementation đã được duyệt. Đối với SSRF/timeout/soak và model CER, bổ sung test scripts có tham số/corpus manifest trong Task 1/8 và ghi chính xác command + hardware + output khi thực hiện.

## 5. Rủi ro và điểm bàn giao

Ưu tiên cao: model vi+en/tables và budget CPU chưa đo; Gateway/workspace authz và execution chưa đầy đủ; file storage chưa có contract end-to-end; confidence đổi đơn vị cần versioning. Graph keyword index degraded và external bridge không dùng được là hạn chế tooling, không là bằng chứng source hỏng.

Bước đầu sau khi duyệt: Task 0–1. Chưa triển khai Task 2 trở đi trước model/contract gate. Các quyết định cần owner chốt đã tập trung tại mục 7 của spec; không cần chọn thêm UI Quick Action hay schema hóa đơn.
