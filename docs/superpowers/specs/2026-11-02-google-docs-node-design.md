# Design: `google.docs` workflow node

Status: approved in chat by K on 2026-11-02 (after the 11-01 freeze, by K's decision). Owner: K.

## Goal

Give workflows a place to write text as a real Google Doc, so output from OCR, AI nodes, triggers or `data.set`
lands somewhere people can read and share. Success: a workflow creates a Doc, a later run appends to it, and both
show up in the user's Google Drive.

OCR is disabled in the demo stack (`WORKFLOW_OCR_ENABLED=false`, partner-owned), so the demo shows the node with
text from AI or triggers. OCR → Docs works wherever the OCR service runs; `{{ nodes.<id>.output.text.rawText }}`.

## Decisions

| Question | Choice | Why |
| --- | --- | --- |
| Which Docs can Weav write to? | Only Docs Weav created (Google `drive.file`) | Non-sensitive scope, no consent change, no Google verification |
| Operations | `create` and `append` | Covers "save OCR/AI text" and running logs; read and template replace are out (YAGNI; replace is awkward under `drive.file`) |
| Connection | Reuse the `GOOGLE_DRIVE` connection | The Docs API accepts `drive.file`; no Workspace, Gateway, contract or connection-UI change; Docs show up in the Drive node's list |
| Old W39 `google.docs` drafts (`documentId` + `contentVariable`) | Not kept: they now fail validation like any invalid config | None are known to exist; the type was rejected as unsupported until now |

## Node contract

Schema `packages/workflow-schema/nodes/google.docs.json`, category `action`, `sideEffect: true`.

| Field | Type | Used by | Notes |
| --- | --- | --- | --- |
| `connectionId` | string, required | both | `x-weav-connection.provider = GOOGLE_DRIVE` |
| `operation` | `create` \| `append`, required | both | |
| `title` | string, template | create (required) | One line, at most the Drive node's name limit |
| `content` | string, template | create (optional), append (required) | At most 512 KiB UTF-8, same as the Drive upload |
| `folderId` | string, template, advanced | create | Only folders Weav created or opened (`drive.file`) |
| `documentId` | string, template, personal | append (required) | The Doc ID (`^[A-Za-z0-9_-]{10,200}$`) or its `https://docs.google.com/document/d/<id>/...` link; the link is reduced to the ID (output `documentId` and `url` use the bare ID) |

Outputs:

- `create` → `{ documentId, title, url }` (`url` is Drive's `webViewLink`).
- `append` → `{ documentId, url, appendedCharacters }` (`url` = `https://docs.google.com/document/d/<id>/edit`).

`append` starts the text on a new paragraph (it inserts `"\n" + content` at the end of the body).

## How it works

- **create**: one Drive multipart upload, `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink`.
  The metadata part has `mimeType: application/vnd.google-apps.document` (plus `name` and optional `parents`), the
  media part is `text/plain; charset=UTF-8`. Google converts the text into a Doc. This endpoint is already allowed in
  `PinnedHttpTransport`; one call means no half-made Doc. (Rejected: Docs `documents.create` + `insertText` + Drive
  move: three calls and a partial-failure state.)
- **append**: `POST https://docs.googleapis.com/v1/documents/{documentId}:batchUpdate` with
  `{"requests":[{"insertText":{"endOfSegmentLocation":{},"text":"\n<content>"}}]}`.
  `docs.googleapis.com` is new: a host constant, a validator that allows exactly this method and path shape, and an
  `executeGoogleDocsWithBearerToken` method, mirroring the Sheets one (DNS pinning via `targetPolicy.approve`).

## Components

- **workflow-service**
  - `GoogleDocsNodeExecutor` extends `GoogleApiNodeExecutor` (type `google.docs`, provider `GOOGLE_DRIVE`).
    `prepare` validates config without I/O. The multipart builder from `GoogleDriveNodeExecutor` moves to a shared
    package-private helper instead of being copied.
  - `GoogleApiClient`: a Docs call that goes through the new transport method. The existing 404 message already says
    that only files Weav created or opened are visible, so it is reused as is.
  - `PinnedHttpTransport`: the Docs host, validator and execute method.
  - `DefinitionValidator`: per-operation required fields (`title` for create; `documentId` and `content` for append).
  - `NodeSideEffects`: no change (unknown action types are side-effecting by default; both operations write).
- **Contracts**: `packages/contracts/http/workflow/definition.schema.json` type enum and `if/then` block.
- **ai-service**: one line in the `GENERATE_SYSTEM` output-shape list in `src/prompts/prompts.ts`.
- **web**: node catalog entry, outputs per operation, default operation, id prefix, readiness rules, palette, schema
  form, AI generator `PROVIDER_BY_NODE`, i18n (vi and en). Replace the W39 legacy `google.docs` UI and i18n, and the
  e2e assertions that `google.docs` is unsupported.
- **mobile, admin**: node name, icon and i18n only.
- **docs**: workflow spec node table, `docs/api/week4-node-contracts.md`, `services/workflow-service/README.md`.
- **Not changed**: workspace-service, api-gateway, connection providers, Flyway.

## Errors

Reuse the Google mapping: 401 → `AUTHENTICATION_REJECTED` (reported to Workspace), 429 or rate-limit 403 →
`HTTP_RATE_LIMITED` (retryable), 403/404/other 4xx → `HTTP_BUSINESS_REJECTED`, 408/5xx → `HTTP_DEPENDENCY_UNAVAILABLE`.
Bad config (missing field, bad `documentId`, content over 512 KiB) → `CONFIGURATION_ERROR` before any request.
The access token never appears in output or logs.

Known limits: a retried append or create after a timeout or 5xx may duplicate text or a Doc (same as Sheets append and Drive upload); `appendedCharacters` counts UTF-16 code units and excludes the leading newline.

## Testing

- workflow-service unit tests in the `GoogleApiNodeExecutorsTest` style (fake transport, no network): create builds
  the converting multipart request; append builds the `batchUpdate` body; config errors; status mapping; token not in
  output; the transport rejects any other Docs path or method. Update `NodeConfigSchemasTest`,
  `DefinitionValidatorTest` and `DefinitionJsonCodecTest`, which list node types.
- ai-service prompt spec; web `tsc`, build, and the Playwright builder/catalog specs for the node.
- Live: in the local stack with K's Drive connection, a manual workflow creates a Doc and a second run appends to it;
  both visible in Drive.

## Setup

Google Docs API enabled in the OAuth client's Google Cloud project (done by K on 2026-11-02). No consent-screen change.
