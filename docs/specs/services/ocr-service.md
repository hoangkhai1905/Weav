# OCR Service

> Status: Partial. Text and table extraction pipeline and HTTP ingress are Implemented and smoke-tested; Service JWT verification, URL allowlist wiring, artifact resolution, health endpoints, and production quality/load gates are Planned. Owner: T (partner). Last verified: 2026-09-30 against `dev`.

## Purpose and scope

A private, stateless FastAPI service that performs generic OCR (text blocks with bounding boxes and confidence) and table structure extraction on images and PDFs, using PaddleOCR/PP-StructureV3 on CPU with offline models. Contract: [OCR README](../../../packages/contracts/http/ocr/README.md), [openapi.yaml](../../../packages/contracts/http/ocr/openapi.yaml). Design: [production design](../../superpowers/specs/2026-09-06-ocr-service-production-design.md) (Vietnamese).

Not responsible for:
- Business entity extraction (invoices, vendors, line items): owned downstream by AI `ai.extract` ([ai-service.md](./ai-service.md)). Result models reject undeclared fields (`extra="forbid"`).
- Persisting documents, results, execution tracking, retries, or artifact storage: Workflow Service owns these; OCR never touches a database.
- Public authentication, membership checks, public rate limiting: Gateway.
- Fetching from arbitrary URLs: default-deny.

## Use cases covered

OCR has no thesis use case of its own; it serves the Workflow OCR node and the Builder inspector.

| UC | Name | Status | Notes |
| --- | --- | --- | --- |
| UC018 | Run workflow manually (OCR node) | Partial | OCR side extraction works; Workflow executor ([OcrNodeExecutor.java](../../../services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ocr/OcrNodeExecutor.java)) is gated off by default (`WORKFLOW_OCR_*` flags `false`) until OCR auth/URL/artifact gates are verified. |
| UC012 | Edit workflow (inspector OCR preview) | Partial | Public Gateway route [ocr.controller.ts](../../../services/api-gateway/src/ocr/ocr.controller.ts) proxies multipart to OCR; web inspector integration done at contract/UI level, live authenticated path pending ([benchmark](../../development/OCR_BENCHMARK.md)). |

## Business rules

| Rule | How OCR enforces it |
| --- | --- |
| BR08 | OCR runs only inside published, configured workflow executions (Workflow gate) or the interactive inspector; it never triggers or publishes anything. |
| BR03 | Tenant context comes from the workspace ID; artifact resolution rejects cross-workspace, missing, deleted, or expired artifacts before any download ([workflow_artifact_resolver.py](../../../services/ocr-service/src/infrastructure/files/workflow_artifact_resolver.py)). |
| BR01 | Bearer token required at the private ingress (presence only today, see Security). |

Component rules (code):
- Exactly one document source per request: multipart file, artifact ID, or allowlisted URL ([ocr_request.py](../../../services/ocr-service/src/domain/models/ocr_request.py)).
- Formats: PNG, JPEG, WEBP, PDF; languages `vi`, `en`, `vi+en` (default `vi+en`); `detectTables` default `true`.
- Quality label `OK | LOW_CONFIDENCE | EMPTY`; confidence is 0..1 (not an accuracy claim).

## Domain model and data

No database, schema, or migrations. Stateless; temporary files live in a bounded spool and are cleaned up ([bounded_spool.py](../../../services/ocr-service/src/infrastructure/files/bounded_spool.py)). Clean-architecture layout: `domain` (models, ports, errors), `application/use_cases` (`ExtractTextUseCase`), `infrastructure` (Paddle OCR/table adapters, OpenCV preprocessor, PDF renderer, document loader, safe URL fetcher, artifact resolver), `api` (routes, DI), [main.py](../../../services/ocr-service/src/main.py).

Result shape ([ocr_result.py](../../../services/ocr-service/src/domain/models/ocr_result.py)): `document` (fileName, mimeType, pages 1-10, pageInfo with pixel size and dpi), text blocks with bounding boxes, `rawText`, tables (cells, spans), quality, warnings.

## API

Internal API (callers: API Gateway public route, Workflow worker). Public route is Gateway-owned (Partner): `POST /api/v1/workspaces/{workspaceId}/ocr/extractions`, user JWT, workspace membership + `workflow:execute` check, forwards to the private route.

| Method | Path | Purpose | Auth | Main errors |
| --- | --- | --- | --- | --- |
| POST | `/v1/extractions` | Extract text/tables; `multipart/form-data` (`file`, `language`, `detectTables`) or `application/json` (`source`: `artifact`/`url`) | `Authorization: Bearer` required (Service JWT per contract); `X-Request-ID` UUID required; dev bypass only if `APP_ENV=development` and `OCR_ALLOW_UNAUTHENTICATED_DEV=true` | see table |
| GET | `/docs`, `/openapi.json` | FastAPI docs | none | none |

No `/health` endpoint exists in code (Planned). Compose has no OCR healthcheck.

Error envelope: `{error: {code, message, retryable, details}, requestId}`; `X-Request-ID` echoed. Codes in [errors.py](../../../services/ocr-service/src/domain/errors.py):

| HTTP | Codes |
| --- | --- |
| 400 | INVALID_REQUEST |
| 401 / 403 / 404 | UNAUTHENTICATED / FORBIDDEN / ARTIFACT_NOT_FOUND |
| 408 | UPLOAD_TIMEOUT |
| 413 | FILE_TOO_LARGE, DOCUMENT_LIMIT_EXCEEDED |
| 415 | UNSUPPORTED_MEDIA_TYPE |
| 422 | INVALID_OPTIONS, CORRUPT_FILE, ENCRYPTED_PDF, ANIMATED_IMAGE_UNSUPPORTED, SOURCE_URL_NOT_ALLOWED, SOURCE_UNAVAILABLE, OUTPUT_LIMIT_EXCEEDED |
| 429 | RATE_LIMITED (retryable; defined, no emitter found in service code) |
| 500 / 502 | INTERNAL_ERROR / SOURCE_FETCH_FAILED (retryable flag), TABLE_EXTRACTION_FAILED |
| 503 | OCR_BUSY, MODEL_NOT_READY (retryable) |
| 504 | SOURCE_TIMEOUT, OCR_TIMEOUT, REQUEST_TIMEOUT |

## Events and messaging

None. Synchronous REST only.

## Dependencies

| Direction | Component | Purpose |
| --- | --- | --- |
| Called by | Workflow Service ([OcrClient.java](../../../services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ocr/OcrClient.java)) | Node execution, `OCR_SERVICE_PRIVATE_URL` default `http://ocr-service:8000` |
| Called by | API Gateway (`OCR_SERVICE_URL`) | Public inspector route |
| Calls | Allowlisted document URLs (SafeUrlFetcher) | URL source; allowlist empty by default |
| Calls | Workflow artifact descriptor/download (port only) | Artifact source; no concrete client wired |
| Local | Model files from `OCR_MODEL_ROOT` + manifest | Offline PaddleOCR models |
| Not used | Neon, R2, Valkey, RabbitMQ, DeepSeek | n/a |

## Security

- Auth today: [routes.py](../../../services/ocr-service/src/api/routes.py) only checks a well-formed `Bearer <token>` header. It does not verify signature or claims. `X-Workspace-ID` is accepted as workspace context. This contradicts the contract (verify `iss` in `weav-api-gateway|weav-workflow`, `aud=weav-ocr`, `scope=ocr:extract`, `mode`, `workspace_id`, 120 s TTL) and is a documented production blocker.
- Dev bypass: requires both `APP_ENV=development` and `OCR_ALLOW_UNAUTHENTICATED_DEV=true`; the OCR/Colab compose overlays set it. Keep `false` otherwise (default in `.env.example`).
- SSRF defence ([safe_url_fetcher.py](../../../services/ocr-service/src/infrastructure/files/safe_url_fetcher.py)): default-deny domain allowlist, DNS pinning, strict schemes, no credentials forwarded. `create_extract_text_use_case` builds `SafeUrlFetcher()` with no allowlist, so URL sources are rejected until wiring is added.
- File validation: MIME/signature check, encrypted PDF and animated image rejection, page/dimension limits, bounded spool ([document_loader.py](../../../services/ocr-service/src/infrastructure/files/document_loader.py)).
- Errors are sanitized: no paths, tracebacks, tokens, or document content; catch-all returns `INTERNAL_ERROR`.
- Secrets: none required by the service.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `APP_ENV` | `development` in compose | Enables dev bypass together with the next variable |
| `OCR_ALLOW_UNAUTHENTICATED_DEV` | `false` (`.env.example`) | Skip Bearer check when header absent, development only |
| `OCR_MODEL_ROOT` | `/models` in compose | Directory of offline models |
| `WEAV_OCR_MODEL_MANIFEST` | `/app/config/model-manifest.json` | Model manifest ([model-manifest.json](../../../services/ocr-service/config/model-manifest.json)); missing/invalid gives `MODEL_NOT_READY` |
| `OCR_MODEL_HOST_PATH` | `./.data/ocr-models` | Compose host bind for `/models` (read-only) |
| `OCR_SERVICE_PRIVATE_URL` | `http://ocr-service:8000` | Workflow's target |
| `OCR_SERVICE_URL` | `http://ocr-service:8000` | Gateway upstream (Colab overlay overrides with an HTTPS tunnel) |
| `WORKFLOW_OCR_ENABLED`, `..._URL_SOURCE_ENABLED`, `..._ARTIFACT_SOURCE_ENABLED`, `..._SERVICE_CLAIMS_VERIFIED`, `..._URL_ALLOWLIST_VERIFIED`, `..._ARTIFACT_RESOLVER_VERIFIED` | all `false` | Workflow runtime gates; the last three are operator attestations |
| `WORKFLOW_OCR_SIGNING_KEY_ID` / `_LOCATION` | empty | Workflow's Service JWT signing key |
| `WORKFLOW_OCR_CONNECT_TIMEOUT` / `_READ_TIMEOUT` / `_TOKEN_LIFETIME` / `_MAX_RESPONSE_BYTES` | 5s / 30s / 60s / 1048576 | Workflow client limits |

Overlays: [compose.ocr-models.dev.yml](../../../compose.ocr-models.dev.yml) (local models, dev bypass on), [compose.colab-ocr.dev.yml](../../../compose.colab-ocr.dev.yml) (Gateway to Colab-hosted OCR, dev bypass). The base `ocr-service` block is in [compose.dev.yml](../../../compose.dev.yml) (port 8000, profile `app`).

## Non-functional requirements

| Aspect | Value (source) |
| --- | --- |
| File size | 10 MiB (`MAX_FILE_BYTES` in bounded_spool.py) |
| Document | max 10 pages, 10,000 px per side, 20 MP per page (document_loader.py) |
| Output | max 20,000 blocks, 1 MiB `rawText`, 100 tables, 10,000 cells (engine adapters) |
| URL fetch | connect 3 s, read-idle 5 s, total 15 s, 10 MiB cap (safe_url_fetcher.py) |
| Runtime target | Python 3.12, CPU, 2 vCPU / 4 GiB per replica, one warm worker with preloaded models ([benchmark](../../development/OCR_BENCHMARK.md)) |
| Concurrency/backpressure | `OCR_BUSY` and `RATE_LIMITED` codes exist but no limiter found in code |
| Retries | None in OCR; envelope carries `retryable` |
| Observability | Python logging; `X-Request-ID` propagation; no health or metrics endpoint |
| Quality gates | Smoke CER <= 15% met; production CER <= 5%, table F1 >= 0.85, cold start, warmed p95, RSS: pending evidence |

## Status and known gaps

- Planned: Service JWT signature/claim verification and ignoring `X-Workspace-ID` (production blocker).
- Planned: concrete artifact descriptor/download contract and resolver wiring (`artifact_resolver=None` in dependencies.py).
- Planned: URL allowlist configuration and provider/object-store approval.
- Planned: `/health/live` and `/health/ready` (model readiness), compose healthcheck.
- Planned: concurrency limiter / `OCR_BUSY` emission, per-request processing deadline (`OCR_TIMEOUT`, `REQUEST_TIMEOUT` are defined but not enforced in the route).
- Partial: table quality (Vietnamese diacritics recognizer test is `xfail`).
- Pending evidence: held-out CER/WER, table F1, cold-start/p95/RSS, live authenticated Gateway/Workflow/Neon path.
- Limitation: `src/` contains empty `.gitkeep` placeholder folders (`processors`, `providers`, `schemas`, `services`, `utils`, `config`).
- Limitation: no service README.

## Testing

- From `services/ocr-service`: `uv run pytest` (unit tests in `src/tests/unit`, contract fixtures in `src/tests/fixtures/ocr`).
- Integration (need offline models): `uv run pytest src/tests/integration/test_model_compatibility.py`, `test_real_ocr.py`, `test_real_tables.py` (table quality assertion `xfail`).
- Lint: `uv run ruff check` (ruff is in the dev group; not run here).
- Notable suites: contract schema, HTTP API, input policy, safe URL fetcher, PDF renderer, preprocessor, result and table normalization, model manifest, adaptive pipeline.
- Last result: not recorded in the 2026-09-30 full-run list; unverified in this pass.

## Open questions

1. **Deferred (2026-09-30):** OCR is still being tested on Google Colab; revisit before enabling any `WORKFLOW_OCR_*` flag. Contract says Service JWT must be verified; code checks presence only. Suggested: treat as a blocker for enabling any `WORKFLOW_OCR_*` flag, implement JWKS verification mirroring AI Service.
2. Contract requires rejecting a missing `X-Request-ID`; code generates one when absent (invalid values are rejected). Suggested: change code to match the contract.
3. Contract makes `X-Workspace-ID` non-authoritative; code uses it. Suggested: derive from the verified JWT.
4. Notion's diagram routes Gateway directly to OCR; the contract also has a public Gateway route plus a private route, which matches code. Suggested: keep both, document Gateway as ingress only.
5. Vietnamese design doc vs English contract: which is authoritative for limits? Suggested: code values above, since they match the contract README.
6. **Decided (2026-09-30):** owner is T (partner).
7. Should OCR get an emitting concurrency limiter before enabling workflow OCR? Suggested: yes, one in-flight worker per replica with `OCR_BUSY` overflow.

## References

- Code: [services/ocr-service](../../../services/ocr-service), [pyproject.toml](../../../services/ocr-service/pyproject.toml), [Dockerfile.dev](../../../services/ocr-service/Dockerfile.dev)
- Contract: [packages/contracts/http/ocr](../../../packages/contracts/http/ocr)
- Docs: [OCR benchmark](../../development/OCR_BENCHMARK.md), [production design](../../superpowers/specs/2026-09-06-ocr-service-production-design.md)
- Plans: [production](../../superpowers/plans/2026-09-06-ocr-service-production.md), [builder/gateway](../../superpowers/plans/2026-09-07-ocr-builder-gateway-integration.md), [backend runtime](../../superpowers/plans/2026-09-08-ocr-backend-runtime.md)
- Compose: [compose.dev.yml](../../../compose.dev.yml), [compose.ocr-models.dev.yml](../../../compose.ocr-models.dev.yml), [compose.colab-ocr.dev.yml](../../../compose.colab-ocr.dev.yml)
- Rules: [rulebook](../../rulebook.md), [specs index](../README.md)
