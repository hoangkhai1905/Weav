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

## 6. Risks and blockers

| Level  | Issue | Next step |
| ------ | ----- | --------- |
| High   | Backend died on a default table request (cause unconfirmed) | Partner reads `/content/ocr-service.log`, enforces 60 s/90 s deadlines |
| Medium | Table text loses diacritics | Partner change in `paddle_table_engine_adapter.py` (handoff) |
| Low    | The 95 s deadline holds Gateway connections open longer in Colab/local-model mode | Dev only; the default stays 10 s |
| Medium | Table detection on CPU ~60 s/page and PP-StructureV3 models are downloaded into the container instead of read from the bundle | Phase 2: load table models from the bundle (and the Vietnamese recognizer), then try ONNX for them |

## 7. Next steps

1. Done: Gateway unit 114/114, e2e 117/117, build OK; eslint has 3 pre-existing errors in `notifications.module.ts` and `workflow.module.ts` (untouched).
2. Done: GPU install applied and re-measured (table above).
3. Send the handoff (Findings 2-4) to the partner; re-test table diacritics and the crash case when they respond.
4. Never commit the tunnel URL, ngrok token or `.env` values.
