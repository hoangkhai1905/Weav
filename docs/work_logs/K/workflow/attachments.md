# Email attachments and the workflow file store (Week 4, lanes F1-F3)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-06 (Asia/Saigon) |
| Branches | `feat/wk4-f1-file-store` (from `staging`); F2/F3 follow |
| Owner | K / Sonnet workers, coordinator reviews and commits |
| Status | F1 done and reviewed (1 round); F2 email.send and F3 Gmail trigger + Drive not started; live test pending |
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

## 6. Risks and follow-ups

- Memory: up to ~30 MiB per large call (email upload, attachment GET); bounded by worker concurrency.
- Orphan objects if the JVM dies between put and row insert: add an R2 lifecycle rule on `workflow-files/` (about 8 days) at deployment.
- The reused R2 key can also read avatars (accepted in the spec).
- Next: F2 `email.send` (MIME, upload send, URL/file attachments, reply-in-thread), F3 `trigger.gmail` attachments + Drive `file` upload, then F5 live-test flow `-Flow attachments`.
