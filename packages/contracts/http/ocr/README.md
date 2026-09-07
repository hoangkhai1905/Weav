# OCR Service HTTP Contract v1

This directory defines the HTTP contract for the **Weav OCR Service**.
The formal schema specification is declared in [openapi.yaml](./openapi.yaml).

## 1. Architectural Role and Scope

- **Responsibility**: The OCR Service performs purely generic optical character recognition and structural table extraction from documents (images and PDFs).
- **Out of scope**: Generic OCR does **not** extract invoices, receipts, tax codes, vendor names, line items, or business entities. Structured entity extraction is exclusively owned downstream by `AI Structured Extract`.
- **Stateless & Synchronous**: The OCR Service is stateless with hard processing deadlines. Persistent execution tracking, artifact storage, and retries are owned by the **Workflow Service**.

## 2. Ingress Endpoints

The contract defines two complementary ingress boundaries:

| Route | Accessibility | Authentication | Purpose |
| --- | --- | --- | --- |
| `POST /api/v1/workspaces/{workspaceId}/ocr/extractions` | Public (via API Gateway) | `Authorization: Bearer <access-token>` | Inspector and interactive UI extraction. Validates workspace membership and enforces public rate limits before forwarding. |
| `POST /v1/extractions` | Private (Internal Network) | `Authorization: Bearer <service-jwt>` | Internal service-to-service ingress for API Gateway and Workflow Service worker execution. |

### Public Ingress Semantics
- Callers authenticate with an Identity access JWT.
- API Gateway validates the JWT, checks workspace execution authorization (`workflow:execute`), applies rate limits, generates or propagates `X-Request-ID`, and forwards the request to the private OCR service.
- The `workspaceId` in the path defines tenant isolation.

### Private Ingress Semantics
- Direct access to `POST /v1/extractions` is strictly restricted to trusted internal callers.
- Callers must provide an asymmetric Service JWT minted specifically with:
  - `iss`: `weav-api-gateway` or `weav-workflow`
  - `aud`: `weav-ocr`
  - `scope`: `ocr:extract`
  - `workspace_id`: target workspace UUID
  - `mode`: `preview` or `execution`
  - Maximum TTL: 120 seconds.

## 3. Request Formats and Source Discrimination

A single extraction request accepts exactly one document source. Two content types are supported:

### A. Multipart Upload (`multipart/form-data`)
Intended primarily for direct user uploads in the Workflow Builder Inspector:
- `file`: Required single file part (`image/png`, `image/jpeg`, `image/webp`, or `application/pdf`).
- `language`: String enum (`vi`, `en`, `vi+en`; default: `vi+en`).
- `detectTables`: Boolean or boolean string (`true` or `false`; default: `true`).

Multipart bodies must never mix secondary JSON bodies or accept multiple files.

### B. JSON Request (`application/json`)
Intended for Workflow node executions and artifact-referenced extractions:
```json
{
  "source": {
    "type": "artifact",
    "artifactId": "8eae413e-b229-490f-927a-3e2ee793d029"
  },
  "language": "vi+en",
  "detectTables": true
}
```
Or for allowlisted external URLs:
```json
{
  "source": {
    "type": "url",
    "fileUrl": "https://approved-storage.example.invalid/documents/report.pdf"
  },
  "language": "en",
  "detectTables": false
}
```

The `source` field uses a strict discriminator on `type`:
- `type: "artifact"`: Requires `artifactId` (UUID string). The service resolves this through the Workflow Service artifact descriptor.
- `type: "url"`: Requires `fileUrl` (HTTPS URI, max 4096 characters).

## 4. Security & SSRF Defense Rules

`fileUrl` ingestion must **never** become an open SSRF proxy:
1. **Scheme & Port**: HTTPS on port 443 only.
2. **Strict Host Allowlist**: Only pre-approved hostnames/storage providers configured per workspace/tenant are allowed. All others are rejected immediately with `422 SOURCE_URL_NOT_ALLOWED`.
3. **DNS Validation & IP Pinning**:
   - Loopback (`127.0.0.0/8`, `::1`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`), cloud metadata endpoints (`169.254.169.254`), and IPv4-mapped IPv6 ranges are blocked.
   - DNS resolution is pinned to the validated IP before transport connection; no redirect following.
4. **Token Redaction**: Signed URLs with sensitive query tokens (e.g. AWS `X-Amz-Signature`, SAS tokens) are strictly redacted in logs, metrics, and error responses.
5. **No Credential Leakage**: Ambient service tokens and cookies are never forwarded to external URLs.
6. **Tenant Isolation**: Cross-tenant artifact lookups return `404 ARTIFACT_NOT_FOUND` without leaking metadata.

## 5. Resource Limits and Budgeting (v1)

| Dimension | Constraint | Error Code on Violation |
| --- | --- | --- |
| File size (upload or fetched) | Max 10 MiB (10,485,760 bytes) | `413 FILE_TOO_LARGE` |
| Request multipart total | Max 11 MiB | `413 FILE_TOO_LARGE` |
| JSON body / URL length | Max 16 KiB / 4096 chars | `400 INVALID_REQUEST` / `422 SOURCE_URL_NOT_ALLOWED` |
| Maximum page count | Max 10 pages per document | `413 DOCUMENT_LIMIT_EXCEEDED` |
| Image resolution | Max 20 Mpx/page, edge <= 10,000 px, 100 Mpx total | `413 DOCUMENT_LIMIT_EXCEEDED` |
| PDF render rasterization | Default 200 DPI (capped at 300 DPI) | `413 DOCUMENT_LIMIT_EXCEEDED` |
| Output caps | JSON <= 5 MiB, rawText <= 1 MiB, <= 20,000 blocks, <= 100 tables, <= 10,000 cells | `422 OUTPUT_LIMIT_EXCEEDED` |
| Timeouts | Gateway upload <= 30s; service total <= 90s; native OCR <= 60s (<= 20s/page) | `504 OCR_TIMEOUT` |
| Download budget | Connect <= 3s, read-idle <= 5s, total download <= 15s | `504 SOURCE_TIMEOUT` |
| Concurrency / Admission | 1 active job/worker replica, queue depth <= 2 | `503 OCR_BUSY` (with `Retry-After`) |

## 6. Response Structure & Semantics

### Document and Text
- `schemaVersion`: Literal `"1.0"`.
- `requestId`: UUID echoed from `X-Request-ID` or generated by the service.
- `document`: Contains verified `mimeType`, sanitized `fileName`, `pages` (1–10), and `pageInfo` per page with dimensions in canonical pixels.
- `text.rawText`: Unicode NFC normalized string representing the entire document reading order. Lines separated by `\n`, page transitions marked by `\n\f\n`.
- `confidence`: Document-level score between `0.0` and `1.0`, calculated as a weighted average over non-whitespace Unicode code points. **Nullable (`null`)** when no text is detected. (Note: Legacy mock 0–100 scale is deprecated; v1 contract strictly uses 0.0–1.0).

### Blocks and Coordinates
- Coordinates (`boundingBox`, `polygon`) use canonical page pixels with origin (0, 0) at the top-left.
- Inverted transforms are applied so that any internal deskewing or orientation correction returns coordinates mapped directly to the original canonical page.
- `order`: 0-based document-wide reading order.

### Tables and Cells
- `tables`: Array of detected table grids (empty if `detectTables=false` or no tables found).
- Table structures provide `rowCount`, `columnCount`, canonical `boundingBox`, and `cells`.
- Each cell contains `row`, `column`, `rowSpan` (>= 1), `columnSpan` (>= 1), `text`, nullable `confidence`, optional `boundingBox`, and `sourceBlockIds`.
- Cells never overlap outside valid spans and never exceed grid boundaries.
- Table cell text is integrated into `rawText` in document reading order; tables are not redundantly appended as raw text blocks.

### Metadata & Warnings
- `metadata.quality`: Enum `OK`, `LOW_CONFIDENCE` (< 0.70 document confidence), or `EMPTY` (no text found).
- `metadata.tableDetection`: `not_requested` or `completed`.
- `metadata.warnings`: Array of structured warnings (e.g. `{code: "LOW_CONFIDENCE", message: "...", page: 1}`).

## 7. Error Envelope

All non-200 responses return a standardized, typed error envelope:

```json
{
  "error": {
    "code": "OCR_TIMEOUT",
    "message": "Document processing exceeded the allowed time.",
    "retryable": false,
    "details": {
      "limitSeconds": 60
    }
  },
  "requestId": "eeb24fb2-df80-4dcb-b22d-3a4884799c73"
}
```

Standard Error Codes:
- `400`: `INVALID_REQUEST`
- `401`: `UNAUTHENTICATED`
- `403`: `FORBIDDEN`
- `404`: `ARTIFACT_NOT_FOUND`
- `413`: `FILE_TOO_LARGE`, `DOCUMENT_LIMIT_EXCEEDED`
- `415`: `UNSUPPORTED_MEDIA_TYPE`
- `422`: `INVALID_OPTIONS`, `CORRUPT_FILE`, `ENCRYPTED_PDF`, `ANIMATED_IMAGE_UNSUPPORTED`, `SOURCE_URL_NOT_ALLOWED`, `SOURCE_UNAVAILABLE`, `OUTPUT_LIMIT_EXCEEDED`
- `429`: `RATE_LIMITED`
- `500`: `INTERNAL_ERROR`
- `502`: `SOURCE_FETCH_FAILED`, `TABLE_EXTRACTION_FAILED`
- `503`: `OCR_BUSY`, `MODEL_NOT_READY`
- `504`: `SOURCE_TIMEOUT`, `OCR_TIMEOUT`, `REQUEST_TIMEOUT`
