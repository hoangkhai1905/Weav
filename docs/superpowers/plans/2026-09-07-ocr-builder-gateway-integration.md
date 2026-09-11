# OCR Builder Gateway Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Workflow Builder's mock OCR preview with the authenticated API Gateway OCR contract while preserving OCR as a Builder node and keeping Neon access server-side.

**Architecture:** The Inspector sends a multipart upload to `POST /api/v1/workspaces/{workspaceId}/ocr/extractions` through the existing web HTTP/auth conventions. The OCR response is mapped to a frontend view model without changing the backend contract: `confidence` remains `0..1`, `metadata.quality` and `metadata.warnings` drive UI state, and business-field extraction remains owned by `AI Structured Extract`. Workflow execution continues to use artifact or URL sources server-side; the browser does not connect to Neon or the private OCR ingress.

**Tech Stack:** React 19, TypeScript, Vite, Axios, React Router, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-06-ocr-service-production-design.md` and `packages/contracts/http/ocr/openapi.yaml`.

## Global Constraints

- Keep OCR as the `ocr.extract` node in Workflow Builder; do not add a Dashboard OCR Quick Action.
- The frontend must call the API Gateway public route, never the private OCR service and never Neon directly.
- OCR only returns recognized text, blocks, coordinates, confidence, tables, quality, and warnings; do not expose invoice/business `detectedFields` from OCR.
- Inspector uploads use `multipart/form-data`; workflow execution uses `artifactId` or an approved `fileUrl` JSON source.
- Backend `confidence` is a nullable `0.0..1.0` value; convert to a percentage only at the presentation boundary.
- Do not read, write, overwrite, or commit any `.env` file or secret.
- Preserve all unrelated existing worktree changes; do not commit or push.

---

### Task 1: Replace the mock OCR API with the Gateway contract

**Files:**
- Modify: `apps/web/src/api/ocr.api.ts`
- Inspect: `apps/web/src/api/client.ts` and the existing authenticated HTTP/session conventions
- Reference: `packages/contracts/http/ocr/openapi.yaml`
- Test: `apps/web/e2e/ocr-builder.spec.ts` or the repository's existing API test location

**Interfaces:**
- Consumes: `File`, selected workspace ID, `OcrConfig` with `language` and `detectTables`.
- Produces: typed `OcrExtractionResult` matching `schemaVersion`, `requestId`, `document`, `text`, `confidence`, `blocks`, `tables`, and `metadata` from the v1 contract.

- [x] **Step 1: Define the frontend contract types**

  Model the response fields used by the Inspector, including nullable confidence and warning objects. Keep `fileName` and `fileType` under `document`, and `rawText` under `text`; do not preserve the mock-only `detectedFields` property.

- [x] **Step 2: Implement multipart request construction**

  Send one `file` part plus `language` and `detectTables` to:

  ```text
  POST /api/v1/workspaces/{workspaceId}/ocr/extractions
  ```

  Reuse the existing auth/base-URL/request-ID behavior if available. Do not send a second JSON body and do not call `/v1/extractions` from the browser.

- [x] **Step 3: Preserve typed error envelopes**

  Parse `{ error: { code, message, retryable, details }, requestId }` and surface a safe user-facing message while retaining the error code for UI state. Map `401`, `403`, `413`, `415`, `422`, `429`, `503`, and `504` to actionable messages without exposing tokens or raw upstream URLs.

- [x] **Step 4: Add API-focused tests**

  Verify that the request uses the expected route, multipart keys, boolean serialization, and response mapping. Verify that a backend error envelope rejects with its code and that an oversized/unsupported file is rejected before a network call.

### Task 2: Update the Builder Inspector for real OCR response states

**Files:**
- Modify: `apps/web/src/pages/WorkflowBuilderPage.tsx`
- Modify if required: `apps/web/src/lib/constants/nodeCatalog.ts`
- Reference: `apps/web/src/types/workflow.types.ts`
- Test: `apps/web/e2e/ocr-builder.spec.ts`

**Interfaces:**
- Consumes: the real `OcrExtractionResult` from Task 1.
- Produces: Inspector preview with raw text, document pages, confidence presentation, quality state, warnings, and optional table summary.

- [x] **Step 1: Pass the active workspace ID to the API client**

  Use the existing workspace/session source in the web app. Do not invent a new workspace environment variable and do not persist database credentials in browser state.

- [x] **Step 2: Replace mock-only result rendering**

  Render `result.document.pages`, `result.document.mimeType`, and `result.text.rawText`. Convert `result.confidence` from `0..1` to a display percentage only where the UI formats it; render `null` as `—` or an explicit “No text detected” state.

- [x] **Step 3: Render quality and warning states**

  Show `OK`, `LOW_CONFIDENCE`, and `EMPTY` states and list structured warnings. Keep loading, retryable error, forbidden, unsupported-file, timeout, and model-not-ready states distinct enough for the user to act.

- [x] **Step 4: Remove business extraction from OCR preview**

  Delete mock `detectedFields` rendering and invoice-field copy from the OCR result path. Keep the next `AI Structured Extract` node responsible for business fields.

- [x] **Step 5: Keep node outputs contract-safe**

  Keep the catalog's generic OCR outputs (`rawText`, `pages`, `confidence`) and add only generic outputs already present in the backend contract if the existing Builder model supports them. Do not add Dashboard entry points or invoice-specific outputs.

### Task 3: Verify Inspector-to-Gateway-to-OCR behavior

**Files:**
- Create or modify: `apps/web/e2e/ocr-builder.spec.ts`
- Modify if required: `apps/web/playwright.config.ts` or test fixtures only when consistent with existing conventions
- Update: `docs/work_logs/2026-09-07-agent-cli-local-path.md`

**Interfaces:**
- Consumes: running web app, API Gateway public OCR route, valid authenticated workspace, and a non-PII PNG/PDF fixture.
- Produces: reproducible browser evidence for the Inspector flow; no direct browser-to-Neon connection.

- [x] **Step 1: Add the deterministic UI test seam**

  Cover selecting an `ocr.extract` node, choosing a supported fixture, selecting `vi+en`, leaving table detection enabled, and pressing the Inspector extract action. If the repository's E2E environment cannot provide a real authenticated Gateway, use a route-level fixture only for the deterministic UI test and label the real integration check separately; do not call the private OCR service from Playwright.

- [ ] **Step 2: Run the real integration path when services are available**

  Start the web app, Gateway, Workflow Service, Neon-backed dependencies, and OCR model mount using the existing documented commands. Capture the actual HTTP status, response `requestId`, rendered raw text, quality state, and browser console/network failures.
  *(Status: PENDING — blocked by unauthenticated mock web workspace session; live Gateway, Workflow Service, and Neon DB path not yet verified).*

- [x] **Step 3: Verify error paths**

  Exercise unsupported file, oversized file, `LOW_CONFIDENCE`/empty response, timeout, and unauthenticated/forbidden responses. Ensure no secret, signed URL token, or database connection string appears in browser logs.

### Task 4: Complete documentation and verification

**Files:**
- Update: `docs/development/FRONTEND_GUIDE.md` or the existing web development guide
- Update: `docs/work_logs/2026-09-07-agent-cli-local-path.md`

- [x] **Step 1: Document the frontend integration boundary**

  State that FE calls the Gateway public route, Inspector uses multipart upload, workflow execution uses artifact/approved URL sources, and Neon remains backend-only.

- [x] **Step 2: Run focused checks**

  ```powershell
  pnpm --filter web build
  pnpm --filter web lint
  pnpm --filter web test:e2e -- ocr-builder.spec.ts
  git diff --check
  ```

- [x] **Step 3: Review the diff and worktree**

  Confirm only the owned frontend/API/E2E/docs files changed, existing user changes remain untouched, no `.env` changed, and no commit/push is performed.

## Acceptance Criteria

- The Builder Inspector constructs and sends contract-correct multipart requests to the public API Gateway route in UI tests; live authenticated Gateway Workflow Neon execution remains a separate pending gate.
- The frontend renders the backend OCR response without invoice/business-field assumptions.
- Confidence is not treated as CER/WER and is displayed from the backend's `0..1` scale.
- Quality and structured warnings are visible for low-confidence and empty results.
- Workflow execution remains artifact/URL based and the browser never connects to Neon.
- Focused build/lint/E2E checks are run and their actual results are recorded.

## Risks and Boundaries

- The current repository contains mock API data and broad unrelated worktree changes; implementation must stay limited to the OCR Builder path.
- A real E2E run may be blocked by unavailable Gateway authentication or Neon-backed services; record that as an environment blocker rather than weakening the contract.
- CER/WER benchmark, table quality, and load/SLA gates remain separate backend quality work and are not represented as user-facing OCR fields.

## Current Status & Next Steps

### Current Status (2026-09-07)

- **Implemented & Verified (Frontend Contract & Route-Interception E2E):**
  - **Typed Multipart Gateway Client:** `apps/web/src/api/ocr.api.ts` implements multipart upload to `POST /api/v1/workspaces/{workspaceId}/ocr/extractions` with `language` and `detectTables`. Handles typed error envelope `{ error: { code, message, retryable, details }, requestId }` via `OcrApiError`.
  - **Builder Inspector Response States:** `apps/web/src/pages/WorkflowBuilderPage.tsx` handles normalized confidence (`0.0..1.0` formatted to `%` only at display boundary), `metadata.quality` (`OK`, `LOW_CONFIDENCE`, `EMPTY`), structured `metadata.warnings`, table summary presentation, and actionable typed errors. Removed mock `detectedFields` and invoice preview (business field extraction is owned by `AI Structured Extract`).
  - **Vite Proxy:** Configured dev proxy for `/api` to avoid CORS issues during local web development.
  - **Route-Interception Playwright E2E:** `apps/web/e2e/ocr-builder.spec.ts` passes with 21/21 tests across Chromium, Firefox, and WebKit covering file selection, language parameters, table detection toggles, successful extractions, low-confidence/empty warnings, and typed error states.
  - **Quality & Static Checks:** `pnpm --filter web build`, `pnpm --filter web lint`, and `git diff --check` passed cleanly.

- **Pending Verification & Incomplete Gates:**
  - **Live Authenticated Gateway/Workflow/Neon E2E:** The Playwright suite currently relies on route interception because the web app still operates with mock auth/workspace. End-to-end verification against live API Gateway, Spring Boot Workflow Service, and Neon PostgreSQL is pending.
  - **CER/WER Quality Benchmark:** Full evaluation on held-out >= 100-page non-PII corpus (target CER <= 5.0% on clean text) remains pending.
  - **Table Production Gate:** Vietnamese diacritic recognition in table cells (currently `xfail` in `test_real_tables.py`) and structural F1 >= 0.85 on held-out tables remain pending.
  - **Load / Concurrency / SLA Targets:** Validation of p95 latency targets (<= 10s text, <= 20s tables, <= 60s 10-page), RSS <= 2500 MiB, and 100-request stability remains pending.

### Next Steps

1. **Live Service Verification:** Stand up live API Gateway with real authentication and Neon database session to execute full live end-to-end integration tests without route interception.
2. **Offline Vietnamese Table Recognizer Artifact:** Obtain and mount a validated Vietnamese-capable recognizer for PP-StructureV3 to resolve the `xfail` in `test_real_tables.py`.
3. **Corpus & Quality Benchmark:** Run character error rate (CER/WER) evaluation against the frozen held-out non-PII dataset.
4. **Load & SLA Gate:** Run container stress and memory leak tests across 100 consecutive requests to verify latency, RSS, and concurrency admission.
