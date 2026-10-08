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

## Gateway side (ours, done on `fix/gateway-ocr-timeout`)

The Gateway previously aborted every OCR call after a hard-coded 10 s, so each Colab request returned
`503 OCR_BUSY`. The deadline is now `GATEWAY_OCR_TIMEOUT_MS` (default 10000); `compose.colab-ocr.dev.yml`
sets it to 95000 (90 s service budget plus margin). See `docs/development/SETUP.md`, "Google Colab OCR
development mode".
