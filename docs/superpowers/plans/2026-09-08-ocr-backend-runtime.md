# OCR Backend Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing OCR domain pipeline executable over HTTP and reachable from the Workflow Builder through the API Gateway for a real local image test.

**Architecture:** FastAPI owns the private OCR ingress and wires the existing `ExtractTextUseCase` to document loading, OpenCV preprocessing, PaddleOCR, optional table extraction, and bounded temporary-file cleanup. NestJS API Gateway exposes the public workspace route, preserves the multipart body and correlation headers, and forwards to the private OCR ingress. Development mode has an explicit local-auth bypass only in the OCR compose override; non-development requests require a Bearer token at the Gateway boundary.

**Tech Stack:** FastAPI, Starlette request/form parsing, Pydantic v2, Uvicorn, PaddleOCR/PaddleX, OpenCV, NestJS 11, Fastify, native Node `fetch`, Jest, pytest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-06-ocr-service-production-design.md` and `packages/contracts/http/ocr/openapi.yaml`

## Global Constraints

- OCR receives PNG, JPEG/JPG, WEBP, and PDF; maximum upload size is 10 MiB and maximum document length is 10 pages.
- Supported language values are exactly `vi`, `en`, and `vi+en`.
- OCR returns raw text, confidence, text blocks with bounding boxes, pages, metadata, and optional table data; it does not extract invoice or business fields.
- Browser traffic uses `POST /api/v1/workspaces/{workspaceId}/ocr/extractions`; browser code never connects directly to Neon or the private OCR service.
- The OCR private ingress uses `POST /v1/extractions` and requires `X-Request-ID`; development-only anonymous access must be explicit and disabled outside development.
- URL sources remain HTTPS-only and SSRF-protected by the existing `SafeUrlFetcher`; artifact sources use the existing `WorkflowArtifactResolver` boundary.
- Do not read, write, stage, or commit `.env`; do not log tokens, secrets, raw connection strings, or raw uploaded documents.
- Preserve all unrelated existing worktree changes.

---

### Task 1: FastAPI composition root and private OCR HTTP ingress

**Files:**
- Create: `services/ocr-service/src/api/__init__.py`
- Create: `services/ocr-service/src/api/dependencies.py`
- Create: `services/ocr-service/src/api/routes.py`
- Create: `services/ocr-service/src/main.py`
- Test: `services/ocr-service/src/tests/unit/test_http_api.py`
- Modify: `services/ocr-service/Dockerfile.dev`
- Modify: `compose.ocr-models.dev.yml`

**Interfaces:**
- Consumes: `validate_single_source`, `ExtractTextUseCase`, `DocumentLoader`, `PaddleOcrEngineAdapter`, `PaddleTableEngineAdapter`, `SafeUrlFetcher`, and `WorkflowArtifactResolver`.
- Produces: `app` (FastAPI), `POST /v1/extractions`, typed error envelopes, `X-Request-ID` response propagation, and a Docker command that keeps Uvicorn running.

- [x] **Step 1: Write failing HTTP tests**

  Add tests for: multipart upload reaching the use case with `language` and `detectTables`; JSON artifact/URL source parsing; generated/echoed request IDs; missing authorization outside development; explicit anonymous development mode; domain errors mapping to `{error, requestId}` without raw exception details; and malformed content types returning a 400 envelope.

- [x] **Step 2: Run the HTTP tests and verify the expected RED state**

  Run from the service directory:

  ```powershell
  $env:PYTHONPATH = "."
  uv run pytest src/tests/unit/test_http_api.py -q
  ```

  Expected result: collection or import failure because `src.main:app` and the API route do not exist yet.

- [x] **Step 3: Implement the FastAPI composition root and route**

  `src/main.py` must create the real adapters once at startup and include the router. The route must parse multipart through `await request.form()` without loading the whole file into memory, pass the uploaded `UploadFile.file` stream into `validate_single_source`, and parse JSON source requests through `await request.json()`. It must create a UUID when `X-Request-ID` is absent, reject malformed IDs, set `workspaceId` from the trusted `X-Workspace-ID` header for private calls, call `await use_case.execute(request_model)`, serialize the Pydantic result with aliases, and return the same correlation ID in `X-Request-ID`.

  Map `OcrDomainError.status_code` to the contract error envelope. Map Pydantic/request parsing failures to `INVALID_REQUEST`; never include a filesystem path, traceback, token, or uploaded content in a response. Use an explicit `OCR_ALLOW_UNAUTHENTICATED_DEV=true` plus `APP_ENV=development` check for local testing; otherwise require a Bearer authorization header at the private ingress.

- [x] **Step 4: Make the container executable**

  Add the Uvicorn command to `Dockerfile.dev`:

  ```dockerfile
  CMD ["uv", "run", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
  ```

  Extend `compose.ocr-models.dev.yml` only with the development OCR environment needed for the local test, including `OCR_ALLOW_UNAUTHENTICATED_DEV: "true"`, and keep the model bind mount read-only.

- [x] **Step 5: Run the HTTP tests and the existing OCR suite**

  ```powershell
  $env:PYTHONPATH = "."
  uv run pytest src/tests/unit/test_http_api.py -q
  uv run pytest -q
  ```

  Expected result: the new HTTP tests and all existing tests pass; real model tests may remain explicitly skipped when the model manifest/corpus is unavailable.

### Task 2: API Gateway OCR proxy

**Files:**
- Create: `services/api-gateway/src/ocr/ocr.module.ts`
- Create: `services/api-gateway/src/ocr/ocr.controller.ts`
- Create: `services/api-gateway/src/ocr/ocr.service.ts`
- Create: `services/api-gateway/src/ocr/ocr.service.spec.ts`
- Modify: `services/api-gateway/src/app.module.ts`

**Interfaces:**
- Consumes: public workspace path, raw Fastify request stream, `OCR_SERVICE_URL`, `Authorization`, `X-Request-ID`, and `traceparent`.
- Produces: public `POST /api/v1/workspaces/:workspaceId/ocr/extractions` forwarding multipart and JSON requests to `${OCR_SERVICE_URL}/v1/extractions`.

- [x] **Step 1: Write failing Gateway proxy tests**

  Cover: valid development request forwards the original multipart content type/body and correlation headers; missing Bearer is rejected when development bypass is disabled; explicit development bypass is accepted; upstream OCR status/body/headers are returned unchanged except for sanitized transport errors; and workspace ID is forwarded as `X-Workspace-ID`.

- [x] **Step 2: Run the Gateway tests and verify RED**

  ```powershell
  pnpm --dir services/api-gateway test -- --runInBand ocr.service.spec.ts
  ```

  Expected result: the new test file or `OcrModule` import is missing.

- [x] **Step 3: Implement the proxy service/controller/module**

  Use native Node `fetch` with `duplex: "half"` to stream the incoming Fastify request to OCR without buffering a multipart file in Gateway memory. Copy only `content-type`, `authorization`, `x-request-id`, `traceparent`, and `x-workspace-id`; generate a UUID correlation ID when absent. Validate `workspaceId` is non-empty and reject missing authorization unless `APP_ENV=development` and `OCR_ALLOW_UNAUTHENTICATED_DEV=true`. Return upstream JSON and status safely, translate connection failures to a retryable 503 envelope, and do not log request bodies or headers containing credentials.

- [x] **Step 4: Register the module and run focused Gateway checks**

  Import `OcrModule` in `AppModule`, then run:

  ```powershell
  pnpm --dir services/api-gateway test -- --runInBand ocr.service.spec.ts app.controller.spec.ts
  pnpm --dir services/api-gateway build
  pnpm --dir services/api-gateway lint
  ```

### Task 3: Local live runtime verification

**Files:**
- Test fixture: use an existing non-PII image under `D:/test ocr/` if present; do not copy it into the repository.
- Documentation: update `docs/work_logs/2026-09-08.md` using `docs/work_logs/log_template.md`.

**Interfaces:**
- Consumes: Docker Compose OCR model override, local model directory, API Gateway port `3000`, OCR port `8000`, and web port `5173`.
- Produces: reproducible evidence for direct OCR HTTP and Builder Inspector upload, or a precise environment blocker.

- [x] **Step 1: Build and start OCR plus Gateway**

  Use the existing local model path without printing environment values:

  ```powershell
  $env:OCR_MODEL_HOST_PATH = "D:\Weav-OCR-Models"
  docker compose -f compose.yml -f compose.dev.yml -f compose.ocr-models.dev.yml --profile app up -d --build ocr-service api-gateway
  ```

- [x] **Step 2: Check health and logs without secrets**

  Verify container status and only inspect sanitized startup/error lines. Confirm OCR listens on `8000` and Gateway listens on `3000`; do not print `.env` or authorization headers.

- [x] **Step 3: Upload a non-PII image through the public route**

  Send a multipart request with `file`, `language=vi+en`, `detectTables=false`, and a generated `X-Request-ID`. Verify status 200, document metadata, raw text, blocks, confidence/quality, and echoed request ID. If the model is unavailable, record the explicit `MODEL_NOT_READY`/startup failure rather than replacing it with a mock.

- [ ] **Step 4: Verify the Builder Inspector path**

  Open `http://127.0.0.1:5173/`, choose the `ocr.extract` node, upload the same fixture, and confirm the browser request goes to the Gateway and the response is rendered. Record browser console/network failures and distinguish live evidence from route-intercepted Playwright evidence.

- [ ] **Step 5: Update the work log and report remaining gates**

  Record commands and short results in `docs/work_logs/2026-09-08.md`. Keep CER/WER corpus benchmark, table production F1 gate, load/SLA, and full authenticated Workflow/Neon execution explicitly pending unless they were actually run.

## Verification Checklist

- [x] `git diff --check` is clean for the implementation changes.
- [x] OCR unit, HTTP, and integration-safe tests pass; real model tests are only skipped with their documented prerequisites absent.
- [x] API Gateway unit/build/lint checks pass.
- [x] Docker OCR container remains running with `src.main:app` and model mount configured.
- [ ] Direct public multipart request and Builder Inspector request are both tested without route interception, or the exact blocker is documented. (Direct public multipart is complete; Builder Inspector browser verification remains pending.)
- [ ] No `.env`, credentials, tokens, raw connection strings, generated models, or user fixtures are added to Git.
- [ ] GitNexus `detect-changes --scope all --repo .` is run before any commit.
