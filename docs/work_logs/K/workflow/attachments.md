# Email attachments and the workflow file store (Week 4, lanes F1-F3)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-06 (Asia/Saigon) |
| Branches | `feat/wk4-f1-file-store`, `feat/wk4-f2-email-send`, `feat/wk4-f3-gmail-drive` (from `staging`, all merged) |
| Owner | K / Sonnet workers, coordinator reviews and commits |
| Status | F1, F2, F3 done, reviewed and merged into `staging`; live test pending (lane F5 adds `-Flow attachments`) |
| Scope | Workflow file store on R2, retention, transport changes for attachments (workflow-service). Spec: `docs/superpowers/specs/2026-10-06-email-attachments-design.md` |

## 2. Summary (F1)

- `WorkflowFileStore` port (`application/port/out`): `configured()`, `store(workspaceId, executionId, filename, mimeType, bytes)` -> `FileReference{fileId, filename, mimeType, size}`, `read(workspaceId, fileId)` -> `StoredFile`, `purgeExpired(limit)`, static `safeFilename(String)` (null when nothing usable is left).
- Adapters in `infrastructure/files/`: `S3WorkflowFileStore` (AWS SDK `s3` 2.29.45, R2 endpoint override, region auto, path style), `UnavailableWorkflowFileStore`, `WorkflowFileProperties`, `WorkflowFileRepository` (JdbcTemplate), `WorkflowFileConfiguration` (S3 only when endpoint, bucket and both keys are set).
- Flyway `V12__workflow_files.sql`: table `workflow_files` with indexes on `expires_at` and `workspace_id`. Applies on the next workflow-service start on whichever Neon branch the stack uses.
- `RetentionPurgeJob` purges expired files first (object, then row), keyset-paged on `(expires_at, id)` so rows whose object delete keeps failing do not starve newer ones.
- `PinnedHttpTransport` (additive, default 1 MiB caps unchanged): per-call caps bounded by `MAX_CALL_BYTES` (32 MiB); `executeGmailUploadSendWithBearerToken` (`uploadType=media|multipart`) + `gmailMultipartRelated(threadId, rfc822)`; `executeGmailAttachmentGetWithBearerToken`; `downloadPublicFile(uri, cap)` -> `Download{status, bytes, contentType, filename}` (SSRF target policy, DNS pinning, redirects off, cap enforced while streaming); Drive upload cap via a 6-arg `executeGoogleApiWithBearerToken`; GET allowed on the Calendar events path (for F4 `list`).
- `GmailClient.accessToken` is package-private so F3's new reader can reuse it.

## 3. Decisions

| Decision | Reason |
| --- | --- |
| Failure codes: `FILE_NOT_FOUND` (same message for unknown, other-workspace, expired and malformed ids), `FILE_TOO_LARGE`, `DEPENDENCY_NOT_CONFIGURED` (non-retryable), `FILE_STORE_UNAVAILABLE` (retryable, S3/DB errors) | Ids cannot be probed across workspaces |
| Object key `{prefix}/{workspaceId}/{fileId}`, stored with content type `application/octet-stream`; real name and type live in the row | No user input in keys |
| Object first, then row; a failed row insert deletes the object (best effort) | No rows pointing at missing objects |
| One filename sanitizer (`WorkflowFileStore.safeFilename`) for stored files and Content-Disposition names: drops path separators, control, format (bidi, zero-width) and line/paragraph separator characters, 255 chars without splitting surrogate pairs | Review finding (RLO spoofing) |
| File purge runs outside the advisory lock (deletes are idempotent) | Single instance in the demo |
| `adobe/s3mock:4.11.0` Testcontainer for the adapter test | Pinned MinIO image can no longer be pulled |
| AWS SDK stays at 2.29.45 (comment in `pom.xml`) | SDK >= 2.30 sends CRC32 checksums that R2 rejects unless `requestChecksumCalculation(WHEN_REQUIRED)` is set |
| `IntegrationReadiness` unchanged; consumers call `WorkflowFileStore.configured()` | It only has a static per-node-type pattern |

## 4. Configuration

New env vars (`.env.example`, `compose.dev.yml` workflow-service, `application.properties`): `WORKFLOW_FILES_S3_ENDPOINT`, `_REGION` (auto), `_BUCKET`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_PATH_STYLE_ACCESS` (true), `_KEY_PREFIX` (workflow-files), `WORKFLOW_FILES_RETENTION` (7d), `WORKFLOW_FILES_MAX_FILE_BYTES` (10 MiB), `WORKFLOW_FILES_MAX_ATTACHMENTS` (5), `WORKFLOW_FILES_MAX_EMAIL_BYTES` (20 MiB). In K's dev `.env` the S3 values mirror `AVATAR_S3_*` (same bucket `kltn-weav`, different prefix). Tests leave the store not configured.

## 5. Checks

| Check | Result |
| --- | --- |
| `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (workflow-service, F1 worktree) | 703 tests, 0 failures, 1 error: known env-only `WorkflowNotificationLifecyclePersistenceIntegrationTest` (notification dist) |
| Review (java-reviewer) | No HIGH/CRITICAL; fixed: purge starvation, exact-size buffers, streaming cap test, shared sanitizer with bidi filtering, SDK comment |
| `git diff --check` | Clean |

Not tested yet: real R2 (live test after F2/F3).

## 5b. F2 `email.send` (merged)

- Config (new fields optional): `cc`, `bcc`, `replyTo` (string or list, same rules as `to`; to+cc+bcc combined capped at the existing maximum), `bodyType` `text|html`, `senderName` (max 100), `replyToMessageId` (Gmail hex id), `attachments`: list of `{url, filename?}` or `{fileId, filename?}`, or a template such as `{{ trigger.attachments }}` (items without `fileId`/`url` are skipped and counted).
- Output `{messageId, threadId?, status: "SENT"}` plus `attachmentCount` (when attachments are configured) and `skippedAttachments` (> 0).
- Old configs (no new field, no resolved attachment) take the old `GmailClient.send` path unchanged (test asserts the legacy MIME). Everything else: `MimeMessageBuilder` (multipart/mixed, RFC 2047 headers, RFC 2231 filenames, base64 streamed at 76 chars, `weav_<uuid>` boundaries, every header rejects control characters) sent by `GmailClient.sendMessage` via upload `media`, or `multipart` with `threadId` when replying.
- `senderName` reads `users/me/profile` (new strict `PinnedHttpTransport` GET) for the From address; replies read message metadata for `threadId`, `Message-ID`, `References` (printable-ASCII ids only, else dropped; chain trimmed to 900 chars; `Re: <original>` only when the subject is blank). Both need `gmail.readonly`, which GMAIL connections already have.
- Attachments (`EmailAttachmentResolver`): resolved after the connection check; URL via `downloadPublicFile` with cap min(per-file, remaining total); files via `WorkflowFileStore.read(context.workspaceId(), ...)`; 5 usable / 100 listed items, 10 MiB each, 20 MiB total; names through `safeFilename`.
- New failure codes (non-retryable): `ATTACHMENT_LIMIT_EXCEEDED`, `ATTACHMENT_TOO_LARGE`, `REPLY_MESSAGE_NOT_FOUND`. Retryable send errors stay "unknown outcome" (no duplicate sends).
- Checks: `mvnw verify` 736 tests, only the known notification-dist error (lane worktree); after merging staging re-run by the coordinator (see commit). Review (java-reviewer): no HIGH/CRITICAL; fixed memory copies, ASCII-only Message-IDs, surrogate-safe subject trim, connection before downloads, total-budget download cap, combined recipient cap.
- Live test must confirm: Gmail returns metadata `Subject` decoded; `Bcc` honoured on raw upload send.

## 5c. F3 `trigger.gmail` attachments and Drive `file` upload (merged)

- `trigger.gmail` output always has `attachments: [{filename, mimeType, size, fileId?, skipped?}]`; `skipped` is `limit` | `too_large` | `not_stored` (store not configured) | `error` (permanently unreadable, or degraded, see below); no `fileId` when skipped. Only messages that start a run download anything (skip markers and old mail do not). Files are stored under the trigger's workspace with `executionId` null; the trigger input holds reference fields only.
- `GmailMailboxPort.fetchNew` takes the workspace id first; `FetchResult` gained `more` (slice cut early; the processor polls again on the next tick like a full slice). New `GmailAttachmentReader` validates ids before building the URI; download cap `maxBytes/3*4 + 4 KiB`.
- Parser bounds: depth 20, 2000 parts visited, 50 attachment parts kept; filenames cleaned (NUL, controls, lone surrogates) then `safeFilename`; inline `body.data` with a filename is stored without a download; parts without a filename ignored.
- Polling never stalls on one message (review round 1 HIGH): a retryable attachment failure on a later message cuts the slice after the earlier ones (retried next poll); on the first message it fails the poll only while the mail's date is within [now - 1 h, now + 5 min], otherwise the attachment becomes `skipped: "error"` and the message is admitted; credential failures (`AUTHENTICATION_REJECTED`, `CONNECTION_RECONNECT_REQUIRED`) still fail the poll; a per-poll budget of 2 x max email bytes (40 MiB) of declared attachment size cuts the slice (never empty). Duplicate admission stays blocked by the `gmail:<trigger>:<id>` idempotency key; files of a retried or losing overlapping poll become orphans purged by retention.
- `google.drive` `upload`: `file` (file reference `{fileId, ...}` or a template resolving to one) instead of `content`; at most 5 MiB (`FILE_TOO_LARGE`), name and mimeType default to the stored ones. Neither `content` nor `file` still uploads an empty file (review round 1 HIGH: backward compatibility); `file` with non-blank `content` is a `CONFIGURATION_ERROR`. Additive overloads in `GoogleApiNodeExecutor.prepare(Context, Map)` and `GoogleApiClient.call(..., uploadMaxRequestBytes)` (0 = old path).
- Checks: lane `mvnw verify` 736 tests, only the known notification-dist error; coordinator re-ran it after merging staging (see the merge commit). Review (java-reviewer, 2 rounds): round 1 found 2 HIGH (Drive break, polling stall), fixed; round 2 no HIGH/CRITICAL, MEDIUMs fixed (future-dated mail, cut-slice throughput).

## 6. Risks and follow-ups

- Memory: up to ~30 MiB per large call (email upload, attachment GET); bounded by worker concurrency.
- Orphan objects if the JVM dies between put and row insert: add an R2 lifecycle rule on `workflow-files/` (about 8 days) at deployment.
- The reused R2 key can also read avatars (accepted in the spec).
- Next: lane F5 (live-test flow `-Flow attachments`, AI prompt, FE handover), then the live test on real Gmail, Drive and R2.
