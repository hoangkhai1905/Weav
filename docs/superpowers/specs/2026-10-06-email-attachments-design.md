# Design: node polish, email attachments and the workflow file store

Status: agreed scope (2026-10-06), Week 4 lanes started 2026-10-06. Owner: K (backend). FE renders the new fields from the node JSON Schemas (the partner's side).

## Scope (agreed)

- `email.send` gets the Zapier/n8n Gmail fields: `cc`, `bcc`, `bodyType` (`text` | `html`), `senderName`, `replyTo`, `replyToMessageId` (reply in the Gmail thread of a message, e.g. from `trigger.gmail`), `attachments`.
- Attachments come from (A) a public URL or (B) a **workflow file** stored in Cloudflare R2.
- File store "B-lite": one producer (`trigger.gmail` attachments) and two consumers (`email.send` attachments, `google.drive` upload).
- Polish of the other nodes, Zapier/n8n-style (section "Other node polish").
- Deferred: Telegram documents and HTTP "download as file" as producers, OCR as a consumer, the `agent.task` node (thesis future work), and Drive resumable upload.

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

## Other node polish

All changes are additive: each node's JSON Schema, executor and tests change, and existing configs stay valid.

| Node | Change | Notes |
| --- | --- | --- |
| `google.sheets` | New operation `lookup`: find rows where a column equals a value, return the matching rows with their row numbers (bounded count). New `valueInputOption` (`RAW` \| `USER_ENTERED`, default as today) for `append` and `update` | Fits the existing Sheets scope |
| `telegram.send_message` | `parseMode` (`none` \| `HTML` \| `MarkdownV2`), `disableNotification`, `replyToMessageId` | Bot API `sendMessage` parameters |
| `google.calendar` | New operation `list`: upcoming events in a time window (bounded count, projected fields), alongside today's create | Check that the granted `calendar.events` scope allows reading; ask before adding a scope |
| `logic.condition` | Several conditions combined with `AND` / `OR`: `{"combinator": "and" \| "or", "conditions": [{left, operator, right}, ...]}`, 1-10 conditions; the single `{left, operator, right}` form stays valid | Ports stay `true`/`false`; update the AI generator capabilities and prompt |

Also: update `GENERATE_SYSTEM` (ai-service) and the assistant's product help text wherever node outputs or operations change, and add live-test steps (`live-test-nodes.ps1`).

## Lanes

Decided 2026-10-06 at the Week 4 kickoff (changes from the first draft: F4 is one lane, F1 owns every transport change, a closing lane F5 was added).

1. **F1 file store and transport** (wave 1): S3/R2 client (AWS SDK `s3`, same version as identity), migration, `WorkflowFileStore` port and adapter, retention, config, readiness. F1 also owns every `PinnedHttpTransport` change the other lanes need (per-call byte caps; Gmail upload send and attachment GET; public-URL binary download; Drive 5 MiB upload; Calendar events GET) and makes the Gmail token check reusable, so F2 and F3 never edit the same file.
2. **F4 node polish** (wave 1, parallel with F1, merged after it): Sheets, Calendar, Telegram and condition in one lane, because they share `DefinitionValidator` and `NodeSideEffects`.
3. **F2 email.send** (wave 2): schema fields, MIME builder, Gmail upload send, URL and file attachments, reply-in-thread. Owns `GmailClient` and `GmailNodeExecutor`.
4. **F3 Gmail trigger and Drive** (wave 2, parallel with F2): Gmail attachment download and store (a new reader class, not `GmailClient`), Drive `file` upload.
5. **F5 close-out** (wave 3): ai-service `GENERATE_SYSTEM` and assistant help text, `scripts/live-test-nodes.ps1` flows for every changed node (including `-Flow attachments`), and the contract handover note for the FE owner.

Shared node lists (`definition.schema.json`, `NodeConfigSchemasTest`, `DefinitionValidatorTest`, `.env.example`, `application.properties`) are merged as unions; workflow-service Maven runs take turns on the lock.

## Risks

- Memory: up to 20 MiB per execution in memory, bounded by worker concurrency.
- Gmail polling gets slower when messages carry attachments, bounded by the count and size limits.
- A reused bucket key can also read avatars (accepted).
- Integration tests cannot pull the pinned MinIO image (known), so the adapter is tested against an `adobe/s3mock` Testcontainer (fallback: a stubbed `S3Client`). The live test covers real R2.
- Byte caps per call: a 10 MiB attachment is about 14 MiB of base64 JSON from Gmail, and a 20 MiB email is about 28 MiB once MIME-encoded. Only these calls get the larger caps.
