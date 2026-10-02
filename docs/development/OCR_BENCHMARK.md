# WEAV OCR Service — Model & Runtime Benchmark Specification

**Date:** 2026-09-09 (last verified evidence: 2026-09-08)
**Status:** **PARTIAL PRODUCTION EVIDENCE** (local text-OCR smoke is verified; held-out quality, table, load/SLA, and authenticated workflow gates remain open).
**Notice:** Offline PaddleOCR inference has been verified in the target Linux container with a local non-PII smoke corpus: 5 tests passed across PNG, JPG, WEBP, and a two-page PDF. The current smoke gate is CER <= 15%; it is not the production acceptance target of CER <= 5% on a held-out corpus. FE Builder integration is complete at contract/UI test level. The live authenticated Gateway/Workflow/Neon path, held-out CER/WER, table F1/diacritics, cold-start/p95/RSS, and load/SLA evidence remain pending.

---

## 1. Execution Status and Pending Verification Items

The contract and compatibility harnesses are frozen. The current state separates verified local smoke evidence from production acceptance evidence:

| Item | Status | Verification Dependency | Required Command |
| --- | --- | --- | --- |
| Contract Schema Freeze | **DONE** | OpenAPI 3.1.0 & unit test suite | `pytest src/tests/unit/test_ocr_contract_schema.py` |
| Non-PII Synthetic Fixtures | **DONE** | Success, empty, table, error fixtures | `src/tests/fixtures/ocr/*.json` |
| Compatibility Test Harness | **DONE** | Environment & language mapping tests | `pytest src/tests/integration/test_model_compatibility.py` |
| OpenCV Distribution Consolidation | **DONE** | Container has exactly one cv2 wheel; compatibility test passes | `docker compose ... build ocr-service` |
| Paddle CPU SDK Import | **DONE** | Python 3.12 container imports PaddlePaddle/PaddleOCR | `pytest src/tests/integration/test_model_compatibility.py` |
| Real OCR Smoke (PNG/JPG/WEBP/2-page PDF) | **DONE (SMOKE)** | Local offline `PP-OCRv5_mobile_det` detector, Vietnamese `PP-OCRv6_medium_rec`, and `en_PP-OCRv5_mobile_rec`; all fixtures met CER <= 15% | `pytest src/tests/integration/test_real_ocr.py -v -s` → `5 passed` |
| Real Table Structure Smoke | **PARTIAL** | PP-StructureV3 detected and normalized a 3x3 table; unit suite verifies bordered, borderless, multi-span, rotated, rawText de-dup, cell limits, and HTML sanitization; recognizer diacritic quality remains `xfail` | `pytest src/tests/integration/test_real_tables.py` → structure pass, quality assertion `xfail` |
| FE Builder Gateway Integration | **DONE (UI/Contract)** | Typed multipart client, Inspector UI states, route-interception Playwright E2E | `pnpm --filter web test:e2e -- ocr-builder.spec.ts` → `21 passed` |
| Live Authenticated Path (FE + Gateway + Neon) | **PENDING** | Real authenticated Gateway/Workflow/Neon session | End-to-end integration test without route interception |
| Paddle CPU Cold Start | **PENDING EVIDENCE** | 2 vCPU Linux container (`libgomp1`) | Benchmark runner in Task 1/5 |
| 1-Page Text Warmed p95 | **PENDING EVIDENCE** | Current `PP-OCRv5_mobile_det` + Vietnamese/English recognition profiles | Benchmark runner |
| 1-Page Table Warmed p95 | **PENDING EVIDENCE** | PP-StructureV3 table model | Benchmark runner |
| 10-Page Processing Budget | **PENDING EVIDENCE** | Supervised native worker | Bounded spool test |
| CER/WER Smoke Report | **DONE (SMOKE)** | 4 local documents / 5 test cases with per-fixture CER and WER output | `test_real_ocr.py -v -s` |
| Character Error Rate (CER) Production Gate | **PENDING EVIDENCE** | >= 60-page clean non-PII held-out corpus; target CER <= 5% | Evaluation script against frozen ground truth |
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

3. **Direct Ingestion Dependencies:**
   - Multipart parsing uses the pinned `python-multipart==0.0.32` package through Starlette's native parser.
   - PDF rasterization uses the pinned `pypdfium2>=4.30.0` package with bounded DPI/dimensions.
   - URL validation/fetching uses the service's SSRF-safe standard-library transport seams; no arbitrary outbound URL proxy is enabled by default.
   - PP-StructureV3 uses the locked `paddlex[ocr]` extra and remains a separately gated table pipeline.

---

## 4. Model Architecture & Language Mapping Policy

The WEAV OCR API exposes three user-facing language options: `vi`, `en`, and `vi+en` (default).

### SDK Parameter Mapping
PaddleOCR's underlying inference engine does **not** support `"vi+en"` as a native language string. Passing `"vi+en"` verbatim results in an immediate SDK exception or invalid fallback.

`vi+en` is a WEAV product option, not a native PaddleOCR language string. The adapter therefore resolves both `vi` and `vi+en` to the Vietnamese-capable `vi` profile; it does not pass `vi+en` verbatim and does not silently map it to `latin`. The bilingual mode is a single Vietnamese-capable recognition profile, not a dual-model ensemble. English-only documents use the dedicated English profile.

The corrected adapter mapping policy is:

| WEAV API Option | Target Engine | Model Identifier | Resolved Metadata | Rationale |
| --- | --- | --- | --- | --- |
| `vi` | PaddleOCR | `vi` | `vi` | Dedicated Vietnamese character profile with diacritics. |
| `en` | PaddleOCR | `en` | `en` | High-speed, high-accuracy recognition for pure English documents. |
| `vi+en` | PaddleOCR | `vi` | `vi` | Resolves to Vietnamese-capable profile key (`vi`) to preserve diacritics; never passed verbatim or mapped to `latin`. |

### Model Acquisition & Quality Gate Status
- **Current manifest:** `vi` and `vi+en` use `PP-OCRv5_mobile_det` plus the Vietnamese `PP-OCRv6_medium_rec` artifact; `en` uses `PP-OCRv5_mobile_det` plus `en_PP-OCRv5_mobile_rec`. The source of truth is `services/ocr-service/config/model-manifest.json`.
- **Runtime evidence:** all three recognizer profiles initialize offline in the target container, and the four-document smoke corpus passed the current CER <= 15% gate. The benchmark now prints CER/WER per fixture.
- **Artifact policy:** model weights are runtime artifacts stored outside Git and mounted read-only. WEAV does not train or host a remote OCR API in this service; it runs the configured local PaddleOCR weights.
- **Production gate:** the current evidence is a small smoke set, not the required >= 60-page held-out corpus. The production CER/WER gate therefore remains **OPEN**.
- **Unchanged constraints:** `test_real_tables.py` diacritic quality remains `xfail` where applicable; no guessed accents, invoice fields, or business extraction heuristics are added.

> **Dated correction (2026-09-09):** Earlier versions of this document described the Vietnamese profile as `latin` or reported model provisioning as pending. Those statements are obsolete for the current manifest and runtime; retain them only as historical context in the work log.

### Current Technical Parameters

| Component | Current value | Notes |
| --- | --- | --- |
| OCR SDK | PaddleOCR `3.7.x` / PaddleX `3.7.x` | Pinned through `pyproject.toml`/`uv.lock` |
| Inference runtime | PaddlePaddle `3.3.0` CPU | `enable_mkldnn=false` for the verified container |
| Computer vision | OpenCV contrib `4.10.0.84` | Exactly one OpenCV distribution in the image |
| Paddle inference flags | `use_doc_orientation_classify=false`, `use_doc_unwarping=false`, `use_textline_orientation=false` | Keeps the v1 text pipeline bounded |
| OCR call | `predict(..., return_word_box=false)` | Word-level boxes are not exposed by the current contract |
| PDF rendering | 200 DPI default; 72–300 DPI bounded | Pages are rendered and processed one at a time |
| Default preprocessing | grayscale when needed; denoise if noise metric > 7; CLAHE if std < 45 and intensity range < 120; deskew for 0.5–45 degrees; threshold disabled by default | Threshold stays opt-in to protect Vietnamese diacritics and thin strokes |
| Adaptive fallback | At most 1 extra pass per page; max upscaled dimension 3500 px; triggered by empty/very short output or low average page confidence | Uses deterministic quality scoring and inverse coordinate mapping |
| Input/output caps | 10 pages; 20 MP/page; 20,000 blocks; rawText <= 1 MiB | See contract for complete request/output limits |

The repository does not currently record parameter count, vocabulary size, training corpus, or exact model input tensor shape for the external weight artifacts. Those values must be copied from the model cards and checksum manifest before being presented as model facts; they are intentionally not guessed here.

### Table Structure Pipeline
- **Engine:** PP-StructureV3 Table Recognition (SLANet / Layout Analysis + Table Structure).
- **Cell Recognition:** Must reuse the validated Vietnamese-capable recognizer (`vi`) so that Vietnamese headers and text inside table cells retain proper diacritics.
- **Current evidence:**
  - Structural normalization verified: bordered tables, borderless (wireless/whitespace-aligned) tables, complex merged cells (`rowSpan > 1`, `columnSpan > 1`), rotated coordinates, cell count cap enforcement (max 10,000 cells), table count limit (max 100 tables), HTML/script sanitization, rawText de-duplication, and strict schema validation forbidding business/accounting fields.
  - PP-StructureV3 produced valid cell geometry in the real table smoke, but Vietnamese table-cell diacritic quality remains `xfail` in `test_real_tables.py`. Text-only OCR success does not close the table quality gate; table-cell CER and structural F1 still require a held-out evaluation set.
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

### Observed local smoke measurements

These are measurements from the current Docker development environment, not warmed p95/SLA evidence:

| Measurement | Observed value | Interpretation |
| --- | ---: | --- |
| Text OCR benchmark (`test_real_ocr.py`) | 5 passed in 197.24s total | Four documents / five test cases; includes model initialization and PDF work |
| Direct one-page Vietnamese API smoke | 22,977 ms service processing | Successful response; above the warmed 10s target, so p95/SLA remains open |
| Previous adaptive trigger experiment | 402.14s total | Triggered too many fallback passes; replaced by average-page-confidence policy |

Do not use the total test-suite duration as a per-request latency or p95 value. A dedicated warmed load runner is still required.

### Memory & Concurrency Budgets
- **Init / Cold RSS:** <= 800 MiB.
- **Warm Inference RSS:** <= 2500 MiB (within the 4 GiB container envelope).
- **Worker Admission:** 1 active job running per replica; queue depth max 2; wait timeout <= 2.0 seconds. Exceeding requests immediately return `503 OCR_BUSY`.

---

## 6. Proposed Evaluation Corpus (>= 100 Pages Non-PII)

Benchmarking must use synthetic, open-licensed, or internal non-PII test documents. Real user documents, personal identifiable information, and real invoices must never be used.

### Current smoke corpus

The verified local smoke corpus currently contains four documents: three raster images (`PNG`, `JPG`, `WEBP`) and one two-page PDF, with ground-truth text files. It is sufficient to verify file-format support and a development CER <= 15% smoke gate, but it is not large or diverse enough to represent the proposed tuning/held-out production corpus.

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

All models are downloaded from pinned public sources and verified with SHA256 checksums defined in `scripts/setup-ocr-model.ps1`. The Vietnamese recognition artifact is hosted in a public community Hugging Face repository; it is not presented as an official PaddlePaddle release:

| Model ID | Role | Supported Profiles | Source Repository |
| --- | --- | --- | --- |
| `PP-OCRv5_mobile_det` | Text Detection | `vi`, `vi+en`, `en` | `https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det` |
| `pp-ocrv6-medium-rec-vietnamese` | Vietnamese Text Recognition | `vi`, `vi+en` | `https://huggingface.co/tieubaoca/pp-ocrv6-medium-rec-vietnamese` |
| `en_PP-OCRv5_mobile_rec` | English Text Recognition | `en` | `https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec` |

### How to Read the Host Model Directory

The host model directory can contain more folders than the three artifacts listed above. A folder being present under `D:\Weav-OCR-Models` does **not** mean that WEAV selects it for every request. The runtime selection is controlled by `services/ocr-service/config/model-manifest.json`, while the provisioning script manages only the three required text-OCR artifacts.

For normal text extraction, the pipeline is:

```text
page image -> text detector -> language-specific text recognizer -> text blocks
```

The current active text path is:

| Directory | Role | Current WEAV status |
| --- | --- | --- |
| `PP-OCRv5_mobile_det` | Finds text regions and returns their bounding polygons. | **Active** for `vi`, `vi+en`, and `en`. |
| `pp-ocrv6-medium-rec-vietnamese` | Reads cropped text regions with Vietnamese characters and diacritics. | **Active** recognizer for `vi` and `vi+en`. |
| `en_PP-OCRv5_mobile_rec` | Reads cropped English text regions. | **Active** recognizer for `en`. |

The other text-OCR folders are alternatives or cached artifacts, not the current API selection:

| Directory | Role | Current WEAV status |
| --- | --- | --- |
| `PP-OCRv3_mobile_det` | Older lightweight text detector. | Alternative/legacy; not selected by the current manifest. |
| `PP-OCRv5_server_det` | Larger server-grade text detector. | Alternative; not selected by the current manifest. |
| `PP-OCRv5_server_rec` | Larger server-grade text recognizer. | Alternative; not selected by the current manifest. |
| `PP-OCRv6_medium_det` | PP-OCRv6 medium text detector. | Alternative; not selected by the current manifest. |
| `PP-OCRv6_medium_rec` | Generic PP-OCRv6 medium recognizer. | Alternative; the current Vietnamese profile uses the explicitly provisioned Vietnamese artifact instead. |
| `latin_PP-OCRv3_mobile_rec` | Older lightweight Latin-character recognizer. | Alternative/legacy; not used for Vietnamese. |
| `latin_PP-OCRv5_mobile_rec` | Latin-character recognizer variant. | Alternative; not selected for the current `en` profile. |

When `detectTables=true`, the service enters a separate PP-StructureV3 pipeline rather than simply changing the text recognizer:

```text
page image -> optional layout/orientation -> table/cell detection -> table structure -> cell text recognition
```

The following folders belong to that broader table/document-structure pipeline. Their exact loading is managed by the PaddleOCR/PP-StructureV3 SDK; the current WEAV adapter does not pin each submodel directory individually:

| Directory | Role | Current WEAV status |
| --- | --- | --- |
| `PP-DocLayout_plus-L` | Detects document regions such as text, tables, and figures. | PP-Structure dependency; region detection is disabled in the current bounded adapter. |
| `PP-LCNet_x1_0_doc_ori` | Classifies document/page orientation. | Optional helper; document orientation is disabled in the current adapter. |
| `PP-LCNet_x1_0_textline_ori` | Classifies text-line orientation. | Optional helper; text-line orientation is disabled in the current adapter. |
| `PP-LCNet_x1_0_table_cls` | Classifies table-related layout/type information. | Table-pipeline artifact; not part of ordinary text OCR. |
| `RT-DETR-L_wired_table_cell_det` | Detects cells in bordered/wired tables. | Table-pipeline artifact; production table gate remains open. |
| `RT-DETR-L_wireless_table_cell_det` | Detects cells in borderless/wireless tables. | Table-pipeline artifact; production table gate remains open. |
| `SLANet_plus` | Recognizes table structure and grid relationships. | Table-pipeline artifact; production table gate remains open. |
| `SLANeXt_wired` | Wired-table structure recognition variant. | Table-pipeline artifact; production table gate remains open. |

Therefore, the directory shown in Windows Explorer is best understood as a shared PaddleX model cache. The current text-OCR request uses one detector plus one recognizer profile. The extra folders support possible model variants or table/document analysis and are not evidence that WEAV trained or runs all of them simultaneously. Table-cell diacritic quality and structural F1 still require the held-out production gate described above.

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
