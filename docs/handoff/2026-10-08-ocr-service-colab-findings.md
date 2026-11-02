# OCR service handoff: Colab testing findings (2026-10-08)

Owner of the changes below: OCR partner (`services/ocr-service`). We do not edit that service; this note
documents what we measured and what we ask for. Test setup: Google Colab T4 notebook, ngrok tunnel
(`https://<your-tunnel>.ngrok-free.dev`), PaddleOCR 3.7.0, paddlepaddle 3.3.0, API Gateway on our side.
Use non-sensitive documents only. Do not paste tunnel URLs or tokens into issues, commits or logs.

## Summary

| # | Finding | Owner | Action |
| - | ------- | ----- | ------ |
| 1 | OCR runs on CPU although the notebook has a T4 | Notebook (shared) | Install `paddlepaddle-gpu` into the uv `.venv` (steps below) |
| 2 | Table cell text loses Vietnamese diacritics | Partner | Use the fine-tuned recognizer in the table engine |
| 3 | Backend died during a default (`detectTables=true`) request | Partner | Read the log, find the cause, enforce the 60s/90s deadlines |

## Finding 1 - GPU not used (notebook fix, no service change)

The notebook GPU cell `!{sys.executable} -m pip install paddlepaddle-gpu==3.3.0 ...` fails
(`{sys.executable}: command not found`, `sys` is not imported) and would install into the system Python, not the
uv `.venv` that uvicorn runs from. CPU measurements for a 1200x700 invoice image: cold first call 65 s, warm
text-only 9.4 s server time, with table detection 42.6 s; a 500x80 image takes 0.3 s.

Fix, from `services/ocr-service` in the notebook:

```bash
uv pip uninstall -p .venv paddlepaddle
uv pip install -p .venv paddlepaddle-gpu==3.3.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu130/
.venv/bin/python -c "import paddle; print(paddle.device.get_device())"   # expect gpu:0
```

Then restart uvicorn. Do not run `uv sync` afterwards: it reinstalls the CPU `paddlepaddle`. The service code sets
no device, so PaddleOCR picks the GPU automatically. Not yet re-measured on GPU.

## Finding 2 - Table cell text loses diacritics (quality)

**Observed.** Plain text uses the fine-tuned Vietnamese recognizer and is correct ("HÓA ĐƠN BÁN HÀNG",
confidence 0.94). Text inside table cells is not: "Sản phẩm" became "Sn phm", "Số lượng" became "Só lưng",
"Giấy A4" became "Giáy A4". Table structure (3x3) was correct.

**Cause.** `services/ocr-service/src/infrastructure/engines/paddle_table_engine_adapter.py`,
`_get_or_create_engine` (about lines 458-486) builds `PPStructureV3(lang="vi", ...)`, which loads the built-in
Latin recognizer. `services/ocr-service/config/model-manifest.json` (lines 7-8 and 13-14) already pins the
fine-tuned `PP-OCRv6_medium_rec` at
`/models/paddlex-cache/official_models/pp-ocrv6-medium-rec-vietnamese` for text, but the table engine does not
use it. The partner's local bundle `D:\Weav-OCR-Models\table-manifest.json` also points table recognition at
`PP-OCRv5_server_rec`.

**Requested change.** For `vi` and `vi+en`, pass to the table engine (through the table kwargs/manifest, which
already feed `defaults.update(self._table_kwargs)`):

- `text_recognition_model_name="PP-OCRv6_medium_rec"`
- `text_recognition_model_dir=<OCR_MODEL_ROOT>/paddlex-cache/official_models/pp-ocrv6-medium-rec-vietnamese`

Update the table manifest/bundle to match, and add a regression test with a Vietnamese table fixture.

**Acceptance.** A table image with Vietnamese headers/cells (for example "Sản phẩm", "Số lượng", "Giấy A4")
returns cell text with diacritics intact and the same table structure; the test fails on the old behavior.

> **Resolved 2026-10-09 on `feature/ocr-onnx`:** the manifest `"table"` section points PP-StructureV3 at the Vietnamese recognizer and bundle models; cells keep diacritics. See the work log.

## Finding 3 - Backend died on a default table request (stability, cause unconfirmed)

**Reproduction.** Direct multipart request to the tunnel without `Authorization` (dev mode,
`OCR_ALLOW_UNAUTHENTICATED_DEV=true`), default `detectTables=true`, CPU runtime. The request hung about 28 s;
ngrok returned `503` "invalid or incomplete HTTP response"; afterwards the backend was gone (ngrok `502`
"failed to dial backend: connection refused").

**Suspected cause.** Out-of-memory or worker crash during CPU table extraction. Not confirmed: the log
`/content/ocr-service.log` (uvicorn output is redirected there) has not been read yet.

**Requested.**

1. Read `/content/ocr-service.log` around the crash and report the cause (OOM kill, exception, signal).
2. Enforce the contract deadlines instead of dying: 60 s native OCR and 90 s total, returning
   `504 OCR_TIMEOUT` (`docs/specs/services/ocr-service.md` lists `OCR_TIMEOUT`/`REQUEST_TIMEOUT` as defined
   but not yet enforced in the route).
3. Bound table-extraction memory (image downscale/size limits) or fail with a typed error.

**Acceptance.** The same request on a CPU runtime either succeeds or returns a documented error
(`504 OCR_TIMEOUT` or `503 OCR_BUSY`) within 90 s, and the process stays up and answers `/health` afterwards.

## Finding 4 - Proposal: run text det/rec on ONNX Runtime (CPU, measured spike)

Goal: run OCR on a CPU service instead of Colab. Spike on a laptop, `python:3.12-slim`, `--cpus 4 --memory 4g`, 4 threads everywhere, paddlepaddle 3.3.0 / paddleocr 3.7.0 / paddlex 3.7.2 (from `uv.lock`), onnxruntime 1.30.0, paddle2onnx 2.1.0. Production models (`PP-OCRv5_mobile_det`, `pp-ocrv6-medium-rec-vietnamese`). Same 240-line synthetic Vietnamese set as the accuracy benchmark, rendered once so every engine saw identical bytes.

Conversion (works on the PIR `inference.json` directly; opset 14; det 4.6 MB, rec 60 MB):

```
paddle2onnx --model_dir <models>/PP-OCRv5_mobile_det --model_filename inference.json --params_filename inference.pdiparams --save_file det.onnx --opset_version 14
paddle2onnx --model_dir <models>/pp-ocrv6-medium-rec-vietnamese --model_filename inference.json --params_filename inference.pdiparams --save_file rec.onnx --opset_version 14
```

Tensor parity Paddle vs ONNX: rec max prob diff 8e-5 (argmax never differs), det max diff 3e-4.

| Variant | CER | Word acc | Exact | Line p50 | A4 page (25 lines) | Peak RSS | site-packages |
| ------- | --- | -------- | ----- | -------- | ------------------ | -------- | ------------- |
| A: production Paddle CPU (`enable_mkldnn=False`) | 2.97% | 90.5% | 124/240 | 361 ms | 17.3 s | 1364 MB | ~1.4 GB |
| B: Paddle CPU `enable_mkldnn=True` | fails: `ConvertPirAttribute2RuntimeAttribute not support` on first predict | | | | | | |
| D: `PaddleOCR(..., engine="onnxruntime")` on the converted models, no paddlepaddle installed | 2.97% | 90.5% | 124/240 | 396 ms | 7.0 s | 1145 MB | ~0.75 GB |
| C2: rapidocr + onnxruntime with a PaddleX-style crop override | 2.97% | 90.5% | 124/240 | 401 ms | 7.5 s | 687 MB | 335 MB |
| C1: rapidocr stock glue | 3.24% | 89.3% | 113/240 | 443 ms | - | 692 MB | 335 MB |

- D and C2 match A on all 240 predictions (0.00 pp CER). C1 differs only because rapidocr crops boxes differently from PaddleX (`minAreaRect` on int32 points); do not ship it without the crop override.
- ONNX is 2.2-2.7x faster on a full page (detection ~3.5x faster), starts 2-10x faster and uses less memory. It is **not** faster on a single short line (recognition ~300-400 ms per crop in both runtimes).
- Timing is from a shared laptop (absolute numbers moved 2-3x between sessions); ratios come from interleaved paired runs.
- The Vietnamese rec model doubles characters even on clean renders ("Tài kKhoản", "Bằng chưữ"), identical in A and D; a large share of the CER is the model, not the runtime.

Requested (partner decision):

1. Convert det + vi/en rec once offline with the commands above and ship them as `inference.onnx` + the original `inference.yml` per model folder.
2. Lowest-effort integration: add `engine="onnxruntime"` (+ `engine_config` threads) to the existing `PaddleOCR(...)` call in `paddle_ocr_engine_adapter.py` (~line 645); PaddleX keeps all pre/post-processing.
3. Keep tables/layout (PP-StructureV3) on Paddle for now; they were not converted or measured. The image only drops paddlepaddle once tables move too or run in a separate worker.
4. Acceptance: regression test comparing ONNX vs Paddle output on a fixed image set (0 differing strings), plus a run on real scanned documents.
5. Optional latency lever to evaluate: rec minimum padded width 320 instead of 640 (p50 345 -> 217 ms on short field crops in the spike, but 18/120 strings changed).

## Gateway side (ours, done on `fix/gateway-ocr-timeout`)

The Gateway previously aborted every OCR call after a hard-coded 10 s, so each Colab request returned
`503 OCR_BUSY`. The deadline is now `GATEWAY_OCR_TIMEOUT_MS` (default 10000); `compose.colab-ocr.dev.yml`
sets it to 95000 (90 s service budget plus margin). See `docs/development/SETUP.md`, "Google Colab OCR
development mode".
