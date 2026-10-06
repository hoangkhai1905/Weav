# Design: email node polish, attachments and the workflow file store

Status: agreed scope (2026-10-06), not implemented. Owner: K (backend). FE renders the new fields from the node JSON Schemas (the partner's side).

## Scope (agreed)

- `email.send` gets the Zapier/n8n Gmail fields: `cc`, `bcc`, `bodyType` (`text` | `html`), `senderName`, `replyTo`, `replyToMessageId` (reply in the Gmail thread of a message, e.g. from `trigger.gmail`), `attachments`.
- Attachments come from (A) a public URL or (B) a **workflow file** stored in Cloudflare R2.
- File store "B-lite": one producer (`trigger.gmail` attachments) and two consumers (`email.send` attachments, `google.drive` upload).
- Deferred: Telegram documents and HTTP "download as file" as producers, and OCR as a consumer.

## Workflow file store (workflow-service owns it)

- **Storage:** the existing R2 bucket `kltn-weav` (reused, as decided), under the prefix `workflow-files/{workspaceId}/{fileId}`. It has its own settings `WORKFLOW_FILES_S3_*` (endpoint, region, bucket, keys, path style, prefix), mirrored from `AVATAR_S3_*` in dev. Without them the file store is "not configured": URL attachments still work, file features fail with `DEPENDENCY_NOT_CONFIGURED`, and `trigger.gmail` still reports attachment metadata, just without `fileId`.
- **Metadata table** (workflow_db, schema `workflow`, new Flyway migration): `workflow_files` with columns `id`, `workspace_id`, `execution_id` (nullable), `object_key`, `filename`, `mime_type`, `size_bytes`, `created_at` and `expires_at`.
- **Retention:** 7 days (`WORKFLOW_FILES_RETENTION`). `RetentionPurgeJob` deletes the R2 object, then the row.
- **File reference in node data** (plain JSON, so templates and `data.set` pass it through): `{"fileId": "<uuid>", "filename": "...", "mimeType": "...", "size": 123}`. Only `fileId` matters when reading. On read, the store checks the row's `workspace_id` equals the running execution's workspace and that it has not expired; otherwise the call fails with `FILE_NOT_FOUND`. A file id copied from another workspace is therefore useless.
- **Limits** (configurable): 10 MiB per file, 5 attachments per email or message, 20 MiB per email (Gmail allows 25). Large transfers use their own byte caps, while the generic 1 MiB outbound cap stays for everything else.

## Nodes

- **`trigger.gmail`** output gains `attachments: [{filename, mimeType, size, fileId?, skipped?}]`.
  - Attachments are downloaded with `messages.attachments.get`, which the existing `gmail.readonly` scope allows, and stored in R2.
  - Oversized files and files beyond the count limit are listed with `skipped: "too_large" | "limit"`.
  - Inline images without a filename are ignored.
- **`email.send`:**
  - New fields, all optional; existing workflows are unchanged.
  - The message is built as MIME (multipart/mixed when it has attachments, with RFC 2047 headers) and sent through Gmail's upload endpoint (`message/rfc822`).
  - `replyToMessageId` reads that message's `threadId` and `Message-ID` and sets `threadId`, `In-Reply-To` and `References`.
  - Each `attachments` item is `{url, filename?}`, downloaded through the SSRF-safe pinned transport, or a file reference.
  - Header fields reject CR and LF to prevent header injection, and the address rules match `to`.
- **`google.drive` `upload`:** a new `file` (file reference) alternative to `content`, at most 5 MiB (Drive multipart; resumable upload is deferred).

## Lanes

1. **F1 file store** (first): S3/R2 client (AWS SDK `s3`, same version as identity), migration, `WorkflowFileStore` port and adapter, retention, config, readiness.
2. **F2 email.send** (after F1): schema fields, MIME builder, Gmail upload send, URL and file attachments, reply-in-thread.
3. **F3 Gmail and Drive** (after F1, parallel with F2): Gmail attachment download and store, Drive `file` upload, `scripts/live-test-nodes.ps1 -Flow attachments`.

## Risks

- Memory: up to 20 MiB per execution in memory, bounded by worker concurrency.
- Gmail polling gets slower when messages carry attachments, bounded by the count and size limits.
- A reused bucket key can also read avatars (accepted).
- Integration tests cannot pull the pinned MinIO image (known), so the adapter is tested against a local fake S3 or a pullable image. The live test covers real R2.
