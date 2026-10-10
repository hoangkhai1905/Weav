# Handoff (partner, OCR): `ocr.extract` with stored files (Week 7, 2026-10-10)

From: K. To: OCR owner (partner). Status: request; nothing inside `services/ocr-service` is changed by K.

## Goal

Make the thesis flow work end to end: "invoice e-mail -> OCR -> Google Sheets row -> Telegram alert". Today `ocr.extract` only accepts `artifactId` (disabled, no resolver) or a public `fileUrl`. Files that a workflow already holds (Gmail attachments, later uploads) are stored by workflow-service in Cloudflare R2 (`kltn-weav` bucket, `workflow-files/` prefix, 7-day retention) and travel through runs as a **file reference** `{fileId, filename, mimeType, size}` (see `docs/api/week4-node-contracts.md`, "File reference").

## Proposed design (no new OCR endpoint)

1. **K (workflow-service, after your confirmation):** `ocr.extract` gains an optional `file` config (a file reference, e.g. `{{ trigger.input.attachments[0] }}`), mutually exclusive with `artifactId` / `fileUrl`. At run time workflow-service checks the file belongs to the run's workspace, then creates a **presigned R2 GET URL valid for 5 minutes** and calls you exactly as today with the existing contract shape:
   ```json
   { "source": { "type": "url", "fileUrl": "https://<account-id>.r2.cloudflarestorage.com/kltn-weav/workflow-files/...?X-Amz-Algorithm=...&X-Amz-Signature=..." },
     "language": "vi+en", "detectTables": true }
   ```
   Same service JWT, headers and limits as the current `type: "url"` call (`packages/contracts/http/ocr/README.md` section 3).
2. **Partner (OCR service), please:**
   - a. Add the R2 S3 API host (`<account-id>.r2.cloudflarestorage.com`; K sends you the exact host privately, it is in `WORKFLOW_FILES_S3_ENDPOINT`) to the `fileUrl` host allowlist (README section 4.2). Configuration, not code, if your allowlist is config-driven.
   - b. Confirm the URL fetcher keeps the full query string (presigned signature), does a single GET without redirects, and works when `Content-Type` is `application/octet-stream` (sniff PDF/PNG/JPEG/WEBP from the bytes) and with the existing 10 MiB / 10 pages limits.
   - c. Confirm `X-Amz-Signature` (and the whole query string) is redacted in logs, metrics and error bodies (README section 4.4 already requires it).
   - d. A URL that has expired returns a clear error code (suggest `422 SOURCE_URL_EXPIRED` or the existing `SOURCE_FETCH_FAILED`), so workflow-service can show "file expired" instead of a generic failure.
   - e. Stable hosting: the Colab session stops; tell K the URL that will stay up for the demo (or whether the OCR container can run on the demo VM on CPU). R2 is on the public internet, so Colab can fetch it.
   - f. A few accuracy numbers on a small invoice/receipt set (for the thesis evidence chapter), if possible.

## What K enables afterwards

`WORKFLOW_OCR_ENABLED=true`, `WORKFLOW_OCR_URL_SOURCE_ENABLED=true`, `WORKFLOW_OCR_SERVICE_CLAIMS_VERIFIED=true`, `WORKFLOW_OCR_URL_ALLOWLIST_VERIFIED=true` (only after a-c are confirmed). `artifactId` stays disabled.

## Why this design

- No new OCR endpoint and no bytes through the gateway or the broker; the existing SSRF rules (HTTPS, allowlist, IP pinning, no redirects) still apply.
- The presigned URL is short-lived and scoped to one object, so the OCR service never holds R2 credentials.
- Alternative not chosen: workflow-service uploading the bytes as `multipart/form-data` to the public extraction route (that route is user-facing through the gateway and would need a service-auth path).

## Timeline

Feature freeze 2026-10-31. If a-c are confirmed by ~10-24, K adds the `file` config (small) before the freeze; otherwise the thesis keeps `fileUrl` for public files and documents this as future work.
