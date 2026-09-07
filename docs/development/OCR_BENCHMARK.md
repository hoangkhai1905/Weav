# WEAV OCR Service — Model & Runtime Benchmark Specification

**Date:** 2026-09-07
**Status:** **PARTIAL RUNTIME EVIDENCE** (Task 1 baseline plus Task 3 text and Task 4 table smoke runs; FE Builder integration complete at contract/UI test level).
**Notice:** Live offline PaddleOCR/PP-StructureV3 smoke runs have executed on the target Linux container with local non-PII fixtures. FE Builder integration is complete at the contract/UI test level (Playwright route-interception). The live authenticated Gateway/Workflow/Neon path, full latency, RSS, CER acceptance-corpus, table F1, and Vietnamese table-diacritic quality remain pending.

---

## 1. Execution Status and Pending Verification Items

As required by Task 1 of the implementation plan, the contract and compatibility test harnesses are frozen. Real model inference evidence remains **pending execution** on the target container image:

| Item | Status | Verification Dependency | Required Command |
| --- | --- | --- | --- |
| Contract Schema Freeze | **DONE** | OpenAPI 3.1.0 & unit test suite | `pytest src/tests/unit/test_ocr_contract_schema.py` |
| Non-PII Synthetic Fixtures | **DONE** | Success, empty, table, error fixtures | `src/tests/fixtures/ocr/*.json` |
| Compatibility Test Harness | **DONE** | Environment & language mapping tests | `pytest src/tests/integration/test_model_compatibility.py` |
| OpenCV Distribution Consolidation | **DONE** | Container has exactly one cv2 wheel; compatibility test passes | `docker compose ... build ocr-service` |
| Paddle CPU SDK Import | **DONE** | Python 3.12 container imports PaddlePaddle/PaddleOCR | `pytest src/tests/integration/test_model_compatibility.py` |
| Real OCR Smoke (PNG/JPG/WEBP/2-page PDF) | **DONE** | Local offline PP-OCRv5 mobile detector + Latin/English recognizers; CER smoke tolerance | `pytest src/tests/integration/test_real_ocr.py` → `5 passed` |
| Real Table Structure Smoke | **PARTIAL** | PP-StructureV3 detected and normalized a 3x3 table; unit suite verifies bordered, borderless, multi-span, rotated, rawText de-dup, cell limits, and HTML sanitization; recognizer diacritic quality remains `xfail` | `pytest src/tests/integration/test_real_tables.py` → structure pass, quality assertion `xfail` |
| FE Builder Gateway Integration | **DONE (UI/Contract)** | Typed multipart client, Inspector UI states, route-interception Playwright E2E | `pnpm --filter web test:e2e -- ocr-builder.spec.ts` → `21 passed` |
| Live Authenticated Path (FE + Gateway + Neon) | **PENDING** | Real authenticated Gateway/Workflow/Neon session | End-to-end integration test without route interception |
| Paddle CPU Cold Start | **PENDING EVIDENCE** | 2 vCPU Linux container (`libgomp1`) | Benchmark runner in Task 1/5 |
| 1-Page Text Warmed p95 | **PENDING EVIDENCE** | PP-OCRv4/v5 Latin/Vi models | Benchmark runner |
| 1-Page Table Warmed p95 | **PENDING EVIDENCE** | PP-StructureV3 table model | Benchmark runner |
| 10-Page Processing Budget | **PENDING EVIDENCE** | Supervised native worker | Bounded spool test |
| Character Error Rate (CER) | **PENDING EVIDENCE** | >= 60-page clean non-PII corpus | Evaluation script against ground truth |
| Table Structure F1 | **PENDING EVIDENCE** | >= 20-page table held-out set | Structural cell/span F1 metric |

> [!NOTE]
> **Frontend Builder Integration Status Note (2026-09-07):**
> Frontend Workflow Builder integration has completed at the contract and UI test level:
> - The typed multipart Gateway client (`POST /api/v1/workspaces/{workspaceId}/ocr/extractions`), Inspector response states (confidence `0..1`, quality, warnings, tables, typed errors), and removal of legacy `detectedFields`/invoice preview have been implemented and verified via route-interception Playwright E2E (`21 passed` on Chromium/Firefox/WebKit).
> - **Pending:** The live authenticated end-to-end path (real API Gateway + Workflow Service + Neon DB session) remains pending verification.
> - **Pending Gates:** Model inference quality gates (held-out CER/WER corpus benchmark <= 5.0%), table production gate (Vietnamese table-cell diacritic quality and structural F1 >= 0.85), and load/SLA performance gates (p95 latency and RSS budgets) remain pending backend execution.

---

## 2. Target Container Runtime & Hardware Envelope

The production OCR service worker runs inside an isolated, unprivileged container:
- **Base Image:** `python:3.12-slim-bookworm` (Linux x86_64).
- **Compute Envelope:** 2 vCPU, 4 GiB RAM allocated per replica.
- **Native OS Libraries:**
  - `libgomp1`: GNU OpenMP runtime, strictly required by PaddlePaddle CPU engine.
  - `libgl1`, `libglib2.0-0`: Required by headless computer vision operations.
  - `ca-certificates`: Required for secure outgoing TLS connections.
- **Process Model:** ASGI supervisor process managing 1 warm native child worker per replica with preloaded models.

---

## 3. Dependency & Namespace Collision Inspection

Inspection of `pyproject.toml` and `uv.lock` identified the following dependency state:

1. **OpenCV Collision Risk — resolved for the current lock:**
   - `pyproject.toml` pins `opencv-contrib-python==4.10.0.84`, matching the PaddleX optional dependency.
   - `uv.lock` no longer contains `opencv-python-headless`; the rebuilt container has exactly one OpenCV distribution.
   - The compatibility test passes in the Python 3.12 container. Re-check this invariant whenever PaddleOCR/PaddleX versions change.

2. **Placeholder Packages:**
   - The directory scaffold contains `src/providers/tesseract` and `src/providers/easyocr`.
   - **Directive:** These packages must **not** be added to dependencies. The production engine is strictly PaddleOCR/PaddlePaddle.

3. **Direct Ingestion Dependencies (for Task 2–4):**
   - Direct imports for multipart parsing (`python-multipart`), PDF rasterization (`pypdfium2`), and safe HTTP download (`httpx` or `urllib3`) are deferred to their respective implementation tasks and must only be added when actively imported.
   - PP-StructureV3 requires the locked `paddlex[ocr]` extra; it is now a direct OCR-service dependency for Task 4 table inference.

---

## 4. Model Architecture & Language Mapping Policy

The WEAV OCR API exposes three user-facing language options: `vi`, `en`, and `vi+en` (default).

### SDK Parameter Mapping
PaddleOCR's underlying inference engine does **not** support `"vi+en"` as a native language string. Passing `"vi+en"` verbatim results in an immediate SDK exception or invalid fallback.

Furthermore, empirical testing demonstrated that direct inference with provisioned PP-OCRv5/PP-OCRv6/latin recognizers loses Vietnamese diacritics because the PP-OCRv6 and `latin` model metadata do not provide an accepted Vietnamese character profile. Mapping `vi+en` to `latin` is unsafe and loses diacritics. Both WEAV `vi` and `vi+en` resolve to a Vietnamese-capable profile key (`vi`), never `latin`.

The corrected adapter mapping policy is:

| WEAV API Option | Target Engine | Model Identifier | Resolved Metadata | Rationale |
| --- | --- | --- | --- | --- |
| `vi` | PaddleOCR | `vi` | `vi` | Dedicated Vietnamese character profile with diacritics. |
| `en` | PaddleOCR | `en` | `en` | High-speed, high-accuracy recognition for pure English documents. |
| `vi+en` | PaddleOCR | `vi` | `vi` | Resolves to Vietnamese-capable profile key (`vi`) to preserve diacritics; never passed verbatim or mapped to `latin`. |

### Model Acquisition & Quality Gate Prerequisite
- **Empirical Evidence & Findings:**
  - The current local manifest routed `vi` to `latin_PP-OCRv5_mobile_rec`, and `vi+en` resolved to `latin`.
  - Direct inference with provisioned PP-OCRv5/PP-OCRv6/latin recognizers loses Vietnamese diacritics.
  - The PP-OCRv6 and latin model metadata do not provide an accepted Vietnamese character profile.
  - A public fine-tuned candidate could not be downloaded because the environment received HTTP 401. No credentials are added, and that candidate is not claimed to be available offline.
- **Hard Prerequisite:**
  - A validated Vietnamese-capable recognizer artifact (providing an accepted Vietnamese character set profile with accurate diacritics) is a strict hard prerequisite before Task 3–4 quality gates can close.
  - The Task 4 Green checkbox and Task 3–4 gate remain deliberately **OPEN**.
  - `xfail` on table diacritic quality in `test_real_tables.py` and CER assertions in `test_real_ocr.py` are strictly preserved without weakening.
  - No speculative invoice fields, post-processed guessed accents, or heuristic replacements are added.
- **Task 5 Configuration Prerequisite:**
  - The current architecture lacks a production manifest / application-settings hook (currently using test factories and instance maps).
  - Documented as the next Task 5 configuration prerequisite instead of speculative overbuilding. No `.env` file was read or modified; no speculative model names or paths were invented.

### Table Structure Pipeline
- **Engine:** PP-StructureV3 Table Recognition (SLANet / Layout Analysis + Table Structure).
- **Cell Recognition:** Must reuse the validated Vietnamese-capable recognizer (`vi`) so that Vietnamese headers and text inside table cells retain proper diacritics.
- **Current evidence:**
  - Structural normalization verified: bordered tables, borderless (wireless/whitespace-aligned) tables, complex merged cells (`rowSpan > 1`, `columnSpan > 1`), rotated coordinates, cell count cap enforcement (max 10,000 cells), table count limit (max 100 tables), HTML/script sanitization, rawText de-duplication, and strict schema validation forbidding business/accounting fields.
  - The provisioned PP-OCRv5 mobile and server recognizers produced valid cell geometry for real PP-StructureV3 smoke, but did not preserve the Vietnamese diacritics in the synthetic table smoke fixture (`xfail` in `test_real_tables.py`). A validated Vietnamese-capable recognizer artifact is a hard prerequisite; the service does not silently treat approximate text as accepted quality.
- **Constraints:**
  - Formula, chart, and general vision modules must remain disabled.
  - Cell coordinates must be mapped back to canonical page pixels.
  - Raw HTML must not be emitted in responses.

---

## 5. Performance Budgets & SLA Targets

The following targets must be satisfied during load and benchmark testing:

### Latency Budgets
- **1-Page Warmed Document (Text only):** p95 <= 10.0 seconds.
- **1-Page Warmed Document (With tables):** p95 <= 20.0 seconds.
- **10-Page Document (Maximum limit):** Total processing <= 60.0 seconds.
- **Gateway Upstream Timeout:** 100.0 seconds (hard stop at service boundary: 90.0 seconds).

### Memory & Concurrency Budgets
- **Init / Cold RSS:** <= 800 MiB.
- **Warm Inference RSS:** <= 2500 MiB (within the 4 GiB container envelope).
- **Worker Admission:** 1 active job running per replica; queue depth max 2; wait timeout <= 2.0 seconds. Exceeding requests immediately return `503 OCR_BUSY`.

---

## 6. Proposed Evaluation Corpus (>= 100 Pages Non-PII)

Benchmarking must use synthetic, open-licensed, or internal non-PII test documents. Real user documents, personal identifiable information, and real invoices must never be used.

The proposed corpus consists of:
1. **Clean Documents (>= 60 pages):**
   - 20 pages Vietnamese technical text, reports, forms.
   - 20 pages English documentation, specifications, articles.
   - 20 pages Mixed Vietnamese-English bilingual material.
2. **Challenging Scans (>= 20 pages):**
   - 5 pages with rotations (90°, 180°, 270°).
   - 5 pages with skew (1° to 10° angle).
   - 5 pages with low contrast / faded text.
   - 5 pages with multi-column reading order transitions.
3. **Table Structures (>= 20 pages):**
   - 7 pages bordered tables.
   - 7 pages borderless / whitespace-aligned tables.
   - 6 pages complex tables with merged cells (`rowSpan > 1`, `columnSpan > 1`).

### Split Strategy
- **50% Tuning Set:** Used during Task 3–4 to evaluate preprocessing filters (CLAHE, thresholding, deskew) and model choices.
- **50% Held-out Acceptance Set:** Frozen and untouched until the Task 8 Production Gate.

---

## 7. Quality Acceptance Criteria

Before declaring production readiness, the held-out acceptance set must satisfy:

1. **Character Error Rate (CER):**
   - Clean documents (vi, en, mixed): **CER <= 5.0%**.
   - Difficult scans: Report CER and Word Error Rate (WER) separately. Confidence scores must never be substituted for actual accuracy measurements.
2. **Table Quality:**
   - Cell-text CER: **<= 8.0%**.
   - Structural cell/span F1: **>= 0.85** on held-out tables.
3. **Robustness:**
   - Zero crashes, zero memory leaks across 100 consecutive requests.
   - Temporary file handles cleanly deleted upon request completion or cancellation.

## Offline OCR model provisioning

Model weights are runtime artifacts outside Git. The tracked setup script, manifest, and Compose override are:

- `scripts/setup-ocr-model.ps1`
- `services/ocr-service/config/model-manifest.json`
- `compose.ocr-models.dev.yml`

### Required Model Artifacts

All models are downloaded from verified official public sources with verified SHA256 checksums:

| Model ID | Role | Supported Profiles | Source Repository |
| --- | --- | --- | --- |
| `PP-OCRv5_mobile_det` | Text Detection | `vi`, `vi+en`, `en` | `https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det` |
| `pp-ocrv6-medium-rec-vietnamese` | Vietnamese Text Recognition | `vi`, `vi+en` | `https://huggingface.co/tieubaoca/pp-ocrv6-medium-rec-vietnamese` |
| `en_PP-OCRv5_mobile_rec` | English Text Recognition | `en` | `https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec` |

### Provisioning Instructions

On Windows, provision all required model artifacts using the portable default (`./.data/ocr-models`, Git-ignored):

```powershell
powershell.exe -NoProfile -File .\scripts\setup-ocr-model.ps1
```

Or specify a custom storage directory or specific profile:

```powershell
# Custom target directory
powershell.exe -NoProfile -File .\scripts\setup-ocr-model.ps1 -TargetRoot <HostPath>

# Selective profile provisioning ('all' [default], 'vi', or 'en')
powershell.exe -NoProfile -File .\scripts\setup-ocr-model.ps1 -Profile vi
```

The script is fully idempotent: existing files with matching SHA256 hashes are verified and skipped. Use `-Force` to force re-download.

### Running with Docker

Start the OCR service using the default model path (`./.data/ocr-models`):

```powershell
docker compose -f compose.yml -f compose.dev.yml -f compose.ocr-models.dev.yml --profile app up --build ocr-service
```

Or supply a custom host model path via environment variable without modifying `.env`:

```powershell
$env:OCR_MODEL_HOST_PATH = '<HostPath>'
docker compose -f compose.yml -f compose.dev.yml -f compose.ocr-models.dev.yml --profile app up --build ocr-service
```

### Safety and Operational Invariants

- **Fail-Fast Offline Safety:** The container mounts models at `/models` and loads configuration from `WEAV_OCR_MODEL_MANIFEST=/app/config/model-manifest.json`. If any configured model directory is absent, `load_model_profile` raises `ModelNotReadyError` immediately rather than attempting silent background network downloads.
- **Table Models Separation:** Table structure model provisioning (PP-StructureV3) remains separate and pending evaluation (cell geometry normalized; diacritic quality assertion marked `xfail`).
- **Scope Boundary:** OCR strictly extracts text, bounding coordinates, confidence scores, and reading order. Business entity extraction and invoice fields are strictly forbidden in OCR service and handled downstream by AI workflows.
