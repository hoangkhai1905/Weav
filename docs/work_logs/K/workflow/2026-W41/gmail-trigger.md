# Gmail trigger (Week 2, Lane C)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-05 (Asia/Saigon) |
| Branch | `feat/gmail-trigger`, merged into `staging` (ded6dda) |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Done, committed and merged into `staging`; Gmail live test done on 2026-10-05 (section 8) |
| Scope | `trigger.gmail` (polling), `gmail.readonly` scope, reconnect surfacing, V11 migration |

## 2. Summary

- New node `trigger.gmail` (`connectionId`, optional `query`, optional `pollIntervalMinutes` default 5). Each new email starts one run.
- Gmail connections now ask for `openid email gmail.readonly gmail.send`. `gmail.metadata` is dropped (Gmail rejects `format=full` and `q=` for a token that carries it, even with readonly).
- A stored Google grant missing a required scope (every Gmail connection made before this change) fails with a stable, non-retryable code telling the user to reconnect.
- Review: 3 rounds; fixed ReDoS in HTML stripping, burst stall of the 10-mail window, NUL/control characters in JSONB, per-message skip handling, 403 split, backlog drain.

Trigger input (all keys always present, so `{{ trigger.input.bodyOmitted }}` never misses):

| Key | Value |
| --- | --- |
| messageId, threadId | Gmail ids |
| from, to, cc, subject | decoded header text (RFC 2047 decoded), empty string when absent, each at most 2000 chars |
| date | internalDate as ISO-8601 UTC |
| snippet | Gmail snippet |
| body | text/plain part, else tag-stripped text/html; at most 32 KiB UTF-8 |
| bodyTruncated | true when the body was cut at 32 KiB |
| bodyOmitted | true when the message was too large to read in full and only headers and snippet were read |
| labelIds | list of label ids |

## 3. Google Cloud Console (exact scopes)

OAuth consent screen -> Data access (Scopes) for the Weav OAuth client:

- keep: `openid`, `userinfo.email`, `gmail.send`, `spreadsheets`, `calendar.events`, `drive.file`
- ADD: `https://www.googleapis.com/auth/gmail.readonly` (restricted scope; fine for the demo because only listed Test users sign in). Done by K on 2026-10-05.
- REMOVE (optional, now safe): `https://www.googleapis.com/auth/gmail.metadata`
- Gmail API enabled (already on for `email.send`).
- App in Testing mode: refresh tokens expire after 7 days, so a Gmail connection stops working weekly and must be reconnected (it then shows the reconnect code below). Test users must be listed.

## 4. Decisions

| Decision | Reason |
| --- | --- |
| `gmail.metadata` removed, not kept next to readonly | Gmail refuses message reads and `q=` for a token that includes metadata |
| `include_granted_scopes` is NOT sent for Gmail (still sent for Sheets/Calendar/Drive) | Incremental auth would merge an earlier `gmail.metadata` grant into the reconnect token and break reads. Fallback: remove Weav at myaccount.google.com/permissions, reconnect |
| Idempotency key `gmail:<triggerId>:<messageId>` | The unique index is `(workflow_id, idempotency_key)`, per workflow; including the trigger id keeps two Gmail triggers of one workflow, and a republished trigger, independent. A reused key with changed input (labels change between polls) counts as "already admitted" |
| V11 `workflow_triggers.poll_cursor TIMESTAMPTZ` (newest admitted Gmail `internalDate`) and nullable `poll_cursor_message_id TEXT` (last handled message) | Same type as `next_run_at`; the id position stops a burst inside one second from refilling the window. No CHECK on trigger type/status exists. Pause/resume clears the stored id |
| Separate `GmailTriggerPort` (implemented by `WorkflowTriggerAdapter`), not new methods on `WorkflowTriggerPort` | Test fakes (and other lanes) implement `WorkflowTriggerPort` |
| Gmail scan is a second `@Scheduled` method `scanGmail()` in `WorkflowScheduleScanner` (same tick period). Properties `weav.workflow.gmail.poller.enabled` (default true), `weav.workflow.gmail.poller.batch-size` (default 10); no `.env` change | A slow Gmail call cannot delay schedule slots (fixedDelay is per method) |
| Poll flow: claim tx (lock workflow then trigger, like schedules; verify; push `next_run_at` by interval) -> resolve + Gmail outside any transaction -> one admission tx per email (oldest first; re-locks, re-reads cursor and ACTIVE status) -> short cursor tx | No lock or transaction during HTTP; failures keep the cadence; a pause/resume during the read skips older mail or stops the poll |
| Each poll lists up to 100 newest ids (paged, at most 5 pages), reverses to oldest first, drops everything up to the stored id, takes the next 10, fetches them, and stores `(cursor = newest admitted internalDate, last id = last handled entry)`. A poll that handled a full slice without error moves `next_run_at` back to now, so a backlog drains at about 10 mails per scanner tick. `after:` uses the cursor second minus 1; mail older than the cursor is dropped (equal timestamp kept, deduped by the idempotency key). `ponytail:` comment in `GmailTriggerProcessor`; upgrade path `users.history.list` with a stored `historyId` | Cursor never jumps over unread mail; bounded Gmail calls per poll |
| Pause clears `next_run_at`; resume sets cursor and `next_run_at` to now. Publish sets cursor = publish time, first poll due at once | Like schedules, mail received while paused is not replayed |
| Transport: `executeGmailGetWithBearerToken` on `gmail.googleapis.com`, exact paths `/gmail/v1/users/me/messages` and `/messages/{hex id up to 32}`, no query in the URI; anything else rejected. Existing methods unchanged | Allow-list on a shared Google host |
| Per-message failures: a message that vanished, is unreadable (4xx other than 401/403) or is rejected as bad input is stepped over, logged (`event=gmail_message_skipped reason=<code> messageId=<id>`) and noted as `GMAIL_MESSAGE_SKIPPED`; a message over the 1 MiB response cap is re-read with `format=metadata` and admitted with `body: ""`, `bodyOmitted: true`. 401/403/429/5xx stop the poll | One poison email must not block the mailbox |
| An unexpected admission exception logs `event=gmail_admission_failed triggerId messageId errorType` and stops the poll with the position before that mail (not skipped); it shows as `GMAIL_POLL_FAILED` | Transient database errors must never lose mail |
| Gmail 403 split: `rateLimitExceeded` / `userRateLimitExceeded` / `quotaExceeded` -> `HTTP_RATE_LIMITED` retryable (also on `email.send`, where nothing was sent so retry is safe); `insufficientPermissions` or `PERMISSION_DENIED` -> `CONNECTION_RECONNECT_REQUIRED`; other 403 -> `HTTP_BUSINESS_REJECTED` | Google reports quota as 403 |
| Input hygiene: `GmailMessageParser.clean` strips C0 controls except tab/CR/LF, DEL and unpaired surrogates from every string (numeric entities decode to nothing); HTML-only mail is tag-stripped by one linear character scanner (no regex), input cut to 256 KiB (backs off one char at a surrogate pair), entities decoded, `<script>/<style>` dropped, never rendered | ReDoS and NUL-in-JSONB fixes; Vietnamese subjects arrive as RFC 2047 encoded words |
| Workflow trigger `lastError` codes shown as `reasonCode` (additive enum): `CONNECTION_RECONNECT_REQUIRED`, `AUTHENTICATION_REJECTED`, `CONNECTION_FORBIDDEN`, `CONNECTION_UNAVAILABLE`, `GMAIL_POLL_FAILED`, plus notices `GMAIL_MESSAGE_SKIPPED`, `GMAIL_BACKLOG_TRUNCATED`. Notices are written only by the poll in which they happened; the next clean poll clears them. Rate limits/outages collapse to `GMAIL_POLL_FAILED` | Notices must not stick |
| Schema loader gained `maxLength` (counts code points), `maximum`, `default` keywords for the node file; schema README lists them as informational (not applied by the backend) | Needed by `trigger.gmail.json`; `DefinitionJsonCodecTest` keeps the draft schema consistent |

## 5. Reconnect experience (traced)

Before this change: Workspace `ResolveConnectionUseCase` threw `InvalidStateException` (HTTP 422 `INVALID_STATE`), workflow-service treated it as `WorkspaceDependencyUnavailableException`, so `email.send` failed `CONNECTION_UNAVAILABLE`, retryable (retried for nothing), and the connection stayed ACTIVE.

Now:

- Workspace: new `ConnectionReconnectRequiredException` (subclass of `InvalidStateException`, still 422) with body code `CONNECTION_RECONNECT_REQUIRED` for stored scopes missing a required one, refresh rejected, refresh no longer granting required scopes, and status INVALID. A DISABLED connection keeps `INVALID_STATE`. The scope check itself does not change connection status.
- workflow-service: `WorkspaceClient` maps 422 + that code to `ConnectionReconnectRequiredException`. `email.send`, `google.sheets`, `google.calendar`, `google.drive` fail `CONNECTION_RECONNECT_REQUIRED`, non-retryable ("The Gmail connection must be reconnected: open Connections and reconnect it."). The Gmail poller records it as the trigger `lastError` (`reasonCode` on the workflow trigger list) and retries next interval.
- Reconnect: Connections page -> the Gmail connection -> reconnect (API: `POST /workspaces/{id}/connections/{connectionId}/oauth/authorize`, Google consent, callback/`oauth/complete`). OAuth completion replaces the stored credential including `grantedScopes` and marks the connection ACTIVE; the connection id is unchanged, so workflows keep working without edits. Google shows the new "read your email" consent (restricted scope; "unverified app" warning for Test users).
- Rollout: every GMAIL connection made before this change (granted `gmail.metadata` + `gmail.send`) returns `CONNECTION_RECONNECT_REQUIRED` until reconnected, including for `email.send` nodes that worked before. The connection test checks stored scopes first (old connection reports auth invalid), then calls `users/me/profile` (`GoogleOAuthProvider.verifyGmail`), which accepts readonly.

## 6. Changed files

| Area | Files |
| --- | --- |
| workspace-service | `GoogleOAuthScopePolicy`, `GoogleOAuthProvider` (no incremental grants for Gmail), `ResolveConnectionUseCase`, `InvalidStateException`, new `ConnectionReconnectRequiredException`; README, spec doc, contracts README, openapi (additive description); tests updated (`gmail.metadata` to `gmail.readonly`) plus reconnect tests |
| workflow-service | `TriggerType` / `ExecutionTriggerType.GMAIL`, `WorkflowTrigger.pollCursor`, JPA entity and mapper, `WorkflowTriggerAdapter`, `WorkflowPublicationService`, new `GmailTriggerProcessor` / `GmailTriggerService` / `GmailMailboxPort` / `GmailTriggerPort` / `GmailMailbox` / `GmailMessageParser`, `GmailClient` list/get, `PinnedHttpTransport`, `WorkspaceClient`, three Google executors, `WorkflowResponse` code allow-list, `WorkflowScheduleScanner`, `application.properties`, `V11__gmail_trigger_poll_cursor.sql` |
| packages | `workflow-schema/nodes/trigger.gmail.json`, `definition.schema.json` (type + block, appended), workflow `openapi.yaml` enums (trigger/execution type, reasonCode) |
| Tests | `GmailMessageParserTest`, `GmailMailboxTest`, `GmailTriggerProcessorTest`, `GmailTriggerIntegrationTest` and `GmailAdmissionPersistenceTest` (Testcontainers), `GmailReadAllowListTest`, `HttpTransportIntegrationTest`, `WorkspaceClientTest`, `GmailNodeExecutorTest`, `NodeConfigSchemasTest`, `DefinitionValidatorTest`, `UnavailableNodeExecutorTest` |

## 7. Evidence, risks and known limits

| Check | Command | Result |
| --- | --- | --- |
| workspace-service | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` | 421 tests, 0 failures |
| workflow-service | same | 622 tests, 0 failures, incl. Testcontainers `GmailTriggerIntegrationTest` (last full count recorded, after review round 1; rounds 2 and 3 added tests, final count not recorded) |

Known limits:

- More than 100 matching mails inside one poll interval loses the oldest ones beyond the newest 100 (flagged by `GMAIL_BACKLOG_TRUNCATED` and `event=gmail_backlog_truncated`).
- List order of mails with equal internalDate is assumed stable between polls (documented in `GmailMailbox`); a flip could step over a mail. A mail delivered late with an internalDate before the stored position is stepped over.
- One mail that keeps failing admission with an unexpected error blocks the trigger (`GMAIL_POLL_FAILED`), deliberately.
- Up to 10 emails are admitted per poll; very large mails are admitted with `bodyOmitted`.
- `email.send` can be triggered by its own sent mail if a workflow sends to the watched mailbox: use `query` such as `in:inbox`.
- Google quota errors on send are assumed rejected before processing (comment in `GmailClient`).
- Environment: the dev RabbitMQ container can stop during a compose rebuild (restart policy `no`); workflow-service then cannot publish executions and runs stay QUEUED. Recover with `docker compose -f compose.yml -f compose.dev.yml --profile app up -d rabbitmq` (see section 8).
- FE: `apps/web/src/api/workflow-v1.api.ts` `triggerType` union and the api-gateway enum lists do not know `GMAIL` yet (out of lane). The node editor reads node schemas, so `trigger.gmail` appears if the catalog is served from the schema package.

## 8. Live test result (2026-10-05): done

- Setup: Google Cloud Console scope `gmail.readonly` added by K; dev stack rebuilt (workspace-service, workflow-service, api-gateway); Flyway V11 applied to Neon `workflow_db` (two nullable columns `poll_cursor`, `poll_cursor_message_id`); `scripts/live-test-nodes.ps1 -Flow gmail -Cleanup` (see `scripts/README.md`).
- Result (third attempt): all 20 steps PASS. New GMAIL connection via OAuth ACTIVE; trigger ACTIVE; the email with subject "Weav live test 20261005-200935" started exactly one GMAIL run; run SUCCESS; `data.set` copied from/subject; no duplicate after two more poll intervals; workflow paused. Body length shows n/a in the script because the trigger node output does not expose the input body (expected).
- Findings:
  1. First attempt timed out because the tester had not sent the email yet (the script prints the subject to send; clarifying that in the README is optional, script untouched).
  2. Second attempt: the run was admitted but stayed QUEUED because the RabbitMQ container had stopped (SIGTERM about 46 s after start during the compose rebuild, restart policy `no`); workflow-service could not publish the execution (`UnknownHostException rabbitmq`; one outbox event marked FAILED after 10 attempts). Fix: `docker compose -f compose.yml -f compose.dev.yml --profile app up -d rabbitmq`; the run path then worked. Environment issue, not a code defect.
- Left behind (local dev test data): a new GMAIL connection in workspace "Live test", three paused "Live test Gmail <timestamp>" workflows, one execution stuck QUEUED (`61b2c528-08ac-4eb6-9446-1421da1d7a02`) from the RabbitMQ outage, the test emails in K's mailbox. Optional: `gmail.metadata` can now be removed from the consent screen.
- Not recorded as checked: pause/resume non-replay and a pre-change connection returning `CONNECTION_RECONNECT_REQUIRED` (manual steps: pause, send mail, expect no run; resume, same mail still no run, a new mail starts one).

## 9. Next steps

- Remove `gmail.metadata` from the consent screen (optional); delete the stuck QUEUED execution and test workflows when no longer useful.
- FE: add `GMAIL` to the web `triggerType` union and the gateway enums; show `reasonCode` and a reconnect action on the connection.
