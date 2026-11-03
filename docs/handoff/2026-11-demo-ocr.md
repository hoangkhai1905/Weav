# Handoff (partner, OCR): OCR in the demo stack (2026-11)

From: K. To: OCR owner (partner). Status: information plus open items; nothing inside `services/ocr-service` is changed by K.

## What we deploy

- Your `services/ocr-service/Dockerfile.dev` built with `OCR_RUNTIME=onnx`; CI publishes `ghcr.io/hoangkhai1905/weav-ocr-service:main` and the demo VM pulls it (`compose.prod.yml`, service `ocr-service`, `mem_limit: 3g`, no published port).
- Manifest `config/model-manifest.onnx.json` (`WEAV_OCR_MODEL_MANIFEST`), models under `OCR_MODEL_ROOT=/models` (read-only mount).
- Models: downloaded from Hugging Face (`PaddlePaddle/<name>`, plus `tieubaoca/pp-ocrv6-medium-rec-vietnamese`) and converted with your `scripts/convert_models_to_onnx.py` by `scripts/setup-ocr-models.sh` (3 text + 5 table/layout folders).
- Env we set: `APP_ENV=production`, `OCR_MODEL_ROOT`, `WEAV_OCR_MODEL_MANIFEST`, `OCR_TRUSTED_ISSUERS` (`weav-workflow`, `weav-api-gateway` JWKS files), `OMP_NUM_THREADS=2`. No `OCR_ALLOW_UNAUTHENTICATED_DEV`, no `OCR_URL_ALLOWLIST`.
- Only the `file` (multipart) source is used; URL and artifact sources are off on the Weav side.
- Runbook: `docs/deployment/demo-runbook.md`, section 7c.

## Measured (laptop, CPU)

Warm memory about 2.3-2.5 GiB; about 7 s per page for text, about 11 s with tables; first call after a start about 45-67 s (lazy model load).

## Open items for you (not blocking the demo)

1. A `/health` (readiness) endpoint that reports whether the models are loaded; today the compose healthcheck uses `/openapi.json` and only proves the server is up.
2. A request deadline inside the service, so a slow page returns a clear error before the caller's timeout (workflow read timeout 100 s, gateway 95 s).
3. Memory in table mode (`detectTables=true`): peak RSS is what limits the 8 GiB VM; a lower footprint or a documented cap would help.
