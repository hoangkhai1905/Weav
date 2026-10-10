# Work log: Colab OCR integration and Gateway OCR timeout

## 1. Metadata

| Field    | Value |
| -------- | ----- |
| Date     | 2026-10-08 (Asia/Saigon) |
| Branch   | `fix/gateway-ocr-timeout` (uncommitted) |
| Operator | AI agent on behalf of K |
| Status   | In progress |
| Scope    | Make the local Gateway work against the OCR service running in Google Colab |
| Related  | [handoff to OCR partner](../../../handoffs/2026-10-08-ocr-service-colab-findings.md), [SETUP.md Colab section](../../../development/SETUP.md), [earlier gateway OCR timeout log](../../T/2026-09-19-api-gateway-ocr-timeout.md) |

## 2. Summary

- Every OCR request from the Gateway to the Colab service returned `503 OCR_BUSY` because the upstream
  deadline was hard-coded to 10 s. The deadline is now configurable (`GATEWAY_OCR_TIMEOUT_MS`).
- Colab testing found three OCR-service issues (CPU instead of GPU, table text loses diacritics, backend
  died on a default table request). Findings 2 and 3 belong to the partner and are documented as a handoff.

| Item                   | Status |
| ---------------------- | ------ |
| Gateway unit/e2e tests | Done (unit 114/114, e2e 117/117, build OK) |
| Docs (SETUP, handoff)  | Done |
| GPU fix in notebook    | Not yet applied or re-measured |
| Commit / PR            | Not created |

## 3. Decisions

| Decision | Reason | Alternative |
| -------- | ------ | ----------- |
| New env `GATEWAY_OCR_TIMEOUT_MS`, default 10000 | Keeps production behavior unchanged; remote runtimes need longer | Raise the global default (rejected: hides real upstream stalls) |
| `compose.colab-ocr.dev.yml` defaults it to 95000, overridable | OCR contract allows 90 s per document; 5 s margin | Per-request timeout from the client (not needed) |
| OCR changes go through a handoff, not code | `services/ocr-service` belongs to the partner | Patch the service ourselves (not allowed) |

## 4. Changes

| Type | Path | Change |
| ---- | ---- | ------ |
| Edit | `services/api-gateway/src/config/gateway.config.ts` | Add `GATEWAY_OCR_TIMEOUT_MS` (positive int, default 10000) and `ocr.timeoutMs` in `GatewayConfig` |
| Edit | `services/api-gateway/src/ocr/ocr.service.ts` | Use the configured timeout instead of the fixed 10 s deadline |
| Edit | `services/api-gateway/src/ocr/ocr.service.spec.ts` | Unit tests for the configurable deadline (separate lane) |
| Edit | `compose.colab-ocr.dev.yml` | Set `GATEWAY_OCR_TIMEOUT_MS: ${GATEWAY_OCR_TIMEOUT_MS:-95000}` |
| Edit | `.env.example` | Document `GATEWAY_OCR_TIMEOUT_MS=10000` |
| Edit | `docs/development/SETUP.md` | Colab section: GPU in `.venv`, reading the service log, timeout overlay |
| Add  | `docs/handoffs/2026-10-08-ocr-service-colab-findings.md` | Partner handoff (findings 2 and 3; notebook fix for 1) |
| Add  | `docs/work_logs/K/ocr/colab-ocr-integration.md` | This log |

## 5. Measurements (Colab T4 notebook running CPU paddle; PaddleOCR 3.7.0, paddlepaddle 3.3.0)

| Case | Result |
| ---- | ------ |
| Cold first call | 65 s |
| Warm text-only, 1200x700 invoice image | 9.4 s server time |
| Same image with table detection | 42.6 s |
| Tiny 500x80 image | 0.3 s |
| Plain text diacritics | Correct ("HÓA ĐƠN BÁN HÀNG", confidence 0.94) |
| Table cell text | Diacritics lost ("Sản phẩm" -> "Sn phm"); structure 3x3 correct |
| Direct request, `detectTables=true`, CPU | Hung ~28 s, ngrok 503, then backend gone (502 connection refused) |

After a clean runtime with `paddlepaddle-gpu` in `.venv` (`DEVICE: gpu:0`, 275 MiB GPU memory), through the local Gateway (`GATEWAY_OCR_TIMEOUT_MS=95000`):

| Case | Result |
| ---- | ------ |
| Text-only invoice, warm | 200 in 0.6-1.0 s (server 223-381 ms) |
| With tables, first call (table models load) | 200 in 37.7 s |
| With tables, warm | 200 in 1.1 s (server 765 ms); cell diacritics still lost |
| Before the timeout fix | `503 OCR_BUSY` at 10 s on every request |

Accuracy, synthetic benchmark (240 single-line images: 20 Vietnamese document lines x Arial/Times/Tahoma x clean/blur/lowres-JPEG/noise+2.5deg rotation, `language=vi`, text only):

| Condition | CER | Word accuracy | Exact lines |
| --------- | --- | ------------- | ----------- |
| clean | 2.66% | 91.0% | 29/60 |
| blur | 3.05% | 91.0% | 33/60 |
| lowres + JPEG q35 | 2.46% | 91.8% | 36/60 |
| noise + rotation | 4.52% | 85.8% | 22/60 |
| overall | 3.17% | 89.9% | 120/240 |

Diacritics cause only ~6% of errors. Most errors are digits, punctuation and spacing (`12.450.000` -> `12.00`, `185.000` -> `85.000`, `10%` -> `1010%` even on clean images, `@` -> `Q`). Amounts and IDs need format validation or human review before workflows act on them. Synthetic printed lines overstate real scan/photo accuracy; a labelled set of real documents is still needed.

Notebook pitfalls found: in Colab `uv pip` without `-p .venv` installs into `/usr`; `uv run`/`uv sync` reinstall the CPU wheel; `!cmd &` keeps a cell running and queues later cells (use `subprocess.Popen`).

ONNX CPU spike (details and table in the handoff, Finding 4): converted det + vi rec with paddle2onnx 2.1.0; `PaddleOCR(engine="onnxruntime")` matches production Paddle on 240/240 lines (CER 2.97% both), A4 page 17.3 s -> 7.0 s, peak RSS 1364 -> 1145 MB, install ~1.4 -> ~0.75 GB; short-line latency unchanged; `enable_mkldnn=True` crashes on paddle 3.3 PIR models. Scripts and raw JSON stayed in the session scratch folder (not committed).

ONNX Runtime in `ocr-service` (branch `feature/ocr-onnx`, local Docker, laptop CPU, real service through HTTP):

| Case | Paddle manifest | ONNX manifest |
| ---- | --------------- | ------------- |
| 240-line benchmark CER / word acc / exact | 3.15% / 89.6% / 119 | 3.15% / 89.6% / 119 (0/240 predictions differ) |
| Line p50 / p95 | 470 / 696 ms | 469 / 776 ms |
| A4 page, 25 lines (3 runs) | 22.0 / 20.1 / 19.1 s | 8.4 / 7.0 / 6.5 s |
| Invoice via Gateway, text only | - | 200 in 3.9 s (first call after start 23 s, model load) |
| Invoice via Gateway, tables (still Paddle) | - | 200 in ~59 s warm; first call downloads table models and hit the old 60 s deadline |

Service logs confirm `Creating model ... /models/onnx/...` with `onnxruntime`. Conversion: `scripts/convert_models_to_onnx.py` with paddle2onnx 2.1.0 (constant-folding warnings are harmless).

Phase 2, table detection (PP-StructureV3, still Paddle; branch `feature/ocr-onnx`):

- The manifests gained a `"table"` section: offline models from the bundle (no downloads), the fine-tuned Vietnamese recognizer, and `SLANet_plus` for wired and wireless structure. If a table model folder is missing the service logs a warning and keeps PaddleOCR's downloaded defaults (the Colab notebook only provisions the three text models).
- Invoice through the Gateway: cells keep diacritics ("Sản phẩm", "Đơn giá" instead of "San phåm"/"Sn phm"); warm ~28 s instead of ~59 s; first call after start 67 s (all models load). Logs show every model created from `/models/...`, 0 downloads.
- Per-model time before (Paddle CPU, invoice): rec 17-19 s, SLANeXt_wired 10-12 s, PP-DocLayout_plus-L ~11 s, RT-DETR-L wired cells 8-16 s. SLANet_plus takes ~0.5 s.
- SLANeXt_wired vs SLANet_plus on three synthetic tables (invoice 3x3, wired 5x4, borderless 5x4): identical cells (20/20 structure; 17/20 and 18/20 exact text on the 5x4 tables). Remaining errors come from the recognizer: `1` -> `F`, `cơ` -> `CƠ`, a stray trailing character (`Số lượng9`, `3.500.0000`).
- Table models on ONNX: all six convert with paddle2onnx 2.1.0, but SLANet_plus/SLANeXt_wired failed to load in ONNX Runtime 1.30 (`Loop` condition declared rank 0, inferred rank 1) at opset 14, 16 and 17. Clearing the Loop subgraph input/output shapes and `value_info` (now done by `scripts/convert_models_to_onnx.py`) makes both load.
- Full ONNX table pipeline (`PPStructureV3(engine="onnxruntime")`) vs Paddle, same models: cells identical on invoice (9), wired 5x4 (20) and borderless 5x4 (20). Warm time per table image: 14 vs 23 s, 11 vs 28 s, 7 vs 24 s (direct pipeline). Through the Gateway with the ONNX manifest: invoice 11 s warm (first call 44 s), wired 12 s, borderless 12 s; logs show every model created from `/models/onnx`, 0 downloads.

Slim ONNX image: `paddlepaddle` moved to the optional `paddle` extra (lock change only moves it; no version changes); `Dockerfile.dev` takes `OCR_RUNTIME=paddle|onnx` (compose build arg, default paddle) and sets `UV_NO_SYNC=1` so `uv run` does not drop the extra at start.

| Image | Size | paddle in venv | Check |
| ----- | ---- | -------------- | ----- |
| `OCR_RUNTIME=paddle` | 1.02 GB | yes | Paddle manifest serves `small.png` (200) |
| `OCR_RUNTIME=onnx` | 0.63 GB (venv 733 MB) | no | unit 205/205; 240-line benchmark 0/240 differ from Paddle (CER 3.15%); invoice/wired/borderless tables 200 through the Gateway with correct cells; peak memory ~2.3 GB with all text + table models loaded |

Model conversion also runs from the ONNX image (`UV_NO_SYNC=0 uv run --extra paddle --with paddle2onnx==2.1.0 ...`); its output was byte-identical to the earlier conversion.

OCR workflow node end to end (branch `feature/ocr-workflow-node`, 2026-10-10):

- ocr-service verifies Service JWTs (`src/api/service_auth.py`; `OCR_TRUSTED_ISSUERS`, `OCR_URL_ALLOWLIST`). Live checks: `Bearer x` 401, correctly-claimed token signed with another key 401, valid Gateway/Workflow tokens 200, `X-Workspace-ID` mismatch 403. Unit 233/233.
- Gateway signs `preview` tokens after a Workspace Service membership check (403/404 -> 403, other -> 503) and proxies `GET .../workflows/node-capabilities`. Unit 127/127, e2e 120/120.
- Workflow Service: `node-capabilities` endpoint (one `enabledSources()` decision shared with runtime gating), OCR read timeout max 120 s (default 100 s), and the OCR HttpClient pinned to HTTP/1.1: the JDK default sent an h2c upgrade that uvicorn rejects ("Unsupported upgrade request", then "Malformed JSON" 400) - the first real run failed with it. 852 tests: 0 failures; known env errors (TLS cert x2, notification dist x1) plus RabbitMQ container start timeouts (7, pass when rerun alone). Built with `-Djava.version=21` (pom wants 25, only JDK 21 installed).
- Web: OCR readiness, inspector message, publish blockers and palette tag follow `node-capabilities`; tsc clean.
- Live: builder shows the OCR step "Ready" with a `fileUrl`, publishes, and the run `398956ce` succeeded (OCR step 27.5 s, text + 9 blocks in the node output). Builder "Try OCR" through the Gateway returned 200.
- Not done (first pass): artifact (workspace file) source, a resolver, and passing a previous step's file (Telegram/Gmail/Drive) into the OCR step.

Files from earlier steps (same branch, 2026-10-10, in progress; uncommitted):

- Decision: new `ocr.extract` source `file` (file reference `{fileId,...}` or fileId string, e.g. `{{ trigger.input.attachments[0] }}`). Workflow Service reads it from the workflow file store and sends multipart to `/v1/extractions`, which the OCR service already accepts, so no partner change is needed. Exactly one of `artifactId`/`fileUrl`/`file` (`OCR_SOURCE_CONFLICT`/`OCR_SOURCE_REQUIRED`); over 10 MiB is `FILE_TOO_LARGE`. `file` is listed in `node-capabilities` when OCR is enabled, claims are verified, the signing key is set and the file store is configured. `artifactId` stays disabled (needs the OCR artifact resolver, partner side).
- Google Drive `download` (`fileId`) stores the file and returns `{file:{fileId,filename,mimeType,size}}`; Google-native docs fail `CONFIGURATION_ERROR`; limited by the connection's Drive scope.
- `trigger.telegram` runs for text, caption, photo or document; the photo (largest that fits) or document is downloaded after secret check + ingress budget, outside the DB transaction (`@Transactional` replaced by `TransactionOperations` around the locked admission), and exposed as `trigger.input.file` or `{skipped: too_large|not_stored|error}`. Bot token/URL never logged. A redelivery may leave an orphan file (retention purges it).
- Web: OCR source selector (link / earlier-step file / workspace file ID), readiness per enabled source, catalog outputs for Telegram `file`, Gmail `attachments[0]`, Drive `download`; tsc clean, build OK, `workflow-catalog-v1.spec.ts` OCR case passes (mock mode).
- Workflow Service targeted tests pass (OCR, validator, schemas, Drive, Telegram); full `mvnw verify` and the live run are pending (Docker engine stopped responding).

Live Telegram -> OCR and builder usability (same branch, 2026-10-10):

- Tunnel: `cloudflared` installed with winget; quick tunnel to the Gateway; `WORKFLOW_PUBLIC_BASE_URL` set in `.env` (URL not logged here), workflow-service recreated. Telegram only reaches Weav by webhook (no `getUpdates` polling in `trigger.telegram`), so a public HTTPS URL is required.
- Live run `4734655b` (workspace "test 1", bot "test tele"): photo stored as `trigger.input.file`, OCR SUCCESS (6 lines, confidence 0.92) but 4 m 32 s: attempts 1-2 hit the 100 s read timeout (`OCR_UNAVAILABLE`, model cold start on CPU), attempt 3 took 61 s. OCR reported `processingTimeMs` 43 s with `tableDetection: completed`; matches the Colab CPU table figure (42.6 s), so tables are the bottleneck. The local OCR container has no GPU (laptop RTX 3050 4 GB + Docker `nvidia` runtime exist, but the image is CPU-only; a GPU image is a partner build change).
- Web builder usability (one batch, web only, saved configs unchanged):
  - "Insert variable" shows friendly names (`builder.var.path.<nodeType>.<path>`) with the raw path under them, and step names instead of ids. Names exist for Telegram/Gmail triggers, Drive, OCR, Telegram send, AI summarize/classify; other nodes still show raw paths.
  - OCR: "file from an earlier step" is a dropdown of the files earlier steps hand over (Telegram photo, first email attachment, Drive download) plus "Other (type an expression)"; a new or empty OCR step opens on it and a new step after such a step is prefilled. The "artifact" source is hidden while the server has not enabled it. "Try with a sample file" is collapsed. New OCR steps default `detectTables: false` (saved configs without the key keep the server default, on); the checkbox explains the cost.
  - Telegram send: "Send to: whoever just wrote to the bot" (`{{ trigger.input.message.chat.id }}`, prefilled after a Telegram trigger) or another chat ID with a how-to; one-click "insert the text read" per earlier OCR step; parse mode / silent / reply-to under "Advanced options".
  - Checks: tsc clean; build OK; `git diff --check` clean; eslint 1 error at `WorkflowBuilderPage.tsx` set-state-in-effect, pre-existing (same error linting HEAD). Playwright (`ocr-builder`, `workflow-catalog-v1`, `workspace-connections`, http mode): 64 passed / 22 failed; HEAD baseline 60 / 25, all 22 are in the baseline list (builder "add step" button and connection-error assertions). New test "OCR picks the photo sent to the bot and Telegram send answers that chat with the OCR text" passes; the Telegram send test now opens "Advanced options".
  - Live: builder shows the friendly variables, the OCR file dropdown preselected on "Photo/file sent to the bot", and the Telegram send step prefilled to reply; "Telegram -> OCR" now replies with the OCR text, tables off; draft PUT and publish 200. Run `d09f13e1` (photo sent to the bot, started automatically): SUCCESS in 25.7 s (OCR 18.6 s, Telegram send 2.0 s) vs 4 m 35 s before; OCR without tables is still slower than the Colab CPU text-only figure (0.3 s), possibly cold model load - re-measure warm.
- Noticed: in the "Add step" palette a mouse click only highlights an item, Enter adds it; after publishing, the workflow name overlaps the "Editor" tab. Not fixed here.
- Follow-up batch (cross-step builder polish, user chose A+B+C+D after an audit of the other 17 node types; remaining audit items - condition/switch/data.set pickers, Gmail "reply to sender", AI multi-line input, Sheets/Drive link-to-ID, Gmail filter presets, HTTP copy, webhook URL - are not started):
  - A: builder copy no longer says "ánh xạ"/"mapping" or "V1" (18 keys, VI + EN; product name "WEAV V1" on help/footer kept).
  - B: `DataSuggestions` ("Quick insert") under the main text fields of Telegram send, Gmail send (subject, body), AI extract/classify/summarize/generate, Calendar (summary, description), Drive (content): up to 4 featured values from earlier steps (OCR text, message received, sender name, email subject/body, AI result, Drive link), closest step first; replaces the OCR-only button.
  - C: not a bug. A real mouse click on a palette item fires `click` and adds the step (event trace in the live app); the earlier miss was the automation's coordinates.
  - D: the saved/edited pill keeps only its dot below `md`, so the title column no longer overflows (155 px content in a 155 px column, was 173).
  - Checks: tsc clean; build OK; eslint only the pre-existing error; Playwright (same 3 specs + `ai-builder`, `editor-controls`): every failure is in the HEAD/pre-change baseline (`ai-builder` x2 are mock-mode tests that also fail on `c31d33a` in http mode); the OCR/Telegram test now checks the quick inserts. Live: Telegram send shows "Chèn nhanh: + Văn bản đọc được · + Tin nhắn nhận được · + Tên người gửi"; all API calls 200 after reload.

## 6. Risks and blockers

| Level  | Issue | Next step |
| ------ | ----- | --------- |
| High   | Backend died on a default table request (cause unconfirmed) | Partner reads `/content/ocr-service.log`, enforces 60 s/90 s deadlines |
| Low    | The 95 s deadline holds Gateway connections open longer in Colab/local-model mode | Dev only; the default stays 10 s |
| Medium | Table detection ~11 s per page on CPU (ONNX); ~2.3 GB RAM with all models loaded | Real-document table set; consider lazy table loading on small hosts |

## 7. Next steps

1. Done: Gateway unit 114/114, e2e 117/117, build OK; eslint has 3 pre-existing errors in `notifications.module.ts` and `workflow.module.ts` (untouched).
2. Done: GPU install applied and re-measured (table above).
3. Send the handoff (Findings 2-4) to the partner; re-test table diacritics and the crash case when they respond.
4. Never commit the tunnel URL, ngrok token or `.env` values.
