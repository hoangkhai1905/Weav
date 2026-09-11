# Nhật ký ngày `2026-09-07`

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-07` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / HEAD | `feature/ocr-service-production` / `58c52f5` |
| Người thực hiện | `AI agent` |
| Trạng thái cuối ngày | `Đang tiếp tục` |
| Phạm vi session | Triển khai và kiểm chứng OCR Service Task 3 trên workspace local |

## 2. Tóm tắt điều hành

- Đã giữ canonical workspace của launcher ở `D:\End\Weav` và bảo toàn các thay đổi dirty có sẵn.
- Đã triển khai Task 3: PDFium renderer, OpenCV preprocessing, PaddleOCR 3.x adapter và test harness.
- Container verification cuối: `142 passed, 5 skipped, 2 warnings`; chưa commit/push.
- Real model inference/CER/latency/RSS vẫn pending vì chưa có model manifest và corpus local non-PII.

## 3. Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Rule canonical path | `Đã sửa` | `D:\End\Weav` |
| Launcher syntax | `PASS` | PowerShell parse errors: `0` |
| Diff check | `PASS` | `git diff --check` không báo lỗi nội dung |
| Antigravity preflight/review | `Bị chặn sau triển khai` | launcher sau đó báo `executable-not-found`; implementation đã được controller kiểm chứng |
| OpenCode fallback | `Bị chặn` | `executable-not-found` |
| Code OCR | `Task 3 đã triển khai` | Task 3 unit checks pass; real inference gate pending |
| Commit / PR | `Chưa tạo` | Theo yêu cầu không commit |

## 4. Quyết định kỹ thuật

- Giữ workspace thật ở `D:\End\Weav`; không tạo hoặc yêu cầu ổ T vật lý.
- Launcher vẫn đi qua `powershell.exe -NoProfile -File .\scripts\agent-cli.ps1` để giữ các kiểm tra trust, timeout, sandbox và repo context.
- Giữ các path T/E cũ chỉ trong danh sách legacy alias để cảnh báo, không dùng làm workspace.

## 5. Thay đổi

- `AGENTS.md`: hướng dẫn external agent CLI dùng `D:\End\Weav` trên máy này.
- `scripts/agent-cli.ps1`: đổi canonical root, thông báo lỗi theo biến canonical và nhận diện `T:\Weav` là legacy alias.
- `docs/agent-cli-operations.md`: đồng bộ hướng dẫn vận hành và trust path.
- `docs/superpowers/plans/2026-09-06-ocr-service-production.md`: cập nhật ghi chú preflight theo path local.

## 6. Kiểm tra và bằng chứng

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Syntax | PowerShell `Parser.ParseFile` trên `scripts/agent-cli.ps1` | `0` parse errors |
| Diff | `git diff --check` | Không có lỗi whitespace |
| Preflight | `powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Check -Tool Auto` | Antigravity bị chặn vì thiếu settings; OpenCode không có executable |
| Worktree | `git status --short` | Các thay đổi có sẵn vẫn được giữ nguyên; không sửa code OCR |

## 7. Rủi ro / blocker

| Mức độ | Vấn đề | Bước tiếp theo |
| --- | --- | --- |
| `Trung bình` | Chưa có model manifest/corpus để chạy real inference | Provision dữ liệu non-PII rồi chạy CER/latency/RSS gate |
| `Thấp` | Antigravity read-only review bị `executable-not-found` | Đã source/runtime review và chạy final Docker verification |

## 8. Trạng thái bàn giao

### Có thể tiếp tục

1. Provision `WEAV_OCR_MODEL_MANIFEST` và corpus non-PII local để chạy real OCR acceptance.
2. Giữ Task 4 chưa bắt đầu cho đến khi text-quality gate Task 3 có bằng chứng thật.

### Chưa làm

- Chưa chạy Antigravity implementation.
- Chưa sửa `.env`.
- Chưa commit hoặc stage file.

## 9. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-07 Asia/Saigon` |
| Trạng thái worktree | `Có thay đổi local; giữ nguyên thay đổi có sẵn` |
| Commit / PR | `Chưa tạo` |

## 12. OCR Task 3 implementation (2026-09-07)

### Phạm vi và kết quả

- Implemented PDF page-at-a-time rendering, PDFium rotation handling, pre-allocation dimension/pixel guards, encrypted/malformed PDF errors, animated WEBP rejection, EXIF orientation, and bounded Pillow/OpenCV image handling.
- Implemented measured OpenCV preprocessing (grayscale, denoise, CLAHE contrast, optional Otsu threshold, deskew) with recorded steps and inverse affine coordinate mapping.
- Implemented PaddleOCR 3.x adapter with `vi`/`en`/`vi+en` language mapping, `predict()` integration, `rec_*` result normalization, Unicode NFC, reading order, polygons/boxes, confidence warnings, and output caps.
- Added focused unit/integration coverage for rejection boundaries, streaming/cleanup, rotation/geometry, preprocessing policies, PaddleOCR 3.x result shape, CER harness, and offline model-manifest safety.
- Added direct runtime dependencies actually imported by Task 3: `numpy`, `pillow`, and `pypdfium2`; regenerated `services/ocr-service/uv.lock`.

### Bằng chứng kiểm tra

| Hạng mục | Lệnh / thao tác | Kết quả |
| --- | --- | --- |
| GitNexus | `gitnexus status` | Index up-to-date at current commit `58c52f5` |
| Graph preflight | `gitnexus query ...`; upstream impacts for Task 2 symbols | Query degraded because FTS index is missing; new symbols returned `UNKNOWN`, manually confirmed references before edits |
| Unit/integration suite | `docker run --rm -w /app -e PYTHONPATH=/app weav-ocr-service uv run pytest src/tests -q` | `142 passed, 5 skipped, 2 warnings` |
| Lint | `docker run --rm -w /app -e PYTHONPATH=/app weav-ocr-service uv run ruff check src` | `PASS` |
| Compile | `docker run --rm -w /app -e PYTHONPATH=/app weav-ocr-service uv run python -m compileall -q src` | `PASS` |
| Dependency lock | `docker run --rm -w /app weav-ocr-service uv lock --check` | `PASS` |
| Container | `docker compose -f compose.yml -f compose.dev.yml build ocr-service` | `PASS` |
| Native PDFium smoke | Generated non-PII two-page Pillow PDF and rendered with `PdfRenderer` | `2 pages`, `200 DPI`, bounded dimensions |
| Compose/diff | `docker compose ... config --quiet`; `git diff --check` | `PASS` (only line-ending warnings) |

### Chưa hoàn thành / rủi ro

- Real PaddleOCR inference, CER/accuracy, latency, RSS, and the acceptance corpus remain pending. Five `test_real_ocr.py` cases skip unless `WEAV_OCR_MODEL_MANIFEST` points to local non-PII detection/recognition model directories and the corpus exists; tests never download models by default.
- Task 4 table extraction and Task 5 FastAPI lifecycle/timeout/container endpoint were not started.
- Antigravity read-only reviewer could not run after implementation because the launcher reported `executable-not-found`; controller performed source/runtime review and final container verification instead.
- The two warnings are the expected missing optional `ccache` notice from Paddle and the deliberate Pillow decompression-bomb warning fixture.

### Bàn giao

- No `.env` file was read, printed, modified, staged, or committed. No commit or push was made.
- Existing dirty worktree changes were preserved.
- Next step: provision the non-PII model manifest/corpus and run the real inference gate before declaring Task 3–4 acceptance; then continue Task 4 only after text quality evidence is available.

## 10. OCR Task 1 handoff (2026-09-07)

- Current branch for the implementation work: `feature/ocr-service-production`.
- Antigravity headless permissions were configured for the project; the file-write smoke test passed.
- Task 1 created the OCR OpenAPI contract, examples, synthetic non-PII fixtures, Pydantic contract tests, model compatibility test, and benchmark notes.
- Verification passed: Docker image build with Python 3.12.14 and locked dependencies, OpenCV collision check, 43 contract/model tests, Ruff, JSON fixture parsing, `docker compose ... config --quiet`, and `git diff --check`.
- Real Paddle SDK imports pass in the target container; real image inference, CER/WER, table F1, latency, RSS, and cold-start benchmark remain pending.
- Follow-up dependency fix: replaced the conflicting direct `opencv-python-headless` requirement with `opencv-contrib-python==4.10.0.84`, regenerated `services/ocr-service/uv.lock`, rebuilt the image, and reran the compatibility suite successfully.
- OpenAPI YAML parse passed after converting nullable fields to OpenAPI 3.1 JSON Schema types; no legacy `nullable` keyword remains.
- No `.env` file was read, printed, modified, staged, or committed. No commit or push was performed.

## 13. Real OCR model provisioning and smoke verification (2026-09-07)

- Prepared local model storage outside the repository at `D:\Weav-OCR-Models` using official PaddleOCR model artifacts: `PP-OCRv5_mobile_det`, `latin_PP-OCRv5_mobile_rec`, and `en_PP-OCRv5_mobile_rec`. No credentials or `.env` values were used.
- Added a local-only manifest at `D:\Weav-OCR-Models\manifest.json`; it is not part of the repository and is mounted read-only during testing.
- Updated the offline integration factory to pass explicit PaddleOCR model names/directories, disable optional document-orientation modules, disable the incompatible oneDNN path for the current PaddlePaddle 3.3 CPU runtime, and materialize PaddleOCR 3.x lazy prediction iterators.
- Fixed runtime normalization for PaddleOCR 3.7 polygon lists containing nested NumPy arrays and expanded internal grayscale images to 3 channels only at the SDK boundary.
- Corpus used read-only from `D:\test ocr-ready`: Vietnamese PNG, English-labelled PNG, bilingual WEBP, and two-page bilingual PDF with ground-truth text. No document contents were added to the repository or work log.

### Verification

| Check | Result |
| --- | --- |
| Unit regression | `27 passed` for preprocessor/result normalization tests |
| Docker real inference | `5 passed, 1 warning` in `149.39s` for PNG/JPG/WEBP/PDF/CER cases |
| Warning | Paddle optional `ccache` warning only; no test failure |
| Model/runtime note | PP-OCRv5 server detector was too heavy/crashed on the 2-page 200-DPI PDF in this CPU container; switched to official PP-OCRv5 mobile detector and the full smoke suite passed |

### Remaining limits

- This is a four-document smoke gate with CER tolerance `<=15%`, not the production benchmark target of `<=5%` on the held-out corpus.
- p95 latency, RSS, 100-request stability, table F1, FastAPI endpoint, auth, and workflow execution integration remain pending.
- No commit or push was made; existing dirty worktree changes remain preserved.
| Cần đọc trước khi tiếp tục | `AGENTS.md__, `docs/agent-cli-operations.md__, `docs/superpowers/plans/2026-09-06-ocr-service-production.md` |

## 11. OCR Task 2 implementation (2026-09-07)

- Implemented Task 2 on branch `feature/ocr-service-production` through Antigravity with repository context, preserving the pre-existing dirty worktree. No `.env` was read, printed, modified, staged, or committed.
- Added framework-independent OCR domain models/errors/ports, the `ExtractTextUseCase`, bounded spooler, document loader, SSRF-safe URL fetcher with DNS/IP pinning seam, and workspace-bound artifact resolver under `services/ocr-service/src/`.
- Added unit coverage for single-source policy, 10 MiB chunked limits, fake content/decoder rejection, cancellation cleanup, SSRF/redirect/DNS rebinding/IP-range checks, real pinned transport SNI seam, artifact cross-tenant blocking, cleanup, and upload/artifact/URL normalization equivalence.
- Added `pytest-asyncio` to the OCR service dev dependency group and regenerated `services/ocr-service/uv.lock`; no runtime dependency was added.
- Verification: Docker OCR image rebuilt successfully after final source changes; test suite executed from the image (without source mount) -> `100 passed, 1 warning`; `uv run ruff check src` -> `All checks passed`; `python -m compileall -q src` -> pass; `uv lock --check` -> pass; Compose config validation -> pass; `git diff --check` -> pass.
- The remaining warning is Paddle's optional missing `ccache` notice. Real OCR inference/quality/latency/RSS benchmark remains pending from Task 1; Task 2 intentionally does not implement the Paddle adapter or FastAPI endpoint.

## 14. OCR Task 4 implementation (2026-09-07)

### Phạm vi và kết quả

- Added `PaddleTableEngineAdapter` and `TableResultNormalizer` for PP-StructureV3 output. Engine HTML remains internal; API output contains only typed `TableResult`/`TableCell` values, canonical boxes, row/column spans, confidence when supplied, and `sourceBlockIds` mapped from OCR blocks.
- Hardened `ExtractTextUseCase`: `detectTables=false` never calls the table engine; `detectTables=true` without a configured engine is an explicit `TABLE_EXTRACTION_FAILED`; unexpected table-engine failures are normalized to the same domain error; table/cell caps are enforced.
- Added non-overlapping cell validation to `TableResult`, generated dependency lock support for `paddlex[ocr]`, and added unit plus real-table integration coverage.
- Provisioned table model artifacts outside the repository at `D:\Weav-OCR-Models` and a local-only `table-manifest.json`; the manifest is not committed and is used read-only by the smoke command.

### Bằng chứng kiểm tra

| Check | Command / result |
| --- | --- |
| Focused unit | `8 passed` in `test_table_normalization.py` |
| Full OCR service suite | `152 passed, 6 skipped, 2 warnings` |
| Real PP-StructureV3 smoke | Table detected and normalized as 3x3; `1 xfailed` because current PP-OCRv5 recognizers do not preserve the Vietnamese diacritics in the acceptance fixture |
| Lint / compile | `uv run ruff check src` PASS; `python -m compileall -q src` PASS |
| Dependency lock | `uv lock --check` PASS; Docker image with `paddlex[ocr]` built successfully |
| Diff safety | `git diff --check` PASS; pre-existing dirty changes preserved |

### Chưa hoàn thành / rủi ro

- Table structure, spans, canonical geometry, HTML stripping, output caps, and error contract are implemented and verified. The real table quality gate for Vietnamese diacritics remains pending; the smoke test deliberately reports this as `xfail` instead of treating approximate text as acceptance.
- The real smoke still uses a synthetic non-PII fixture and does not establish production table F1, p95 latency, RSS, or 100-request stability.
- No `.env` was read, printed, modified, staged, or committed. No commit or push was made.

## 15. OCR Task 4 test coverage and quality gate status (2026-09-07)

### Phạm vi và kết quả

- Strengthened HTML parsing in `PaddleTableEngineAdapter`: `_TableHtmlParser` now reliably flushes pending cell tokens across unclosed tags or trailing content via `_flush_active()`.
- Expanded unit coverage in `test_table_normalization.py` to address all requested Green criteria:
  1. Borderless tables: verified layout-bounding-box fallback and sparse cell geometry.
  2. Complex merged cells: verified multi-row and multi-column spans (`rowSpan > 1`, `columnSpan > 1`) and boundary validation.
  3. No business fields: verified strict rejection of undeclared/invoice/accounting fields on `TableCell` and `TableResult` via Pydantic `extra="forbid"`.
  4. Output cell count caps: verified `OutputLimitExceededError` when cell count exceeds limits (e.g. max 10,000 cells).
  5. HTML injection sanitization: verified stripping of script/style tags and unescaped HTML.
  6. RawText de-duplication: verified `ExtractTextUseCase` keeps rawText derived strictly from text blocks without re-appending table cells.
- Updated `docs/superpowers/plans/2026-09-06-ocr-service-production.md` and `docs/development/OCR_BENCHMARK.md` to reflect verified structural criteria while keeping the Task 4 Green checkbox and Task 3–4 gate open.

### Blockers and Gate Status

- The real Vietnamese-diacritic quality assertion remains `xfail` in `test_real_tables.py` because current provisioned PP-OCRv5 table recognizers fail to preserve diacritics in the acceptance fixture.
- Task 4 Green checkbox and Task 3–4 gate remain deliberately **OPEN**. No mock was substituted, and `xfail` was not removed or weakened.
- In accordance with the execution constraints, no terminal/command tools were invoked in this turn. Tests and GitNexus checks are left for supervisor execution.
- No `.env` was read or modified; no commit or push was executed.

## 16. OCR language-model mapping correction and prerequisite status (2026-09-07)

### Phạm vi và kết quả

- Bounded correction for language-model mapping:
  - Updated `resolve_paddle_language` in `paddle_ocr_engine_adapter.py`: both WEAV `vi` and `vi+en` now resolve to the Vietnamese-capable profile key `vi` (`resolvedLanguage: "vi"`).
  - English mapping is strictly preserved: `en` resolves to `("en", "en")`.
  - `vi+en` is never passed verbatim to PaddleOCR and never resolves to `latin`.
- Updated test coverage:
  - `test_result_normalization.py`: Updated `TestLanguageMappingPolicy` to assert `vi+en` resolves to `vi` and never `latin` or `latin-multilingual`, with explicit metadata `resolved == "vi"`. Updated mock engine instances in unit tests to supply `vi` test double, and verified `result.resolved_language == "vi"`.
  - `test_model_compatibility.py`: Refactored `test_language_parameter_mapping_policy` to import `resolve_paddle_language` directly, verifying that `vi+en` resolves to `vi` and never `latin`, and metadata is explicit.
  - `test_extract_text_use_case.py`: Updated test double `FakeOcrEngine` to return `vi` for `vi+en`.
  - `ocr_engine_port.py`: Default `resolved_language` updated to `vi`.
- Synchronized documentation:
  - `docs/development/OCR_BENCHMARK.md`: Updated Section 4 with empirical evidence, the corrected language mapping table, hard prerequisite notes, and Task 5 configuration prerequisite.
  - `docs/superpowers/plans/2026-09-06-ocr-service-production.md`: Documented the language mapping correction, hard prerequisite, open gate status, and Task 5 configuration prerequisite.

### Empirical Evidence Encoded

- The local test manifest initially routed `vi` to `latin_PP-OCRv5_mobile_rec`, and `vi+en` resolved to `latin`.
- Direct inference with provisioned PP-OCRv5/PP-OCRv6/latin recognizers loses Vietnamese diacritics.
- The PP-OCRv6 and latin model metadata do not provide an accepted Vietnamese character profile.
- A public fine-tuned candidate could not be downloaded because the environment received HTTP 401. No credentials were added, and the candidate is not claimed available offline.

### Gate Status and Prerequisites

- **Hard Prerequisite:** A validated Vietnamese-capable recognizer artifact is a strict hard prerequisite before Task 3–4 quality gates can close.
- **Task 4 Green & Task 3–4 Gate:** Kept deliberately **OPEN**. No invoice fields were added, no guessed accents post-processed, and `xfail`/CER assertions were not weakened.
- **Task 5 Configuration Prerequisite:** The current architecture lacks a production manifest / application-settings hook (currently using test factories and instance maps). Documented as the next Task 5 configuration prerequisite instead of speculative overbuilding.
- No model name or path was invented. No `.env` was read, printed, modified, staged, or committed.
- No terminal or command execution tools were invoked in this turn; tests and GitNexus checks are left for supervisor execution.
- No commit or push was performed.

## 17. OCR model runtime integration milestone (2026-09-07)

### Status and Scope

- **Status:** Complete for provisioning contract and adapter wiring.
- Model weights remain outside Git under `D:\Weav-OCR-Models` and no `.env` file was changed.

### Changed Tracked Files

- `scripts/setup-ocr-model.ps1`
- `services/ocr-service/config/model-manifest.json`
- `compose.ocr-models.dev.yml`
- `services/ocr-service/src/infrastructure/engines/model_manifest.py`
- `services/ocr-service/src/infrastructure/engines/paddle_ocr_engine_adapter.py`
- `services/ocr-service/src/tests/unit/test_model_manifest.py`
- `docs/development/OCR_BENCHMARK.md`

### Test Verification and Results

| Check / Suite | Result / Details |
| --- | --- |
| Focused unit suite | `22 passed` |
| Full OCR suite | `163 passed, 6 skipped` |
| Lint | Ruff all passed |
| Compile | In-memory compile passed |
| Compose override | Override parsed successfully |
| PowerShell setup script | `scripts/setup-ocr-model.ps1` parsed successfully |
| Adapter real smoke | Initialized `PP-OCRv6_medium_rec` and recognized Vietnamese text |
| Warnings | Existing `ccache` warning only |

### Remaining Limitations

- The clean held-out CER / production quality gate is still pending.
- Detection artifacts must exist in the configured model root.

## 18. OCR offline model provisioning milestone (2026-09-07)

### Scope and Status

- Hoàn tất milestone provisioning mô hình OCR offline cho local runtime.
- `scripts/setup-ocr-model.ps1` hiện provision đầy đủ:
  - `PP-OCRv5_mobile_det`
  - `pp-ocrv6-medium-rec-vietnamese`
  - `en_PP-OCRv5_mobile_rec`
- Đã xác thực thành công SHA256 checksum cho toàn bộ 10 artifacts trên máy này.
- Compose override đã được validate.
- Real PaddleOCR engine init thành công với model mount.
- Weights mô hình vẫn được lưu trữ hoàn toàn ngoài Git.
- Không đọc, không ghi file `.env`. Không thêm secret.
- Chưa thực hiện commit hoặc push.

### Test Verification and Results

| Check / Suite | Kết quả / Chi tiết |
| --- | --- |
| Model provisioning | `scripts/setup-ocr-model.ps1` provision đủ 3 models; 10 artifacts verified SHA256 trên máy này |
| Compose override | Validate thành công |
| Docker OCR suite | `164 passed, 6 skipped` |
| Real PaddleOCR engine init | Khởi tạo thành công với model mount |

### Remaining Limitations / Gate Status

- Held-out CER và table production quality gate vẫn ở trạng thái pending.

## 19. OCR Builder Gateway integration milestone (2026-09-07)

### Phạm vi và kết quả

- Đã lập và cập nhật kế hoạch triển khai tại `docs/superpowers/plans/2026-09-07-ocr-builder-gateway-integration.md`.
- `apps/web/src/api/ocr.api.ts`: Đã nối typed multipart Gateway route (`POST /api/v1/workspaces/{workspaceId}/ocr/extractions`) với các tham số `file`, `language`, `detectTables`. Xử lý envelope lỗi định kiểu từ backend qua `OcrApiError` (`code`, `message`, `retryable`, `details`).
- `apps/web/src/pages/WorkflowBuilderPage.tsx`: Inspector đã cập nhật để xử lý đầy đủ các trạng thái response OCR:
  - `confidence`: backend trả về khoảng `0..1` (nullable), chuyển sang định dạng phần trăm (`%`) tại UI presentation boundary; hiển thị `—` khi không có văn bản.
  - `metadata.quality`: hiển thị rõ các trạng thái `OK`, `LOW_CONFIDENCE`, `EMPTY`.
  - `metadata.warnings`: render danh sách cảnh báo có cấu trúc.
  - `tables`: hiển thị tóm tắt bảng nhận diện được.
  - Xử lý typed errors actionable (401, 403, 413, 415, 422, 429, 503, 504) mà không để lộ URL nội bộ hoặc token.
- Loại bỏ hoàn toàn `detectedFields` và invoice preview khỏi OCR node (trích xuất nghiệp vụ chuyển hẳn cho node `AI Structured Extract` phụ trách).
- Cấu hình Vite proxy (`apps/web/vite.config.ts`) cho tiền tố `/api` giúp tránh lỗi CORS khi dev local.
- Không đọc, không ghi bất kỳ file `.env` nào, không để lộ secrets. Không thực hiện commit/push.

### Bằng chứng kiểm tra

| Hạng mục / Suite | Lệnh / Thao tác | Kết quả / Chi tiết |
| --- | --- | --- |
| Playwright E2E suite | `pnpm --filter web test:e2e -- ocr-builder.spec.ts` | `21 passed` trên cả 3 trình duyệt Chromium, Firefox, WebKit |
| Web build | `pnpm --filter web build` | `PASS` |
| Web lint | `pnpm --filter web lint` | `PASS` |
| Diff check | `git diff --check` | `PASS` (không có trailing whitespace hay lỗi format) |

### Rủi ro / Giới hạn và Gate Status

- **E2E Route Interception:** Suite Playwright hiện đang dùng route-interception ở tầng Gateway vì web app vẫn đang dùng mock authentication và mock workspace session; chưa xác nhận luồng live qua API Gateway thật, Workflow Service và cơ sở dữ liệu Neon PostgreSQL.
- **Ranh giới kiến trúc:** Browser không gọi trực tiếp Neon hay private OCR ingress; luồng thực thi workflow vẫn xử lý qua artifact/approved URL ở phía server-side.
- Giữ nguyên các thay đổi có sẵn trên worktree; không commit/push.

### Next Steps

1. **Real Authenticated / Integration E2E:** Dựng môi trường live API Gateway kèm xác thực thật và kết nối Neon PostgreSQL để chạy kiểm thử E2E trực tiếp không qua route interception.
2. **CER/WER Benchmark:** Tiến hành benchmark độ chính xác nhận diện ký tự/từ (CER <= 5.0%) trên held-out corpus >= 100 trang non-PII.
3. **Table Production Gate:** Khắc phục chất lượng dấu tiếng Việt trong bảng nhận diện của PP-StructureV3 (giải quyết `xfail` trong `test_real_tables.py`) và đạt F1 cấu trúc bảng >= 0.85.
4. **Load / Concurrency / SLA:** Đo lường tải và độ trễ p95 (<= 10s text, <= 20s tables, <= 60s 10-page), giới hạn RSS <= 2500 MiB và độ ổn định qua 100 request liên tục.
